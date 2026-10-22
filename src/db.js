import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { loadConfig } from "./config.js";
import { entityData, fieldDefinition, normalizeEntity, rowToEntity } from "./schema.js";

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

CREATE INDEX IF NOT EXISTS entities_kind_idx ON entities (kind, id);

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
CREATE TABLE IF NOT EXISTS retired_ids (id TEXT PRIMARY KEY) STRICT;
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
  if ((options.readOnly || options.mustExist) && !existsSync(databasePath)) throw new Error(`BURO database is missing: ${databasePath}; run buro init on the registry host`);
  const created = !existsSync(databasePath) && options.readOnly !== true;
  const db = new DatabaseSync(path.resolve(databasePath), {
    readOnly: options.readOnly === true,
    timeout: options.timeout ?? 5000,
  });
  if (created) chmodSync(path.resolve(databasePath), 0o600);
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
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('buro_meta', 'entities', 'entity_lookup', 'entity_locations', 'retired_ids') ORDER BY name",
  ).all().map((row) => row.name);
}

function schemaBinding(schema) {
  return {
    storage_version: 3,
    indexes_version: 3,
    model_hash: schema.hash,
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
  const { source: _source, hash: _hash, core_fields: _coreFields, generation: _generation, ...model } = schema;
  db.prepare(`INSERT INTO buro_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run("model", JSON.stringify(model), now());
}

function bindingMismatch(binding, schema) {
  if (!binding || binding.storage_version !== 3) return "database needs upgrading";
  if (binding.model_hash !== schema.hash) return "definitions changed while this operation was being prepared; retry with current data";
  return null;
}

export function assertSchemaBinding(db, schema, { checkStorage = false } = {}) {
  const mismatch = bindingMismatch(readSchemaBinding(db), schema) || (checkStorage && storageMismatch(db));
  if (mismatch) throw new Error(`${mismatch}; run buro init if the memory has not been upgraded`);
}

function storageMismatch(db) {
  for (const table of ["entities", "entity_lookup", "entity_locations"]) {
    if (!tableExists(db, table)) return `database is missing ${table}`;
  }
  if (readSchemaBinding(db)?.indexes_version !== 3) return "database indexes require adoption";
  const orderIndex = db.prepare("PRAGMA index_info(entities_kind_idx)").all().map((column) => column.name);
  if (orderIndex.join(",") !== "kind,id") return "database ordered-list index requires adoption";
  return null;
}

export function upgradeEntityOrderIndex(db) {
  db.exec("DROP INDEX IF EXISTS entities_kind_idx; CREATE INDEX entities_kind_idx ON entities (kind, id)");
}

export function readStoredModel(db) {
  if (!tableExists(db, "buro_meta")) return null;
  const row = db.prepare("SELECT value FROM buro_meta WHERE key = 'model'").get();
  return row ? JSON.parse(row.value) : null;
}

export function assertSupportedDatabase(db) {
  const unsupported = unsupportedTables(db);
  if (unsupported.length) throw new Error(`unsupported BURO tables: ${unsupported.join(", ")}`);
}

export function indexEntity(db, entity, schema) {
  db.prepare("DELETE FROM entity_lookup WHERE entity_id = ?").run(entity.id);
  const aliases = fieldDefinition(schema, entity.kind, "aliases")?.type === "string-list" ? entity.aliases || [] : [];
  const keys = new Set([entity.id, entity.name, ...aliases].filter((value) => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const insert = db.prepare("INSERT INTO entity_lookup (key, entity_id) VALUES (?, ?)");
  for (const key of keys) insert.run(key, entity.id);
  db.prepare("DELETE FROM entity_locations WHERE entity_id = ?").run(entity.id);
  const locations = fieldDefinition(schema, entity.kind, "locations");
  const member = locations?.type === "record-list" && locations.fields.host?.type === "string" ? entity.locations : [];
  const hosts = new Set((Array.isArray(member) ? member : []).map((location) => location?.host).filter((value) => typeof value === "string"));
  const addLocation = db.prepare("INSERT INTO entity_locations (host_key, entity_id) VALUES (?, ?)");
  for (const host of new Set([...hosts].map((value) => value.trim().toLowerCase()))) addLocation.run(host, entity.id);
}

export async function lookupEntities(key, database, schema, kind) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    return db.prepare(`SELECT e.id, e.name, e.kind FROM entities e
      JOIN entity_lookup l ON l.entity_id = e.id WHERE l.key = ? ${kind ? "AND e.kind = ?" : ""} ORDER BY e.id LIMIT 101`)
      .all(key.trim().toLowerCase(), ...(kind ? [kind] : []));
  }, { readOnly: true });
}

function entityValues(entity, schema, options = {}) {
  const normalized = normalizeEntity(entity, schema, { allowExistingPaths: true });
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
  const group = options.group || "mutation";
  if (!["mutation", "hourly", "daily"].includes(group)) throw new Error(`unknown backup group: ${group}`);
  const backupDir = path.resolve(options.backupDir || config.backupDir, group);
  const retention = group === "mutation" ? options.backupRetention || config.backupRetention : 8;
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const openedHere = !hasDatabase(database);
  const db = openedHere ? openDatabase(configuredDatabasePath(database), { readOnly: true }) : database;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const target = path.join(backupDir, `buro-${stamp}-${randomUUID()}.sqlite3`);
  const partial = `${target}.partial`;
  try {
    await writeFile(partial, "", { mode: 0o600, flag: "wx" });
    await backup(db, partial);
    const snapshot = openDatabase(partial);
    try {
      snapshot.prepare("INSERT INTO buro_meta(key,value,updated_at) VALUES('backup',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .run(JSON.stringify({ version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
          settings: options.backupSettings || { current_context: options.currentContext || config.currentContext, current_limit: options.currentLimit || config.currentLimit }, group, created_at: now() }), now());
    } finally { snapshot.close(); }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  } finally {
    if (openedHere) db.close();
  }
  const backups = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^buro-\d{8}T\d{9}Z(?:-[a-f0-9-]{36})?\.sqlite3$/.test(entry.name))
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
    const normalized = normalizeEntity({ ...entity, id: entityId }, schema, { allowExistingPaths: true });
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
    const removed = Boolean(db.prepare("DELETE FROM entities WHERE id = ? RETURNING id").get(entityId));
    if (removed) db.prepare("INSERT OR IGNORE INTO retired_ids(id) VALUES(?)").run(entityId);
    return removed;
  });
}

export async function replaceEntities(entities, database, schema) {
  return withDatabase(database, (db) => {
    db.prepare("DELETE FROM entities").run();
    upgradeEntityOrderIndex(db);
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

export async function findEntityMatching(database, schema, kinds, predicate) {
  if (!kinds.length) return null;
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const query = `SELECT ${entityProjection} FROM entities WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY id`;
    for (const row of db.prepare(query).iterate(...kinds)) {
      const entity = rowToEntity(row, schema);
      if (predicate(entity)) return entity;
    }
    return null;
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
      conditions.push("id IN (SELECT entity_id FROM entity_lookup WHERE key LIKE ? ESCAPE '\\')");
      values.push(pattern);
    }
    const query = `SELECT ${options.full ? entityProjection : "id, name, kind"} FROM entities ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY kind, id LIMIT ? OFFSET ?`;
    const rows = db.prepare(query).all(...values, options.limit ?? 100, options.offset ?? 0);
    return options.full ? rows.map(row => rowToEntity(row, schema)) : rows;
  }, { readOnly: true });
}

export async function listMemberSummaries(contextId, database, schema, aliases = [], limit = 100) {
  return withDatabase(database, (db) => {
    assertSchemaBinding(db, schema);
    const keys = [...new Set([contextId, ...aliases].map((value) => value.toLowerCase()))];
    return db.prepare(`SELECT DISTINCT e.id, e.name, e.kind FROM entities e JOIN entity_locations l ON l.entity_id = e.id
      WHERE e.id <> ? AND l.host_key IN (${keys.map(() => "?").join(",")}) ORDER BY e.kind, e.id LIMIT ?`)
      .all(contextId, ...keys, limit + 1);
  }, { readOnly: true });
}

export async function getEntity(entityId, database, schema, options = {}) {
  return withDatabase(database, (db) => {
    if (!options.skipBinding) assertSchemaBinding(db, schema);
    return rowToEntity(db.prepare(`SELECT ${entityProjection} FROM entities WHERE id = ?`).get(entityId), schema);
  }, { readOnly: true });
}

export async function checkDb(database, schema) {
  return withDatabase(database, (db) => {
    if (!tableExists(db, "entities")) {
      return { ok: false, storage: "sqlite", schema_version: null, entity_count: 0, binding: null };
    }
    const binding = readSchemaBinding(db);
    const mismatch = bindingMismatch(binding, schema) || storageMismatch(db);
    return {
      ok: !mismatch,
      ...(mismatch ? { error: mismatch } : {}),
      storage: "sqlite",
      schema_version: 3,
      entity_count: db.prepare("SELECT count(*) AS count FROM entities").get().count,
      binding,
    };
  }, { readOnly: true });
}
