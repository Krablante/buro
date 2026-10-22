import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { assertSchemaBinding, assertSupportedDatabase, backupDatabase, listEntities, openDatabase, readStoredModel, replaceEntities } from "./db.js";
import { serializeMutation, validateEntitySet } from "./resolver.js";
import { loadSchema, schemaFromTypes, schemaTypes, text } from "./schema.js";
import { resetGeneration, saveConfig, upgradeModel } from "./migration.js";

function retiredIds(db) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name='retired_ids'").get() ? db.prepare("SELECT id FROM retired_ids ORDER BY id").all().map(row => row.id) : [];
}
export async function exportRegistry(file, config) {
  const db = openDatabase(config.databasePath, { readOnly: true });
  try {
    db.exec("BEGIN");
    const schema = loadSchema({ ...config, database: db });
    const entities = await listEntities(db, schema);
    const manifest = { format: "buro-registry", version: 3, default_kind: schema.default_kind, types: schemaTypes(schema), retired_ids: retiredIds(db), entities };
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await writeFile(file, yaml.dump(manifest, { noRefs: true, lineWidth: -1 }), { flag: "wx", mode: 0o600 });
    return { count: entities.length, filePath: path.resolve(file) };
  } finally { db.close(); }
}

function validateManifest(value) {
  if (!value || value.format !== "buro-registry" || value.version !== 3 || !Array.isArray(value.types) || !Array.isArray(value.entities) || !Array.isArray(value.retired_ids)) throw new Error("expected a complete BURO v3 export");
  const unknown = Object.keys(value).filter(key => !["format", "version", "default_kind", "types", "retired_ids", "entities"].includes(key));
  if (unknown.length) throw new Error(`unknown export fields: ${unknown.join(", ")}`);
  const schema = schemaFromTypes(value.types, value.default_kind);
  const entities = validateEntitySet(value.entities, schema);
  const retired = [...new Set(value.retired_ids.map(id => text(id, "retired ID")))];
  const active = new Set(entities.map(entity => entity.id));
  if (retired.some(id => active.has(id))) throw new Error("an ID cannot be both active and retired");
  return { schema, entities, retired };
}

async function replaceMemory(input, config, dryRun) {
  return serializeMutation(async () => {
    const db = openDatabase(config.databasePath, { mustExist: true });
    try {
      db.exec(dryRun ? "BEGIN" : "BEGIN IMMEDIATE");
      let settingsChanged = false;
      try {
        const schema = loadSchema({ ...config, database: db });
        assertSchemaBinding(db, schema);
        const previousCount = db.prepare("SELECT count(*) AS n FROM entities").get().n;
        const nextIds = new Set(input.entities.map(entity => entity.id));
        let removedCount = 0; const removed = [];
        for (const row of db.prepare("SELECT id FROM entities ORDER BY id").iterate()) if (!nextIds.has(row.id)) { removedCount++; if (removed.length < 100) removed.push(row.id); }
        const preview = { previousCount, count: input.entities.length, removedCount, removed, types: Object.keys(input.schema.kinds) };
        if (dryRun) { db.exec("ROLLBACK"); return preview; }
        const backupPath = await backupDatabase(config.databasePath, config);
        await replaceEntities(input.entities, db, input.schema);
        db.exec("DELETE FROM retired_ids");
        const insert = db.prepare("INSERT OR IGNORE INTO retired_ids(id) VALUES(?)");
        for (const id of input.retired) insert.run(id);
        resetGeneration(db);
        if (input.settings) {
          await saveConfig(config, { ...config.previousConfig, ...input.settings });
          settingsChanged = true;
        }
        db.exec("COMMIT");
        return { ...preview, backupPath };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        if (settingsChanged) await saveConfig(config, config.previousConfig);
        throw error;
      }
    } finally { db.close(); }
  });
}
export async function importRegistry(file, config, { dryRun = false } = {}) {
  return replaceMemory(validateManifest(yaml.load(await readFile(file, "utf8"))), config, dryRun);
}

export async function restoreRegistry(file, config, { dryRun = false } = {}) {
  if (path.resolve(file) === config.databasePath) throw new Error("choose a backup, not the active database");
  const snapshot = openDatabase(path.resolve(file), { readOnly: true });
  let input, backup;
  try {
    if (snapshot.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("backup failed SQLite integrity check");
    assertSupportedDatabase(snapshot);
    const stored = readStoredModel(snapshot);
    if (!stored) throw new Error("snapshot has no definitions");
    const schema = upgradeModel(stored);
    const entities = snapshot.prepare("SELECT * FROM entities").all().map(row => ({ id: row.id, name: row.name, kind: row.kind, ...JSON.parse(row.data), updated_at: row.updated_at }));
    input = { schema, entities: validateEntitySet(entities, schema), retired: retiredIds(snapshot) };
    const row = snapshot.prepare("SELECT value FROM buro_meta WHERE key='backup'").get();
    backup = row ? JSON.parse(row.value) : null;
  } finally { snapshot.close(); }
  if (backup?.settings) {
    const { current_context, current_limit } = backup.settings;
    if (typeof current_context !== "string" || !Number.isInteger(current_limit) || current_limit < 1 || current_limit > 10000) throw new Error("snapshot device settings are invalid");
    input.settings = { current_context, current_limit };
  }
  const result = await replaceMemory(input, config, dryRun);
  return { ...result, backupVersion: backup?.version || "unknown", restoredSettings: backup?.settings || {} };
}
