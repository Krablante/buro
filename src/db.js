import { mkdir, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { loadConfig } from "./config.js";
import { entityData, normalizeEntity, rowToEntity } from "./schema.js";

const require = createRequire(import.meta.url);
let sqliteModule;

function sqlite() {
  sqliteModule ||= require("node:sqlite");
  return sqliteModule;
}

export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buro_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS entities_kind_idx ON entities (kind);

CREATE TABLE IF NOT EXISTS entity_lookup (
  key TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (key, entity_id)
) STRICT;
CREATE TABLE IF NOT EXISTS entity_locations (
  host_key TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (host_key, entity_id)
) STRICT;
CREATE INDEX IF NOT EXISTS entity_lookup_entity_idx ON entity_lookup (entity_id);
CREATE INDEX IF NOT EXISTS entity_locations_entity_idx ON entity_locations (entity_id);
`;

function now() {
  return new Date().toISOString();
}

function revision() {
  return `${now()}-${randomUUID()}`;
}

function hasDatabase(value) {
  return value && typeof value.prepare === "function" && typeof value.exec === "function";
}

function configuredDatabasePath(database) {
  if (typeof database === "string" && database.trim()) return path.resolve(database);
  return loadConfig().databasePath;
}

export function openDatabase(databasePath, options = {}) {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(path.resolve(databasePath), {
    readOnly: options.readOnly === true,
    timeout: options.timeout ?? 5000,
  });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

async function withDatabase(database, callback, options = {}) {
  if (hasDatabase(database)) return callback(database);
  const db = openDatabase(configuredDatabasePath(database), options);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

export async function withWriteTransaction(database, callback) {
  return withDatabase(database, async (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await callback(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  });
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function unsupportedTables(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('buro_meta', 'entities', 'entity_lookup', 'entity_locations') ORDER BY name",
  ).all().map((row) => row.name);
}

function schemaBinding(schema) {
  return {
    storage_version: 2,
    engine: "sqlite",
    model: "configurable-entities",
    preset: schema.id,
    preset_version: schema.version,
    preset_hash: schema.hash,
  };
}

export function readSchemaBinding(db) {
  if (!tableExists(db, "buro_meta")) return null;
  const row = db.prepare("SELECT value FROM buro_meta WHERE key = ?").get("schema");
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    throw new Error(`invalid BURO schema metadata: ${error.message}`);
  }
}

export function writeSchemaBinding(db, schema) {
  db.prepare(
    `INSERT INTO buro_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run("schema", JSON.stringify(schemaBinding(schema)), now());
  const { source: _source, hash: _hash, core_fields: _coreFields, ...model } = schema;
  db.prepare(`INSERT INTO buro_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run("model", JSON.stringify(model), now());
}

function bindingMismatch(binding, schema) {
  if (!binding) return "database has no preset binding";
  if (binding.preset !== schema.id) return `database uses preset ${binding.preset}, active preset is ${schema.id}`;
  if (binding.preset_version !== schema.version) {
    return `database uses ${schema.id} v${binding.preset_version}, active preset is v${schema.version}`;
  }
  if (!binding.preset_hash) return "database preset binding has no model hash";
  if (binding.preset_hash !== schema.hash) {
    return `database preset hash differs from ${schema.id} v${schema.version}`;
  }
  return null;
}

export function assertSchemaBinding(db, schema) {
  const mismatch = bindingMismatch(readSchemaBinding(db), schema);
  if (mismatch) throw new Error(`${mismatch}; run \`buro init\` to validate and adopt it, or \`buro import <file>\` to migrate`);
}

export async function initDb(database, schema, options = {}) {
  if (hasDatabase(database)) {
    const unsupported = unsupportedTables(database);
    if (unsupported.length) throw new Error(`unsupported BURO tables: ${unsupported.join(", ")}`);
    const binding = readSchemaBinding(database);
    const mismatch = bindingMismatch(binding, schema);
    if (binding && mismatch && !options.adoptSchema) throw new Error(`${mismatch}; run \`buro init\` explicitly to adopt it`);
    const indexed = tableExists(database, "entity_lookup") && tableExists(database, "entity_locations");
    database.exec(schemaSql);
    if (!mismatch && indexed) return { adopted: false, binding };
    const entityCount = database.prepare("SELECT count(*) AS count FROM entities").get().count;
    if (binding?.preset && binding.preset !== schema.id) {
      throw new Error(`${mismatch}; changing preset identity requires \`buro import <file>\``);
    }
    if (binding?.preset_hash && binding.preset_version === schema.version && binding.preset_hash !== schema.hash) {
      throw new Error(`${mismatch}; increment the preset version before adoption`);
    }
    if (!binding && entityCount > 0 && !options.adoptSchema) {
      throw new Error(`${mismatch}; run \`buro init\` explicitly to adopt it`);
    }
    for (const row of database.prepare("SELECT id, name, kind, data, updated_at FROM entities").iterate()) {
      indexEntity(database, rowToEntity(row, schema), schema);
    }
    writeSchemaBinding(database, schema);
    return { adopted: Boolean(binding && mismatch), binding: schemaBinding(schema) };
  }
  const databasePath = configuredDatabasePath(database);
  await mkdir(path.dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  try {
    return await initDb(db, schema, options);
  } finally {
    db.close();
  }
}

export function indexEntity(db, entity, schema) {
  db.prepare("DELETE FROM entity_lookup WHERE entity_id = ?").run(entity.id);
  const aliases = entity.kind === schema.context?.kind ? entity[schema.context.alias_field] || [] : [];
  const keys = new Set([entity.id, entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : []), ...aliases].filter((value) => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const insert = db.prepare("INSERT INTO entity_lookup (key, entity_id) VALUES (?, ?)");
  for (const key of keys) insert.run(key, entity.id);
  db.prepare("DELETE FROM entity_locations WHERE entity_id = ?").run(entity.id);
  const hosts = new Set((Array.isArray(entity.locations) ? entity.locations : []).map((location) => location?.host).filter((value) => typeof value === "string"));
  const legacyMember = schema.context && entity[schema.context.member_field];
  if (typeof legacyMember === "string") hosts.add(legacyMember);
  const addLocation = db.prepare("INSERT INTO entity_locations (host_key, entity_id) VALUES (?, ?)");
  for (const host of new Set([...hosts].map((value) => value.trim().toLowerCase()))) addLocation.run(host, entity.id);
}

export async function lookupEntities(key, database, schema) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    return db.prepare(`SELECT e.id, e.name, e.kind, e.data, e.updated_at FROM entities e
      JOIN entity_lookup l ON l.entity_id = e.id WHERE l.key = ? ORDER BY e.id`)
      .all(key.trim().toLowerCase()).map((row) => rowToEntity(row, schema));
  }, { readOnly: true });
}

function entityValues(entity, schema, options = {}) {
  const normalized = normalizeEntity(entity, schema);
  return [
    normalized.id,
    normalized.name,
    normalized.kind,
    JSON.stringify(entityData(normalized, schema)),
    options.preserveUpdatedAt && normalized.updated_at ? normalized.updated_at : revision(),
  ];
}

const entityProjection = "id, name, kind, data, updated_at";

export async function backupDatabase(database, options = {}) {
  const { backup } = sqlite();
  const config = loadConfig();
  const backupDir = path.resolve(options.backupDir || config.backupDir);
  const retention = options.backupRetention || config.backupRetention;
  await mkdir(backupDir, { recursive: true });
  const openedHere = !hasDatabase(database);
  const db = openedHere ? openDatabase(configuredDatabasePath(database), { readOnly: true }) : database;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const target = path.join(backupDir, `buro-${stamp}.sqlite3`);
  try {
    await backup(db, target);
  } finally {
    if (openedHere) db.close();
  }
  const backups = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^buro-\d{8}T\d{9}Z\.sqlite3$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.all(backups.slice(retention).map((name) => rm(path.join(backupDir, name), { force: true })));
  return target;
}

export async function createEntity(entity, database, schema, options = {}) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const row = db.prepare(
      `INSERT INTO entities (id, name, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING RETURNING ${entityProjection}`,
    ).get(...entityValues(entity, schema, options));
    const saved = rowToEntity(row, schema);
    if (saved) indexEntity(db, saved, schema);
    return saved;
  });
}

export async function updateEntity(entityId, entity, database, schema) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const normalized = normalizeEntity({ ...entity, id: entityId }, schema);
    const values = entityValues(normalized, schema);
    const row = db.prepare(
      `UPDATE entities SET name = ?, kind = ?, data = ?, updated_at = ? WHERE id = ? RETURNING ${entityProjection}`,
    ).get(values[1], values[2], values[3], values[4], entityId);
    const saved = rowToEntity(row, schema);
    if (saved) indexEntity(db, saved, schema);
    return saved;
  });
}

export async function deleteEntity(entityId, database, schema) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    return Boolean(db.prepare("DELETE FROM entities WHERE id = ? RETURNING id").get(entityId));
  });
}

export async function replaceEntities(entities, database, schema) {
  return withDatabase(database, (db) => {
    db.prepare("DELETE FROM entities").run();
    const insert = db.prepare("INSERT INTO entities (id, name, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const entity of entities) {
      insert.run(...entityValues(entity, schema, { preserveUpdatedAt: true }));
      indexEntity(db, entity, schema);
    }
    writeSchemaBinding(db, schema);
    return entities.length;
  });
}

export async function listEntities(database, schema, options = {}) {
  return withDatabase(database, (db) => {
    if (!options.skipBinding) assertSchemaBinding(db, schema);
    const query = options.kind
      ? `SELECT ${entityProjection} FROM entities WHERE kind = ? ORDER BY id`
      : `SELECT ${entityProjection} FROM entities ORDER BY kind, id`;
    return db.prepare(query).all(...(options.kind ? [options.kind] : [])).map((row) => rowToEntity(row, schema));
  }, { readOnly: true });
}

export async function listEntityIds(database, schema) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    return db.prepare("SELECT id FROM entities").all().map((row) => row.id);
  }, { readOnly: true });
}

export async function listEntitySummaries(database, schema, kind, options = {}) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const conditions = [];
    const values = [];
    if (kind) { conditions.push("kind = ?"); values.push(kind); }
    if (options.query) {
      const pattern = `%${options.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(lower(id) LIKE ? ESCAPE '\\' OR id IN (SELECT entity_id FROM entity_lookup WHERE key LIKE ? ESCAPE '\\'))");
      values.push(pattern, pattern);
    }
    const query = `SELECT id, name, kind FROM entities ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY kind, id LIMIT ? OFFSET ?`;
    return db.prepare(query).all(...values, options.limit ?? 100, options.offset ?? 0);
  }, { readOnly: true });
}

export async function listMemberSummaries(contextId, database, schema, aliases = []) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const keys = [...new Set([contextId, ...aliases].map((value) => value.toLowerCase()))];
    return db.prepare(`SELECT DISTINCT e.id, e.name, e.kind FROM entities e JOIN entity_locations l ON l.entity_id = e.id
      WHERE e.id <> ? AND l.host_key IN (${keys.map(() => "?").join(",")}) ORDER BY e.kind, e.id LIMIT 100`)
      .all(contextId, ...keys);
  }, { readOnly: true });
}

export async function getEntity(entityId, database, schema, options = {}) {
  return withDatabase(database, (db) => {
    if (!options.skipBinding) assertSchemaBinding(db, schema);
    return rowToEntity(db.prepare(`SELECT ${entityProjection} FROM entities WHERE id = ?`).get(entityId), schema);
  }, { readOnly: true });
}

export async function checkDb(database) {
  return withDatabase(database, (db) => {
    if (!tableExists(db, "entities")) {
      return { ok: false, storage: "sqlite", schema_version: null, entity_count: 0, binding: null };
    }
    return {
      ok: true,
      storage: "sqlite",
      schema_version: 2,
      entity_count: db.prepare("SELECT count(*) AS count FROM entities").get().count,
      binding: readSchemaBinding(db),
    };
  }, { readOnly: true });
}
