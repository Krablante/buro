import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const CORE_FIELDS = ["id", "name", "kind"];
const FIELD_TYPES = new Set(["string", "text", "boolean", "integer", "number", "ref", "string-list", "record", "record-list"]);
const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL("../presets/politia.yaml", import.meta.url));

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateFieldDefinition(name, field) {
  if (!plainObject(field)) {
    throw new Error(`schema field ${name} must be an object`);
  }
  if (!FIELD_TYPES.has(field.type)) {
    throw new Error(`schema field ${name} has unsupported type: ${field.type}`);
  }
  if ((field.type === "record" || field.type === "record-list") && !plainObject(field.fields)) {
    throw new Error(`schema field ${name} requires nested fields`);
  }
  for (const [nestedName, nestedField] of Object.entries(field.fields || {})) {
    validateFieldDefinition(`${name}.${nestedName}`, nestedField);
  }
}

export function normalizeSchema(input, source = "BURO schema") {
  if (!plainObject(input)) {
    throw new Error(`${source} must be a YAML object`);
  }
  const id = requireString(input.id, `${source} id`);
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`${source} version must be a positive integer`);
  }
  if (!plainObject(input.fields) || !plainObject(input.kinds)) {
    throw new Error(`${source} requires fields and kinds objects`);
  }

  for (const name of CORE_FIELDS) {
    if (input.fields[name]) throw new Error(`${source} field ${name} is reserved`);
  }
  for (const [name, field] of Object.entries(input.fields)) {
    validateFieldDefinition(name, field);
  }

  const fieldSets = input.field_sets || {};
  if (!plainObject(fieldSets)) {
    throw new Error(`${source} field_sets must be an object`);
  }
  const kinds = {};
  for (const [kindName, kind] of Object.entries(input.kinds)) {
    if (!plainObject(kind)) {
      throw new Error(`${source} kind ${kindName} must be an object`);
    }
    const fields = [];
    for (const setName of kind.field_sets || []) {
      const values = fieldSets[setName];
      if (!Array.isArray(values)) {
        throw new Error(`${source} kind ${kindName} references unknown field set: ${setName}`);
      }
      fields.push(...values);
    }
    fields.push(...(kind.fields || []));
    const uniqueFields = [...new Set(fields)];
    for (const field of uniqueFields) {
      if (!input.fields[field]) {
        throw new Error(`${source} kind ${kindName} references unknown field: ${field}`);
      }
    }
    kinds[kindName] = { ...kind, fields: uniqueFields };
  }

  const defaultKind = requireString(input.default_kind, `${source} default_kind`);
  if (!kinds[defaultKind]) {
    throw new Error(`${source} default_kind is unknown: ${defaultKind}`);
  }
  const context = input.context || {};
  if (!kinds[context.kind]) {
    throw new Error(`${source} context.kind is unknown: ${context.kind}`);
  }
  for (const required of ["alias_field", "member_field"]) {
    if (!context[required]) throw new Error(`${source} context.${required} is required`);
  }
  for (const [mapping, fieldName] of Object.entries(context)) {
    if (mapping === "kind" || fieldName === undefined || fieldName === null) continue;
    if (!input.fields[fieldName]) throw new Error(`${source} context.${mapping} references unknown field: ${fieldName}`);
  }
  if (!kinds[context.kind].fields.includes(context.alias_field)) {
    throw new Error(`${source} context kind ${context.kind} must include ${context.alias_field}`);
  }
  const member = input.fields[context.member_field];
  if (member.type !== "ref" || member.target_kind !== context.kind) {
    throw new Error(`${source} context.member_field must be a ref targeting ${context.kind}`);
  }
  for (const [name, field] of Object.entries(input.fields)) {
    if (field.type === "ref" && field.target_kind && !kinds[field.target_kind]) {
      throw new Error(`${source} field ${name} targets unknown kind: ${field.target_kind}`);
    }
  }

  return Object.freeze({
    ...input,
    id,
    source,
    default_kind: defaultKind,
    kinds: Object.freeze(kinds),
    core_fields: CORE_FIELDS,
  });
}

export function loadSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  const text = readFileSync(schemaPath, "utf8");
  return normalizeSchema(yaml.load(text), schemaPath);
}

export function kindFields(schema, kind) {
  const definition = schema.kinds[kind];
  if (!definition) {
    throw new Error(`unsupported entity kind: ${kind}`);
  }
  return definition.fields;
}

function normalizeScalar(value, field, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (field.type === "string" || field.type === "text" || field.type === "ref") {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${label} must be a non-empty string`);
    }
    return field.type === "text" ? value : value.trim();
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
    return value;
  }
  if (field.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
    return value;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
    return value;
  }
  return undefined;
}

function normalizeRecord(value, field, label) {
  if (!plainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !field.fields[key]);
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
  const result = {};
  for (const [name, nested] of Object.entries(field.fields)) {
    const normalized = normalizeFieldValue(value[name], nested, `${label}.${name}`);
    if (normalized !== undefined) result[name] = normalized;
    if (nested.required && normalized === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const pair of field.paired_fields || []) {
    if (pair.some((name) => result[name] !== undefined) && pair.some((name) => result[name] === undefined)) {
      throw new Error(`${label}.${pair.join(" and ")} must be provided together`);
    }
  }
  if (!Object.keys(result).length) {
    throw new Error(`${label} must not be empty`);
  }
  return result;
}

export function normalizeFieldValue(value, field, label) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (["string", "text", "boolean", "integer", "number", "ref"].includes(field.type)) {
    return normalizeScalar(value, field, label);
  }
  if (field.type === "string-list") {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
    return value.map((entry, index) => normalizeScalar(entry, { type: "string" }, `${label}[${index}]`));
  }
  if (field.type === "record") {
    return normalizeRecord(value, field, label);
  }
  if (field.type === "record-list") {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
    return value.map((entry, index) => normalizeRecord(entry, field, `${label}[${index}]`));
  }
  throw new Error(`unsupported field type for ${label}: ${field.type}`);
}

export function normalizeEntity(input, schema) {
  if (!plainObject(input)) {
    throw new Error("entity must be an object");
  }
  const id = requireString(input.id, "entity id");
  const name = requireString(input.name || id, "entity name");
  const kind = requireString(input.kind || schema.default_kind, "entity kind");
  const fields = kindFields(schema, kind);
  const allowed = new Set([...CORE_FIELDS, ...fields, "updated_at"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new Error(`unsupported ${kind} field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  const entity = { id, name, kind };
  for (const fieldName of fields) {
    const field = schema.fields[fieldName];
    let value = input[fieldName];
    if (value === undefined && Object.hasOwn(field, "default")) value = field.default;
    const normalized = normalizeFieldValue(value, field, fieldName);
    if (normalized !== undefined) entity[fieldName] = normalized;
    if (field.required && normalized === undefined) throw new Error(`${fieldName} is required`);
  }
  if (input.updated_at) entity.updated_at = String(input.updated_at);
  return entity;
}

export function newEntity(id, kind, schema) {
  const entityKind = kind || schema.default_kind;
  kindFields(schema, entityKind);
  const entity = { id: String(id || "").trim(), name: String(id || "").trim(), kind: entityKind };
  for (const fieldName of kindFields(schema, entityKind)) {
    const field = schema.fields[fieldName];
    if (Object.hasOwn(field, "default")) entity[fieldName] = field.default;
  }
  return entity;
}

export function entityData(entity, schema) {
  const result = {};
  for (const field of kindFields(schema, entity.kind)) {
    if (entity[field] !== undefined) result[field] = entity[field];
  }
  return result;
}

export function rowToEntity(row, schema) {
  if (!row) return null;
  let data;
  try {
    data = JSON.parse(row.data || "{}");
  } catch (error) {
    throw new Error(`invalid JSON stored for entity ${row.id}: ${error.message}`);
  }
  return normalizeEntity({ id: row.id, name: row.name, kind: row.kind, ...data, updated_at: row.updated_at }, schema);
}
