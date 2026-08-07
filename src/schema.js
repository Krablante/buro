import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const CORE_FIELDS = ["id", "name", "kind"];
const RESERVED_FIELDS = new Set([...CORE_FIELDS, "updated_at", "__buro"]);
const FIELD_TYPES = new Set(["string", "text", "boolean", "integer", "number", "ref", "string-list", "record", "record-list"]);
const TOP_LEVEL_KEYS = new Set(["id", "version", "default_kind", "context", "sections", "field_sets", "kinds", "fields"]);
const KIND_KEYS = new Set(["label", "field_sets", "fields"]);
const FIELD_KEYS = new Set(["type", "target_kind", "section", "guide", "fields", "paired_fields", "required", "default", "packet", "draft_optional"]);
const CONTEXT_KEYS = new Set(["kind", "alias_field", "member_field", "root_field"]);
const SECTION_KEYS = new Set(["guide", "draft_guide"]);
const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL("../presets/starter.yaml", import.meta.url));

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function requireSingleLine(value, label) {
  const text = requireString(value, label);
  if (/\r|\n/.test(text)) throw new Error(`${label} must be a single line`);
  return text;
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${label} must be a list of non-empty strings`);
  }
  return value.map((entry) => entry.trim());
}

function validateFieldDefinition(name, field) {
  if (!plainObject(field)) throw new Error(`schema field ${name} must be an object`);
  rejectUnknownKeys(field, FIELD_KEYS, `schema field ${name}`);
  if (!FIELD_TYPES.has(field.type)) throw new Error(`schema field ${name} has unsupported type: ${field.type}`);
  for (const flag of ["required", "packet", "draft_optional"]) {
    if (field[flag] !== undefined && typeof field[flag] !== "boolean") {
      throw new Error(`schema field ${name}.${flag} must be a boolean`);
    }
  }
  for (const text of ["section", "target_kind"]) {
    if (field[text] !== undefined) requireString(field[text], `schema field ${name}.${text}`);
  }
  if (field.guide !== undefined) requireSingleLine(field.guide, `schema field ${name}.guide`);
  if (field.target_kind !== undefined && field.type !== "ref") {
    throw new Error(`schema field ${name}.target_kind is valid only for ref fields`);
  }
  const isRecord = field.type === "record" || field.type === "record-list";
  if (isRecord && !plainObject(field.fields)) throw new Error(`schema field ${name} requires nested fields`);
  if (!isRecord && field.fields !== undefined) throw new Error(`schema field ${name}.fields is valid only for record fields`);
  for (const [nestedName, nestedField] of Object.entries(field.fields || {})) {
    validateFieldDefinition(`${name}.${nestedName}`, nestedField);
  }
  if (field.paired_fields !== undefined) {
    if (!isRecord || !Array.isArray(field.paired_fields)) {
      throw new Error(`schema field ${name}.paired_fields is valid only for record fields`);
    }
    for (const [index, pair] of field.paired_fields.entries()) {
      const names = requireStringArray(pair, `schema field ${name}.paired_fields[${index}]`);
      if (names.length < 2 || names.some((nestedName) => !field.fields[nestedName])) {
        throw new Error(`schema field ${name}.paired_fields[${index}] must reference at least two declared nested fields`);
      }
    }
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function modelField(field) {
  return Object.fromEntries(Object.entries(field).flatMap(([key, value]) => {
    if (key === "guide") return [];
    if (key === "fields") {
      return [[key, Object.fromEntries(Object.entries(value).map(([name, nested]) => [name, modelField(nested)]))]];
    }
    return [[key, value]];
  }));
}

function schemaHash(schema) {
  const canonical = stableValue({
    id: schema.id,
    version: schema.version,
    default_kind: schema.default_kind,
    context: schema.context,
    field_sets: schema.field_sets,
    kinds: schema.kinds,
    fields: Object.fromEntries(Object.entries(schema.fields).map(([name, field]) => [name, modelField(field)])),
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function normalizeSchema(input, source = "BURO schema") {
  if (!plainObject(input)) throw new Error(`${source} must be a YAML object`);
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, source);
  const id = requireString(input.id, `${source} id`);
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`${source} version must be a positive integer`);
  }
  if (!plainObject(input.fields) || !plainObject(input.kinds) || !Object.keys(input.kinds).length) {
    throw new Error(`${source} requires non-empty fields and kinds objects`);
  }

  const fields = {};
  for (const name of RESERVED_FIELDS) {
    if (input.fields[name]) throw new Error(`${source} field ${name} is reserved`);
  }
  for (const [name, field] of Object.entries(input.fields)) {
    validateFieldDefinition(name, field);
    fields[name] = field;
  }

  const sections = input.sections || {};
  if (!plainObject(sections)) throw new Error(`${source} sections must be an object`);
  for (const [name, section] of Object.entries(sections)) {
    if (!plainObject(section)) throw new Error(`${source} section ${name} must be an object`);
    rejectUnknownKeys(section, SECTION_KEYS, `${source} section ${name}`);
    requireSingleLine(section.guide, `${source} section ${name}.guide`);
    if (section.draft_guide !== undefined) requireSingleLine(section.draft_guide, `${source} section ${name}.draft_guide`);
  }

  const fieldSets = input.field_sets || {};
  if (!plainObject(fieldSets)) throw new Error(`${source} field_sets must be an object`);
  for (const [setName, values] of Object.entries(fieldSets)) {
    fieldSets[setName] = requireStringArray(values, `${source} field_sets.${setName}`);
  }

  const kinds = {};
  for (const [kindName, kind] of Object.entries(input.kinds)) {
    if (!plainObject(kind)) throw new Error(`${source} kind ${kindName} must be an object`);
    rejectUnknownKeys(kind, KIND_KEYS, `${source} kind ${kindName}`);
    if (kind.label !== undefined) requireString(kind.label, `${source} kind ${kindName}.label`);
    const setNames = kind.field_sets === undefined ? [] : requireStringArray(kind.field_sets, `${source} kind ${kindName}.field_sets`);
    const directFields = kind.fields === undefined ? [] : requireStringArray(kind.fields, `${source} kind ${kindName}.fields`);
    const kindFieldNames = [];
    for (const setName of setNames) {
      const values = fieldSets[setName];
      if (!values) throw new Error(`${source} kind ${kindName} references unknown field set: ${setName}`);
      kindFieldNames.push(...values);
    }
    kindFieldNames.push(...directFields);
    const uniqueFields = [...new Set(kindFieldNames)];
    for (const fieldName of uniqueFields) {
      if (!fields[fieldName]) throw new Error(`${source} kind ${kindName} references unknown field: ${fieldName}`);
    }
    kinds[kindName] = { ...(kind.label ? { label: kind.label } : {}), field_sets: setNames, fields: uniqueFields };
  }

  const defaultKind = requireString(input.default_kind, `${source} default_kind`);
  if (!kinds[defaultKind]) throw new Error(`${source} default_kind is unknown: ${defaultKind}`);
  if (!plainObject(input.context)) throw new Error(`${source} context must be an object`);
  rejectUnknownKeys(input.context, CONTEXT_KEYS, `${source} context`);
  const context = {
    kind: requireString(input.context.kind, `${source} context.kind`),
    alias_field: requireString(input.context.alias_field, `${source} context.alias_field`),
    member_field: requireString(input.context.member_field, `${source} context.member_field`),
    ...(input.context.root_field ? { root_field: requireString(input.context.root_field, `${source} context.root_field`) } : {}),
  };
  if (!kinds[context.kind]) throw new Error(`${source} context.kind is unknown: ${context.kind}`);
  const alias = fields[context.alias_field];
  if (!alias || alias.type !== "string-list" || !kinds[context.kind].fields.includes(context.alias_field)) {
    throw new Error(`${source} context.alias_field must be a string-list on ${context.kind}`);
  }
  const member = fields[context.member_field];
  if (!member || member.type !== "ref" || member.target_kind !== context.kind) {
    throw new Error(`${source} context.member_field must be a ref targeting ${context.kind}`);
  }
  if (context.root_field) {
    const root = fields[context.root_field];
    if (!root || root.type !== "string" || !kinds[context.kind].fields.includes(context.root_field)) {
      throw new Error(`${source} context.root_field must be a string on ${context.kind}`);
    }
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === "ref" && field.target_kind && !kinds[field.target_kind]) {
      throw new Error(`${source} field ${name} targets unknown kind: ${field.target_kind}`);
    }
  }
  for (const sectionName of Object.keys(sections)) {
    if (!Object.values(fields).some((field) => (field.section || "facts") === sectionName)) {
      throw new Error(`${source} section ${sectionName} is not used by any field`);
    }
  }

  const normalized = {
    id,
    version: input.version,
    default_kind: defaultKind,
    context,
    sections,
    field_sets: fieldSets,
    kinds,
    fields,
  };
  for (const [name, field] of Object.entries(fields)) {
    if (Object.hasOwn(field, "default")) normalizeFieldValue(field.default, field, `schema field ${name}.default`);
  }
  return Object.freeze({
    ...normalized,
    source,
    hash: schemaHash(normalized),
    core_fields: CORE_FIELDS,
  });
}

export function loadSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  const text = readFileSync(schemaPath, "utf8");
  return normalizeSchema(yaml.load(text), schemaPath);
}

export function kindFields(schema, kind) {
  const definition = schema.kinds[kind];
  if (!definition) throw new Error(`unsupported entity kind: ${kind}`);
  return definition.fields;
}

function normalizeScalar(value, field, label) {
  if (value === null || value === undefined) return undefined;
  if (field.type === "string" || field.type === "text" || field.type === "ref") {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
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
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !field.fields[key]);
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
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
  if (!Object.keys(result).length) throw new Error(`${label} must not be empty`);
  return result;
}

export function normalizeFieldValue(value, field, label) {
  if (value === null || value === undefined || value === "") return undefined;
  if (["string", "text", "boolean", "integer", "number", "ref"].includes(field.type)) {
    return normalizeScalar(value, field, label);
  }
  if (field.type === "string-list") {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
    return value.map((entry, index) => normalizeScalar(entry, { type: "string" }, `${label}[${index}]`));
  }
  if (field.type === "record") return normalizeRecord(value, field, label);
  if (field.type === "record-list") {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
    return value.map((entry, index) => normalizeRecord(entry, field, `${label}[${index}]`));
  }
  throw new Error(`unsupported field type for ${label}: ${field.type}`);
}

export function normalizeEntity(input, schema, options = {}) {
  if (!plainObject(input)) throw new Error("entity must be an object");
  const id = requireString(input.id, "entity id");
  const name = requireString(input.name || id, "entity name");
  const kind = requireString(input.kind || schema.default_kind, "entity kind");
  const fields = kindFields(schema, kind);
  const allowed = new Set([...CORE_FIELDS, ...fields, "updated_at"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`unsupported ${kind} field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  const entity = { id, name, kind };
  for (const fieldName of fields) {
    const field = schema.fields[fieldName];
    let value = input[fieldName];
    if (value === undefined && Object.hasOwn(field, "default")) value = field.default;
    const normalized = normalizeFieldValue(value, field, fieldName);
    if (normalized !== undefined) entity[fieldName] = normalized;
    if (!options.allowMissingRequired && field.required && normalized === undefined) throw new Error(`${fieldName} is required`);
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
