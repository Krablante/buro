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
  openDatabase,
  replaceEntities,
  schemaSql,
  updateEntity as updateDbEntity,
  withWriteTransaction,
} from "./db.js";
import { entityPacket, renderPacket } from "./packet.js";
import { loadSchema, normalizeEntity } from "./schema.js";

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
    schema: options.schema || loadSchema(options.schemaPath || config.schemaPath),
  };
}

async function backupBeforeMutation(config) {
  return backupDatabase(config.databasePath, {
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
  });
}

function contextKeys(entity, schema) {
  return [...new Set([entity.id, ...(entity[schema.context.alias_field] || [])].map(contextKey).filter(Boolean))];
}

function contextMatches(entity, value, schema) {
  return contextKeys(entity, schema).includes(contextKey(value));
}

async function validateReferences(entity, config) {
  for (const fieldName of config.schema.kinds[entity.kind].fields) {
    const field = config.schema.fields[fieldName];
    if (field.type !== "ref" || !field.target_kind || entity[fieldName] === undefined) continue;
    const target = await getEntity(entity[fieldName], config.database, config.schema);
    if (!target) throw conflict(`${fieldName} references missing entity: ${entity[fieldName]}`);
    if (target.kind !== field.target_kind) {
      throw conflict(`${fieldName} must reference ${field.target_kind}, got ${target.kind}: ${target.id}`);
    }
  }
}

async function validateLookupIdentity(entity, config) {
  const entities = await listEntities(config.database, config.schema);
  if (entity.kind === config.schema.context.kind) {
    const candidateKeys = new Set(contextKeys(entity, config.schema));
    for (const existing of entities) {
      if (existing.id === entity.id) continue;
      if (candidateKeys.has(contextKey(existing.id))) {
        throw conflict(`context name or alias is already used as entity id ${existing.id}`);
      }
      if (existing.kind !== config.schema.context.kind) continue;
      const duplicate = contextKeys(existing, config.schema).find((key) => candidateKeys.has(key));
      if (duplicate) throw conflict(`context name or alias is already used by ${existing.id}: ${duplicate}`);
    }
    return;
  }
  for (const existing of entities) {
    if (existing.kind !== config.schema.context.kind) continue;
    if (contextKeys(existing, config.schema).includes(contextKey(entity.id))) {
      throw conflict(`entity id conflicts with context name or alias ${existing.id}: ${entity.id}`);
    }
  }
}

async function validateNotReferenced(entityId, config) {
  for (const entity of await listEntities(config.database, config.schema)) {
    if (entity.id === entityId) continue;
    for (const fieldName of config.schema.kinds[entity.kind].fields) {
      if (config.schema.fields[fieldName].type === "ref" && entity[fieldName] === entityId) {
        throw conflict(`cannot delete ${entityId}; referenced by ${entity.id}.${fieldName}`);
      }
    }
  }
}

async function resolveContext(value, config) {
  const matches = (await listEntities(config.database, config.schema)).filter((entity) => (
    entity.kind === config.schema.context.kind && contextMatches(entity, value, config.schema)
  ));
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
    for (const fieldName of schema.kinds[entity.kind].fields) {
      const field = schema.fields[fieldName];
      if (field.type !== "ref" || !field.target_kind || entity[fieldName] === undefined) continue;
      const target = byId.get(entity[fieldName]);
      if (!target) throw new Error(`${entity.id}.${fieldName} references missing entity: ${entity[fieldName]}`);
      if (target.kind !== field.target_kind) {
        throw new Error(`${entity.id}.${fieldName} must reference ${field.target_kind}, got ${target.kind}: ${target.id}`);
      }
    }
    if (entity.kind === schema.context.kind) {
      for (const key of contextKeys(entity, schema)) {
        if (contextOwners.has(key)) throw new Error(`context name or alias ${key} is used by ${contextOwners.get(key)} and ${entity.id}`);
        contextOwners.set(key, entity.id);
      }
    }
  }
  for (const entity of entities) {
    if (entity.kind !== schema.context.kind && contextOwners.has(contextKey(entity.id))) {
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

export async function resolveEntity(id, options = {}) {
  const config = resolverConfig(options);
  const entityId = requireId(id);
  return await getEntity(entityId, config.database, config.schema) || resolveContext(entityId, config);
}

export async function resolveEntityPacket(id, options = {}) {
  const config = resolverConfig(options);
  const entity = await resolveEntity(id, config);
  if (!entity) return null;
  const context = entity.kind === config.schema.context.kind
    ? entity
    : entity[config.schema.context.member_field]
      ? await getEntity(entity[config.schema.context.member_field], config.database, config.schema)
      : null;
  const current = await resolveContext(config.currentContext, config);
  return entityPacket(entity, config.schema, current, context);
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
  const entity = normalizeEntity({ ...payload, id: entityId }, baseConfig.schema);
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
  const entity = normalizeEntity({ ...payload, id: entityId }, baseConfig.schema);
  return serializeMutation(() => withWriteTransaction(baseConfig.database, async (database) => {
    const config = { ...baseConfig, database };
    assertSchemaBinding(database, config.schema);
    const existing = await getEntity(entityId, database, config.schema);
    if (!existing) throw conflict(`entity not found: ${entityId}`);
    assertRevision(existing, expected);
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
