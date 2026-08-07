import { mkdir, readdir, rm } from "node:fs/promises";
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
`;

function now() {
  return new Date().toISOString();
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
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('buro_meta', 'entities') ORDER BY name",
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
}

function bindingMismatch(binding, schema) {
  if (!binding) return "database has no preset binding";
  if (binding.preset !== schema.id) return `database uses preset ${binding.preset}, active preset is ${schema.id}`;
  if (binding.preset_version !== schema.version) {
    return `database uses ${schema.id} v${binding.preset_version}, active preset is v${schema.version}`;
  }
  if (!binding.preset_hash) return "database preset binding has no schema hash";
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
    database.exec(schemaSql);
    const binding = readSchemaBinding(database);
    const mismatch = bindingMismatch(binding, schema);
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
    if (mismatch && binding && !options.adoptSchema) throw new Error(`${mismatch}; run \`buro init\` explicitly to adopt it`);
    for (const row of database.prepare("SELECT id, name, kind, data, updated_at FROM entities").iterate()) {
      rowToEntity(row, schema);
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

function entityValues(entity, schema, options = {}) {
  const normalized = normalizeEntity(entity, schema);
  return [
    normalized.id,
    normalized.name,
    normalized.kind,
    JSON.stringify(entityData(normalized, schema)),
    options.preserveUpdatedAt && normalized.updated_at ? normalized.updated_at : now(),
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
    return rowToEntity(row, schema);
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
    return rowToEntity(row, schema);
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
    for (const entity of entities) insert.run(...entityValues(entity, schema, { preserveUpdatedAt: true }));
    writeSchemaBinding(db, schema);
    return entities.length;
  });
}

export async function listEntities(database, schema, options = {}) {
  return withDatabase(database, (db) => {
    if (!options.skipBinding) assertSchemaBinding(db, schema);
    return db.prepare(`SELECT ${entityProjection} FROM entities ORDER BY kind, id`).all().map((row) => rowToEntity(row, schema));
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
