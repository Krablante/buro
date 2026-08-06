import { canonicalHost, loadConfig } from "./config.js";
import {
  backupDatabase,
  checkDb,
  createEntity as createDbEntity,
  deleteEntity as deleteDbEntity,
  getEntity,
  listEntities,
  updateEntity as updateDbEntity,
} from "./db.js";
import { entityPacket, renderPacket } from "./packet.js";
import { loadSchema, normalizeEntity } from "./schema.js";

function requireId(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("entity id is required");
  return id.trim();
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
    currentHost: canonicalHost(options.currentHost || config.currentHost),
    schema: options.schema || loadSchema(options.schemaPath || config.schemaPath),
  };
}

async function backupBeforeMutation(config) {
  return backupDatabase(config.database, {
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
  });
}

async function validateReferences(entity, config) {
  for (const fieldName of config.schema.kinds[entity.kind].fields) {
    const field = config.schema.fields[fieldName];
    if (field.type !== "ref" || !field.target_kind || entity[fieldName] === undefined) continue;
    const target = await getEntity(entity[fieldName], config.database, config.schema);
    if (!target) throw new Error(`${fieldName} references missing entity: ${entity[fieldName]}`);
    if (target.kind !== field.target_kind) {
      throw new Error(`${fieldName} must reference ${field.target_kind}, got ${target.kind}: ${target.id}`);
    }
  }
}

async function validateNotReferenced(entityId, config) {
  for (const entity of await listEntities(config.database, config.schema)) {
    if (entity.id === entityId) continue;
    for (const fieldName of config.schema.kinds[entity.kind].fields) {
      if (config.schema.fields[fieldName].type === "ref" && entity[fieldName] === entityId) {
        throw new Error(`cannot delete ${entityId}; referenced by ${entity.id}.${fieldName}`);
      }
    }
  }
}

function contextAlias(entity, value, schema) {
  const candidate = canonicalHost(value);
  if (canonicalHost(entity.id) === candidate) return true;
  return (entity[schema.context.alias_field] || []).some((alias) => (
    canonicalHost(String(alias).split(":", 1)[0]) === candidate
  ));
}

async function resolveContext(value, config) {
  return (await listEntities(config.database, config.schema)).find((entity) => (
    entity.kind === config.schema.context.kind && contextAlias(entity, value, config.schema)
  )) || null;
}

export async function resolveHealth(options = {}) {
  const config = resolverConfig(options);
  return {
    ...(await checkDb(config.database)),
    preset: config.schema.id,
    preset_version: config.schema.version,
    central_host: config.centralHost,
    current_host: config.currentHost,
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
  const current = await resolveContext(config.currentHost, config);
  return entityPacket(entity, config.schema, current, context);
}

function assertMatchingId(id, payload) {
  const entityId = requireId(id);
  if (payload?.id && requireId(payload.id) !== entityId) {
    throw new Error(`entity id mismatch: route id is ${entityId}, payload id is ${payload.id}`);
  }
  return entityId;
}

export async function createEntityRecord(id, payload = {}, options = {}) {
  const config = resolverConfig(options);
  const entityId = assertMatchingId(id, payload);
  const entity = normalizeEntity({ ...payload, id: entityId }, config.schema);
  await validateReferences(entity, config);
  await backupBeforeMutation(config);
  return createDbEntity(entity, config.database, config.schema);
}

export async function updateEntityRecord(id, payload = {}, options = {}) {
  const config = resolverConfig(options);
  const entityId = assertMatchingId(id, payload);
  const entity = normalizeEntity({ ...payload, id: entityId }, config.schema);
  await validateReferences(entity, config);
  await backupBeforeMutation(config);
  return updateDbEntity(entityId, entity, config.database, config.schema);
}

export async function deleteEntityRecord(id, options = {}) {
  const config = resolverConfig(options);
  const entityId = requireId(id);
  await validateNotReferenced(entityId, config);
  await backupBeforeMutation(config);
  return deleteDbEntity(entityId, config.database);
}

export async function resolvePacketText(id, options = {}) {
  const packet = await resolveEntityPacket(id, options);
  return packet ? renderPacket(packet) : null;
}
