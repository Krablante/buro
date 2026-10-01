import { mkdir } from "node:fs/promises";
import path from "node:path";

import { contextKey, loadConfig } from "./config.js";
import {
  assertSchemaBinding,
  backupDatabase,
  checkDb,
  createEntity as createDbEntity,
  deleteEntity as deleteDbEntity,
  getEntity,
  listEntities,
  listEntityIds,
  listEntitySummaries,
  listMemberSummaries,
  lookupEntities,
  openDatabase,
  replaceEntities,
  schemaSql,
  updateEntity as updateDbEntity,
  withWriteTransaction,
} from "./db.js";
import { entityPacket, renderPacket } from "./packet.js";
import { fieldDefinition, loadSchema, normalizeEntity } from "./schema.js";

let mutationTail = Promise.resolve();

function serializeMutation(task) {
  const run = mutationTail.then(task, task);
  mutationTail = run.catch(() => {});
  return run;
}

function requireId(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("entity id is required");
  return id.trim();
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function resolverConfig(options = {}) {
  const loaded = loadConfig();
  const config = { ...loaded, ...options };
  return {
    ...config,
    database: options.database || options.databasePath || loaded.databasePath,
    databasePath: options.databasePath || loaded.databasePath,
    backupDir: options.backupDir || loaded.backupDir,
    backupRetention: options.backupRetention || loaded.backupRetention,
    currentContext: contextKey(options.currentContext || config.currentContext),
    schema: options.schema || loadSchema(config),
  };
}

async function backupBeforeMutation(config) {
  return backupDatabase(config.databasePath, {
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
  });
}

function contextKeys(entity, schema) {
  return [...new Set([entity.id, ...(entity[schema.context?.alias_field] || [])].map(contextKey).filter(Boolean))];
}

function references(entity, schema) {
  const result = [];
  function walk(value, field, label) {
    if (value === undefined) return;
    if (field.type === "ref") result.push({ id: value, kind: field.target_kind, label });
    if (field.type === "record" || field.type === "record-list") {
      for (const record of field.type === "record-list" ? value : [value]) {
        for (const [name, nested] of Object.entries(field.fields)) walk(record[name], nested, `${label}.${name}`);
      }
    }
  }
  for (const name of schema.kinds[entity.kind].fields) walk(entity[name], fieldDefinition(schema, entity.kind, name), name);
  return result;
}

async function normalizeRecord(payload, config, previous) {
  try { return normalizeEntity(payload, config.schema, { currentContext: config.currentContext, previous }); }
  catch (error) { error.status = 400; throw error; }
}

function contextMatches(entity, value, schema) {
  return contextKeys(entity, schema).includes(contextKey(value));
}

async function validateReferences(entity, config) {
  for (const ref of references(entity, config.schema)) {
    const target = await getEntity(ref.id, config.database, config.schema);
    if (!target) throw conflict(`${ref.label} references missing entity: ${ref.id}`);
    if (ref.kind && target.kind !== ref.kind) {
      throw conflict(`${ref.label} must reference ${ref.kind}, got ${target.kind}: ${target.id}`);
    }
  }
}

async function validateLookupIdentity(entity, config) {
  if (!config.schema.context) return;
  const contexts = await listEntities(config.database, config.schema, { kind: config.schema.context.kind });
  if (entity.kind === config.schema.context.kind) {
    const candidateKeys = new Set(contextKeys(entity, config.schema));
    for (const id of await listEntityIds(config.database, config.schema)) {
      if (id !== entity.id && candidateKeys.has(contextKey(id))) {
        throw conflict(`context name or alias is already used as entity id ${id}`);
      }
    }
    for (const existing of contexts) {
      if (existing.id === entity.id) continue;
      const duplicate = contextKeys(existing, config.schema).find((key) => candidateKeys.has(key));
      if (duplicate) throw conflict(`context name or alias is already used by ${existing.id}: ${duplicate}`);
    }
    return;
  }
  for (const existing of contexts) {
    if (contextKeys(existing, config.schema).includes(contextKey(entity.id))) {
      throw conflict(`entity id conflicts with context name or alias ${existing.id}: ${entity.id}`);
    }
  }
}

async function validateNotReferenced(entityId, config) {
  for (const entity of await listEntities(config.database, config.schema)) {
    if (entity.id === entityId) continue;
    for (const ref of references(entity, config.schema)) {
      if (ref.id === entityId) {
        throw conflict(`cannot delete ${entityId}; referenced by ${entity.id}.${ref.label}`);
      }
    }
  }
}

async function resolveContext(value, config) {
  if (!config.schema.context) return null;
  const exact = await getEntity(value, config.database, config.schema);
  if (exact?.kind === config.schema.context.kind) return exact;
  const matches = (await lookupEntities(value, config.database, config.schema))
    .filter((entity) => entity.kind === config.schema.context.kind)
    .filter((entity) => contextMatches(entity, value, config.schema));
  if (matches.length > 1) throw new Error(`ambiguous current context ${value}: ${matches.map((entity) => entity.id).join(", ")}`);
  return matches[0] || null;
}

export function validateEntitySet(input, schema) {
  const entities = input.map((entity) => normalizeEntity(entity, schema));
  const byId = new Map();
  for (const entity of entities) {
    if (byId.has(entity.id)) throw new Error(`duplicate entity id: ${entity.id}`);
    byId.set(entity.id, entity);
  }
  const contextOwners = new Map();
  for (const entity of entities) {
    for (const ref of references(entity, schema)) {
      const target = byId.get(ref.id);
      if (!target) throw new Error(`${entity.id}.${ref.label} references missing entity: ${ref.id}`);
      if (ref.kind && target.kind !== ref.kind) {
        throw new Error(`${entity.id}.${ref.label} must reference ${ref.kind}, got ${target.kind}: ${target.id}`);
      }
    }
    if (entity.kind === schema.context?.kind) {
      for (const key of contextKeys(entity, schema)) {
        if (contextOwners.has(key)) throw new Error(`context name or alias ${key} is used by ${contextOwners.get(key)} and ${entity.id}`);
        contextOwners.set(key, entity.id);
      }
    }
  }
  for (const entity of entities) {
    if (entity.kind !== schema.context?.kind && contextOwners.has(contextKey(entity.id))) {
      throw new Error(`entity id ${entity.id} conflicts with context name or alias owned by ${contextOwners.get(contextKey(entity.id))}`);
    }
  }
  return entities;
}

export async function replaceRegistryRecords(input, options = {}) {
  const config = resolverConfig(options);
  const entities = validateEntitySet(input, config.schema);
  return serializeMutation(async () => {
    await mkdir(path.dirname(config.databasePath), { recursive: true });
    const database = openDatabase(config.databasePath);
    try {
      database.exec(schemaSql);
      return await withWriteTransaction(database, async (db) => {
        const previousCount = db.prepare("SELECT count(*) AS count FROM entities").get().count;
        const backupPath = previousCount > 0
          ? await backupDatabase(config.databasePath, {
            backupDir: config.backupDir,
            backupRetention: config.backupRetention,
          })
          : null;
        await replaceEntities(entities, db, config.schema);
        return { count: entities.length, previousCount, backupPath };
      });
    } finally {
      database.close();
    }
  });
}

export async function resolveHealth(options = {}) {
  const config = resolverConfig(options);
  return {
    ...(await checkDb(config.database)),
    preset: config.schema.id,
    preset_version: config.schema.version,
    preset_hash: config.schema.hash,
    central_host: config.centralHost,
    current_context: config.currentContext,
  };
}

export async function resolveSchema(options = {}) {
  return resolverConfig(options).schema;
}

export async function resolveEntities(options = {}) {
  const config = resolverConfig(options);
  return listEntities(config.database, config.schema);
}

export async function resolveEntitySummaries(kind, options = {}) {
  const config = resolverConfig(options);
  if (kind && !config.schema.kinds[kind]) throw new Error(`unsupported entity kind: ${kind}`);
  const context = await resolveContext(config.currentContext, config);
  return {
    entities: await listEntitySummaries(config.database, config.schema, kind, options),
    current_context: context?.id || null,
  };
}

export async function resolveEntity(id, options = {}) {
  const config = resolverConfig(options);
  const entityId = requireId(id);
  const exact = await getEntity(entityId, config.database, config.schema);
  if (exact) return exact;
  const matches = await lookupEntities(entityId, config.database, config.schema);
  if (matches.length > 1) throw conflict(`ambiguous name ${entityId}; choose an id: ${matches.map((entity) => entity.id).join(", ")}`);
  return matches[0] || null;
}

export async function resolveEntityPacket(id, options = {}) {
  const config = resolverConfig(options);
  const entity = await resolveEntity(id, config);
  if (!entity) return null;
  const member = config.schema.context && entity[config.schema.context.member_field];
  const machine = Array.isArray(member) ? member.find((location) => location.host)?.host : member;
  const context = entity.kind === config.schema.context?.kind
    ? entity
    : machine
      ? await resolveContext(machine, config)
      : null;
  const current = await resolveContext(config.currentContext, config);
  return entityPacket(entity, config.schema, current, context);
}

export async function resolveCurrentContext(options = {}) {
  const config = resolverConfig(options);
  const context = await resolveContext(config.currentContext, config);
  const rootField = config.schema.context?.root_field;
  return {
    context: { id: context?.id || config.currentContext, ...(context && rootField && context[rootField] !== undefined ? { [rootField]: context[rootField] } : {}) },
    packet: context ? entityPacket(context, config.schema, context, context) : null,
    members: options.brief ? [] : await listMemberSummaries(context?.id || config.currentContext, config.database, config.schema, context ? contextKeys(context, config.schema) : []),
  };
}

function assertMatchingId(id, payload) {
  const entityId = requireId(id);
  if (payload?.id && requireId(payload.id) !== entityId) {
    throw new Error(`entity id mismatch: route id is ${entityId}, payload id is ${payload.id}`);
  }
  return entityId;
}

function requireRevision(value) {
  if (typeof value !== "string" || !value.trim()) throw conflict("entity revision is required; pull a fresh draft before changing it");
  return value.trim();
}

function assertRevision(existing, expected) {
  if (existing.updated_at !== expected) {
    throw conflict(`entity changed after this draft was created: ${existing.id}; pull a fresh draft and review again`);
  }
}

function sameEntity(left, right) {
  const { updated_at: _leftRevision, ...leftFacts } = left;
  const { updated_at: _rightRevision, ...rightFacts } = right;
  return JSON.stringify(leftFacts) === JSON.stringify(rightFacts);
}

export async function createEntityRecord(id, payload = {}, options = {}) {
  const baseConfig = resolverConfig(options);
  const entityId = assertMatchingId(id, payload);
  const entity = await normalizeRecord({ ...payload, id: entityId }, baseConfig);
  return serializeMutation(() => withWriteTransaction(baseConfig.database, async (database) => {
    const config = { ...baseConfig, database };
    assertSchemaBinding(database, config.schema);
    if (await getEntity(entityId, database, config.schema)) throw conflict(`entity already exists: ${entityId}`);
    await validateReferences(entity, config);
    await validateLookupIdentity(entity, config);
    await backupBeforeMutation(config);
    return createDbEntity(entity, database, config.schema);
  }));
}

export async function updateEntityRecord(id, payload = {}, options = {}) {
  const baseConfig = resolverConfig(options);
  const entityId = assertMatchingId(id, payload);
  const expected = requireRevision(options.expectedUpdatedAt);
  return serializeMutation(() => withWriteTransaction(baseConfig.database, async (database) => {
    const config = { ...baseConfig, database };
    assertSchemaBinding(database, config.schema);
    const existing = await getEntity(entityId, database, config.schema);
    if (!existing) throw conflict(`entity not found: ${entityId}`);
    assertRevision(existing, expected);
    const entity = await normalizeRecord({ ...payload, id: entityId }, config, existing);
    if (sameEntity(existing, entity)) return existing;
    await validateReferences(entity, config);
    await validateLookupIdentity(entity, config);
    await backupBeforeMutation(config);
    return updateDbEntity(entityId, entity, database, config.schema);
  }));
}

export async function deleteEntityRecord(id, options = {}) {
  const baseConfig = resolverConfig(options);
  const entityId = requireId(id);
  const expected = requireRevision(options.expectedUpdatedAt);
  return serializeMutation(() => withWriteTransaction(baseConfig.database, async (database) => {
    const config = { ...baseConfig, database };
    assertSchemaBinding(database, config.schema);
    const existing = await getEntity(entityId, database, config.schema);
    if (!existing) throw conflict(`entity not found: ${entityId}`);
    assertRevision(existing, expected);
    await validateNotReferenced(entityId, config);
    await backupBeforeMutation(config);
    return deleteDbEntity(entityId, database, config.schema);
  }));
}

export async function resolvePacketText(id, options = {}) {
  const packet = await resolveEntityPacket(id, options);
  return packet ? renderPacket(packet) : null;
}
