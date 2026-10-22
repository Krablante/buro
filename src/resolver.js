import { loadConfig } from "./config.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { assertSchemaBinding, backupDatabase, checkDb, createEntity, deleteEntity, findEntityMatching, getEntity, indexEntity, listEntities, listEntitySummaries, listMemberSummaries, lookupEntities, openDatabase, updateEntity, withWriteTransaction, writeSchemaBinding } from "./db.js";
import { entityPacket, renderPacket } from "./packet.js";
import { entityData, fieldDefinition, fingerprint, loadSchema, normalizeEntity, normalizeType, rowToEntity, schemaFromTypes, schemaTypes, typeDefinition } from "./schema.js";
import { registryGeneration } from "./migration.js";

let mutationTail = Promise.resolve();
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export function serializeMutation(task) {
  const result = mutationTail.then(task, task);
  mutationTail = result.catch(() => {});
  return result;
}
export function conflict(message) { const error = new Error(message); error.status = 409; return error; }
function optionsFor(options) {
  const config = { ...loadConfig(), ...options };
  return { ...config, database: options.database || config.databasePath, schema: options.schema || loadSchema(config) };
}

function references(entity, schema) {
  const result = [];
  function walk(value, field, label) {
    if (value === undefined) return;
    if (field.type === "ref") result.push({ id: value, kind: field.target_kind, label });
    if (["record", "record-list"].includes(field.type)) for (const record of field.type === "record" ? [value] : value) for (const [name, nested] of Object.entries(field.fields)) walk(record[name], nested, `${label}.${name}`);
  }
  for (const name of schema.kinds[entity.kind].fields) walk(entity[name], fieldDefinition(schema, entity.kind, name), name);
  return result;
}

export function validateEntitySet(input, schema) {
  const entities = input.map(entity => normalizeEntity(entity, schema, { allowExistingPaths: true }));
  const byId = new Map();
  for (const entity of entities) {
    if (byId.has(entity.id)) throw new Error(`duplicate record id: ${entity.id}`);
    byId.set(entity.id, entity);
  }
  for (const entity of entities) for (const ref of references(entity, schema)) {
    const target = byId.get(ref.id);
    if (!target) throw new Error(`${entity.id}.${ref.label} references missing record: ${ref.id}`);
    if (ref.kind && target.kind !== ref.kind) throw new Error(`${entity.id}.${ref.label} requires ${ref.kind}: ${ref.id}`);
  }
  return entities;
}

async function incomingReferences(id, nextKind, config) {
  const incompatible = field => (field.type === "ref" && (!nextKind || (field.target_kind && field.target_kind !== nextKind))) || Object.values(field.fields || {}).some(incompatible);
  const kinds = Object.keys(config.schema.kinds).filter(kind => Object.values(config.schema.kinds[kind].definitions).some(incompatible));
  const owner = await findEntityMatching(config.database, config.schema, kinds, entity => entity.id !== id && references(entity, config.schema).some(ref => ref.id === id && (!nextKind || (ref.kind && ref.kind !== nextKind))));
  if (owner) throw conflict(`${id} is referenced by ${owner.id}; update that ref before deleting or changing its type`);
}

async function resolveContext(value, config) {
  if (!config.schema.kinds.host) return null;
  const exact = await getEntity(value, config.database, config.schema);
  if (exact?.kind === "host") return exact;
  const matches = await lookupEntities(value, config.database, config.schema, "host");
  if (matches.length > 1) throw conflict(`ambiguous device ${value}; configure its exact record ID`);
  return matches[0] ? getEntity(matches[0].id, config.database, config.schema) : null;
}

export async function resolveHealth(options = {}) {
  const config = optionsFor(options);
  return { ...(await checkDb(config.database, config.schema)), version: PACKAGE_VERSION, current_context: config.currentContext };
}
export async function resolveSchema(options = {}) { return optionsFor(options).schema; }
export async function resolveEntities(options = {}) { const config = optionsFor(options); return listEntities(config.database, config.schema); }
export async function resolveEntitySummaries(kind, options = {}) {
  const config = optionsFor(options);
  if (kind && !Object.hasOwn(config.schema.kinds, kind)) throw new Error(`unknown type: ${kind}`);
  return { entities: await listEntitySummaries(config.database, config.schema, kind, options), current_context: config.currentContext };
}
export async function resolveEntity(id, options = {}) {
  const config = optionsFor(options);
  const exact = await getEntity(id, config.database, config.schema);
  if (exact || options.exact) return exact;
  const matches = await lookupEntities(id, config.database, config.schema);
  if (matches.length > 1) throw conflict(`ambiguous name ${id}; choose an ID: ${matches.slice(0, 100).map(entity => entity.id).join(", ")}${matches.length > 100 ? " (first 100; use search to narrow)" : ""}`);
  return matches[0] ? getEntity(matches[0].id, config.database, config.schema) : null;
}
export async function resolveEntityPacket(id, options = {}) {
  const config = optionsFor(options);
  const entity = await resolveEntity(id, config);
  return entity ? entityPacket(entity, config.schema) : null;
}
export async function resolvePacketText(id, options = {}) {
  const packet = await resolveEntityPacket(id, options);
  return packet ? renderPacket(packet) : null;
}
export async function resolveCurrentContext(options = {}) {
  const config = optionsFor(options);
  const host = await resolveContext(config.currentContext, config);
  const aliases = host && fieldDefinition(config.schema, host.kind, "aliases")?.type === "string-list" ? host.aliases || [] : [];
  const limit = config.currentLimit;
  const members = await listMemberSummaries(host?.id || config.currentContext, config.database, config.schema, aliases, limit);
  return { context: { id: host?.id || config.currentContext }, packet: host ? entityPacket(host, config.schema) : null, members: members.slice(0, limit), truncated: members.length > limit, limit };
}

function assertFresh(metadata, schema, kinds) {
  if (metadata.generation !== schema.generation) throw conflict("memory was replaced or restored; prepare a new draft");
  for (const kind of kinds) if (!schema.kinds[kind] || metadata.type_revisions?.[kind] !== schema.kinds[kind].revision) throw conflict(`type changed since this draft was created: ${kind}; prepare a new draft`);
}

function valueContract(fields) {
  return Object.fromEntries(Object.entries(fields).map(([name, definition]) => {
    const { guide, section, packet, ...field } = definition;
    if (field.fields) field.fields = valueContract(field.fields);
    return [name, field];
  }));
}

export function validateTypeRecords(db, id, schema) {
  const targetKind = db.prepare("SELECT kind FROM entities WHERE id=?");
  for (const row of db.prepare("SELECT * FROM entities WHERE kind=? ORDER BY id").iterate(id)) {
    const entity = rowToEntity(row, schema);
    for (const ref of references(entity, schema)) {
      const target = targetKind.get(ref.id);
      if (!target || (ref.kind && ref.kind !== target.kind)) throw conflict(`${entity.id}.${ref.label} requires an existing ${ref.kind || "record"}: ${ref.id}`);
    }
  }
}

// CLI and HTTP preview and apply the same operation. Validation runs inside the
// SQLite transaction, using definitions read after the lock was acquired.
export async function applyChange(change, options = {}) {
  return serializeMutation(async () => {
    const loaded = { ...loadConfig(), ...options };
    const owned = !loaded.database || typeof loaded.database.prepare !== "function";
    const database = owned ? openDatabase(loaded.databasePath, { mustExist: true }) : loaded.database;
    try {
      return await withWriteTransaction(database, async db => {
        const schema = { ...loadSchema({ ...loaded, database: db }), generation: registryGeneration(db) };
        assertSchemaBinding(db, schema);
        const config = { ...loaded, database: db, schema };
        const { metadata, value } = change;
        if (!metadata || metadata.version !== 3 || !["record", "type"].includes(metadata.subject) || !["create", "update", "delete"].includes(metadata.mode)) throw new Error("invalid v3 draft metadata");
        if (metadata.subject === "type") {
          assertFresh(metadata, schema, []);
          const id = metadata.base_id;
          const existing = schema.kinds[id];
          if (metadata.mode === "create" ? existing : !existing || existing.revision !== metadata.base_revision) throw conflict(`type already exists, was removed, or changed: ${id}; prepare a new draft`);
          if (existing?.origin === "builtin") throw new Error(`copy bundled ${id} to a new ID with types new --from; bundled definitions cannot be edited or deleted`);
          if (metadata.mode !== "delete" && value.id !== id) throw new Error("type ID cannot change");
          const definition = metadata.mode === "delete" ? null : normalizeType(value);
          const replacement = definition ? { ...definition, origin: "custom", revision: randomUUID() } : null;
          const types = schemaTypes(schema).flatMap(type => type.id === id ? replacement ? [replacement] : [] : [type]);
          if (!existing && replacement) types.push(replacement);
          const next = schemaFromTypes(types, schema.default_kind === id && !definition ? types[0]?.id : schema.default_kind);
          const before = existing ? typeDefinition(schema, id) : null;
          const unchanged = JSON.stringify(before) === JSON.stringify(definition);
          if (!definition && db.prepare("SELECT 1 FROM entities WHERE kind=? LIMIT 1").get(id)) throw conflict(`type is still used by saved records: ${id}`);
          const valuesChanged = Boolean(existing && definition && fingerprint(valueContract(existing.definitions)) !== fingerprint(valueContract(definition.fields)));
          if (valuesChanged) validateTypeRecords(db, id, next);
          if (!options.dryRun && !unchanged) {
            await backupDatabase(loaded.databasePath, loaded);
            writeSchemaBinding(db, next);
            if (valuesChanged) for (const row of db.prepare("SELECT * FROM entities WHERE kind=? ORDER BY id").iterate(id)) {
              const entity = rowToEntity(row, next);
              if (!isDeepStrictEqual(JSON.parse(row.data), entityData(entity, next))) await updateEntity(entity.id, entity, db, next);
              else indexEntity(db, entity, next);
            }
          }
          return { id, before, after: definition, action: unchanged ? "unchanged" : metadata.mode, default_kind: next.default_kind };
        }
        const id = metadata.base_id;
        const existing = await getEntity(id, db, schema);
        const kinds = new Set([existing?.kind, value?.kind].filter(Boolean));
        assertFresh(metadata, schema, kinds);
        if (metadata.mode === "create") {
          if (existing) throw conflict(`record already exists: ${id}`);
          if (db.prepare("SELECT 1 FROM retired_ids WHERE id=?").get(id)) throw conflict(`ID belongs to a deleted record: ${id}; use a new ID or restore a backup`);
        } else if (!existing || existing.updated_at !== metadata.base_revision) throw conflict(`record changed or was removed: ${id}; prepare a new draft`);
        if (metadata.mode !== "delete" && value?.id !== id) throw new Error("record ID is permanent and cannot change");
        const entity = metadata.mode === "delete" ? null : normalizeEntity(value, schema, { currentContext: loaded.currentContext, previous: existing });
        if (!entity || (existing && existing.kind !== entity.kind)) await incomingReferences(id, entity?.kind, config);
        if (entity) for (const ref of references(entity, schema)) {
          const target = ref.id === entity.id ? entity : await getEntity(ref.id, db, schema);
          if (!target || (ref.kind && target.kind !== ref.kind)) throw conflict(`${ref.label} requires an existing ${ref.kind || "record"}: ${ref.id}`);
        }
        const facts = value => { if (!value) return null; const { updated_at, ...rest } = value; return rest; };
        const unchanged = JSON.stringify(facts(existing)) === JSON.stringify(facts(entity));
        if (!options.dryRun && !unchanged) {
          await backupDatabase(loaded.databasePath, loaded);
          if (!entity) await deleteEntity(id, db, schema);
          else if (!existing) await createEntity(entity, db, schema);
          else await updateEntity(id, entity, db, schema);
        }
        return { id, before: facts(existing), after: facts(entity), action: unchanged ? "unchanged" : metadata.mode };
      });
    } finally { if (owned) database.close(); }
  });
}
