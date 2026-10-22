import { existsSync } from "node:fs";
import { mkdir, writeFile, rename, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { assertSupportedDatabase, backupDatabase, openDatabase, readSchemaBinding, readStoredModel, schemaSql, withWriteTransaction, writeSchemaBinding, indexEntity, updateEntity, upgradeEntityOrderIndex } from "./db.js";
import { bundledSchema, entityData, fingerprint, normalizeSchema, rowToEntity, schemaFromTypes, schemaTypes, typeDefinition, loadTypeDefinition } from "./schema.js";
import { validateTypeRecords } from "./resolver.js";

// The only old-model boundary. Expand each saved definition once; v3 never reads
// external type files or combines definitions while operating the registry.
export function upgradeModel(model) {
  if (model.id === "buro" && model.version === 3) return normalizeSchema(model);
  function fieldsWithoutDraftFlags(fields) {
    return Object.fromEntries(Object.entries(fields).map(([name, value]) => {
      const { draft_optional: _, ...field } = value;
      if (field.fields) field.fields = fieldsWithoutDraftFlags(field.fields);
      return [name, field];
    }));
  }
  return schemaFromTypes(Object.entries(model.kinds).map(([id, kind]) => {
    const names = [...new Set([...(kind.field_sets || []).flatMap(set => model.field_sets[set]), ...(kind.fields || [])])];
    return { id, label: kind.label, origin: "custom", fields: fieldsWithoutDraftFlags(Object.fromEntries(names.map(name => [name, kind.definitions?.[name] || model.fields[name]]))) };
  }), model.default_kind);
}

export function registryGeneration(db) {
  const row = db.prepare("SELECT value FROM buro_meta WHERE key='generation'").get();
  if (!row) throw new Error("memory needs upgrading; run buro init");
  return row.value;
}
export function resetGeneration(db) {
  db.prepare("INSERT INTO buro_meta(key,value,updated_at) VALUES('generation',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(randomUUID(), new Date().toISOString());
}

export async function saveConfig(config, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try { if (await readFile(config.configPath, "utf8") === contents) return; } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(path.dirname(config.configPath), { recursive: true, mode: 0o700 });
  const temporary = `${config.configPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, config.configPath);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function initializeRegistry(config, { dryRun = false } = {}) {
  if (config.apiUrl) throw new Error("init requires the device holding the database; clients use api_url and never initialize a second memory");
  const created = !existsSync(config.databasePath);
  if (created && dryRun) return { created, count: 0, schema: bundledSchema() };
  if (created) await mkdir(path.dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const db = openDatabase(config.databasePath, { readOnly: dryRun });
  let initialized = false;
  try {
    const run = async () => {
      assertSupportedDatabase(db);
      const stored = created ? null : readStoredModel(db);
      if (!created && !stored) throw new Error("existing database has no saved definitions; initialize it with BURO v2 and its original definitions before upgrading");
      const current = stored ? upgradeModel(stored) : bundledSchema();
      const types = schemaTypes(current).map(type => {
        if (type.origin !== "builtin") return type;
        const template = loadTypeDefinition(type.id);
        return fingerprint(typeDefinition(current, type.id)) === fingerprint(template) ? type : { ...template, origin: "builtin" };
      });
      const schema = schemaFromTypes(types, current.default_kind);
      const upgraded = !created && readSchemaBinding(db)?.storage_version !== 3;
      const definitionsChanged = schema.hash !== current.hash;
      if (!created && !upgraded && !definitionsChanged) return { created, upgraded, count: db.prepare("SELECT count(*) AS n FROM entities").get().n, schema };
      const count = created ? 0 : db.prepare("SELECT count(*) AS n FROM entities").get().n;
      if (!created) {
        const kinds = Object.keys(schema.kinds);
        const unknown = db.prepare(`SELECT kind FROM entities WHERE kind NOT IN (${kinds.map(() => "?").join(",")}) LIMIT 1`).get(...kinds);
        if (unknown) throw new Error(`record uses an unknown type: ${unknown.kind}`);
        for (const id of kinds) validateTypeRecords(db, id, schema);
      }
      if (!dryRun && (created || upgraded || definitionsChanged)) {
        const backupPath = created ? null : await backupDatabase(config.databasePath, config);
        db.exec(schemaSql);
        if (created || upgraded) upgradeEntityOrderIndex(db);
        writeSchemaBinding(db, schema);
        if (!created) for (const row of db.prepare("SELECT * FROM entities").iterate()) {
          const entity = rowToEntity(row, schema);
          if (!isDeepStrictEqual(JSON.parse(row.data), entityData(entity, schema))) await updateEntity(entity.id, entity, db, schema);
          else indexEntity(db, entity, schema);
        }
        if (created || upgraded) resetGeneration(db);
        return { created, upgraded, count, schema, backupPath };
      }
      return { created, upgraded, count, schema };
    };
    const apply = async () => {
      const result = await run();
      const previous = config.previousConfig;
      const { mode, central_host, preset, schema_path, type_files, default_kind, draft_path, ...settings } = previous;
      // Old central configs used api_url to describe their own server. In v3 it
      // selects remote storage, so retain it only for actual old clients.
      if (["central", "local"].includes(mode)) delete settings.api_url;
      await saveConfig(config, settings);
      return result;
    };
    let result;
    if (dryRun) {
      db.exec("BEGIN");
      try { result = await run(); } finally { db.exec("ROLLBACK"); }
    } else result = await withWriteTransaction(db, apply);
    initialized = true;
    if (!dryRun && result.upgraded && config.instanceRoot && config.stateDir) {
      const previousDraft = config.previousConfig.draft_path || path.join(config.instanceRoot, "BURO_DRAFT.yaml");
      if (existsSync(previousDraft)) {
        const destination = path.join(config.stateDir, "migration", `v2-draft-${Date.now()}.yaml`);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await rename(previousDraft, destination);
        result.preservedDraftPath = destination;
      }
    }
    return result;
  } finally {
    db.close();
    if (created && !initialized) await rm(config.databasePath, { force: true });
  }
}
