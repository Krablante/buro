import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { backupDatabase, initDb, openDatabase, readSchemaBinding, replaceEntities, schemaSql, withWriteTransaction } from "./db.js";
import { loadSchema, normalizeSchema } from "./schema.js";
import { validateEntitySet } from "./resolver.js";

function previousSchema(db, binding) {
  const stored = db.prepare("SELECT value FROM buro_meta WHERE key = 'model'").get();
  if (stored) return normalizeSchema(JSON.parse(stored.value), "stored model");
  if (["starter", "politia"].includes(binding?.preset)) {
    const file = new URL(`../presets/legacy/${binding.preset}-v${binding.preset_version}.yaml`, import.meta.url);
    if (existsSync(file)) {
      const model = loadSchema(fileURLToPath(file));
      if (model.hash === binding.preset_hash) return model;
    }
  }
  return null;
}

export function migrateEntities(entities, binding, oldSchema, schema) {
  const historical = oldSchema && ["starter", "politia"].includes(oldSchema.id)
    ? new URL(`../presets/legacy/${oldSchema.id}-v${oldSchema.version}.yaml`, import.meta.url) : null;
  const legacy = historical && existsSync(historical) && loadSchema(fileURLToPath(historical)).hash === oldSchema.hash && binding.preset === schema.id;
  let transformed = 0;
  const input = entities.map((value) => {
    const entity = { ...value };
    let changed = false;
    if (legacy && entity.kind !== oldSchema.context.kind && (entity.host !== undefined || entity.path !== undefined)) {
      entity.locations = [...(entity.locations || []), {
        ...(entity.host ? { host: entity.host } : {}),
        ...(entity.path ? { path: entity.path } : {}),
      }];
      delete entity.host;
      delete entity.path;
      delete entity.updated_at;
      changed = true;
    }
    // Old starter's document records remain ordinary resources in the new default model.
    if (legacy && binding.preset === "starter" && entity.kind === "document" && !schema.kinds.document) {
      entity.kind = "item";
      delete entity.updated_at;
      changed = true;
    }
    if (changed) transformed += 1;
    return entity;
  });
  try {
    return { entities: validateEntitySet(input, schema), transformed };
  } catch (error) {
    throw new Error(`configuration cannot be applied without changing saved data: ${error.message}. Restore the definition or explicitly migrate the affected records; no data changed.`);
  }
}

function plan(db, schema) {
  const binding = readSchemaBinding(db);
  if (!binding) throw new Error("unbound existing database; use an explicit registry import to recover it");
  const oldSchema = previousSchema(db, binding);
  if (oldSchema && oldSchema.hash !== binding.preset_hash) throw new Error("stored model does not match the database binding");
  const rows = db.prepare("SELECT id, name, kind, data, updated_at FROM entities ORDER BY id").all();
  const entities = rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, ...JSON.parse(row.data), updated_at: row.updated_at }));
  return { binding, ...migrateEntities(entities, binding, oldSchema, schema) };
}

export async function initializeRegistry(config, schema, { dryRun = false } = {}) {
  if (!existsSync(config.databasePath)) {
    if (dryRun) return { created: true, count: 0, transformed: 0 };
    await initDb(config.databasePath, schema);
    return { created: true, count: 0, transformed: 0 };
  }
  const db = openDatabase(config.databasePath);
  try {
    return await withWriteTransaction(db, async () => {
      const result = plan(db, schema);
      if (dryRun) return { count: result.entities.length, transformed: result.transformed, adopted: result.binding.preset_hash !== schema.hash };
      const adopted = result.binding.preset_hash !== schema.hash;
      if (adopted && existsSync(config.draftPath)) throw new Error(`active draft at ${config.draftPath}; finish or preserve it before applying new definitions`);
      const backupPath = await backupDatabase(config.databasePath, config);
      db.exec(schemaSql);
      await replaceEntities(result.entities, db, schema);
      return { count: result.entities.length, transformed: result.transformed, adopted, backupPath };
    });
  } finally {
    db.close();
  }
}
