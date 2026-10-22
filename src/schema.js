import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const CORE = ["id", "name", "kind"];
const FORMATS = new Set(["string", "text", "boolean", "integer", "number", "ref", "string-list", "record", "record-list"]);
const FIELD_KEYS = new Set(["type", "guide", "required", "default", "section", "packet", "fields", "target_kind", "paired_fields"]);
export const object = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function text(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`${label} must be a non-empty single line`);
  return value.trim();
}
function keys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}
function safeKey(value, depth) {
  if (["__proto__", "constructor", "prototype", ...(depth === 0 ? ["__buro", "updated_at", ...CORE] : [])].includes(value)) throw new Error(`reserved field: ${value}`);
}
function canonical(value, parent = "") {
  if (Array.isArray(value)) return value.map(item => canonical(item));
  return object(value) ? Object.fromEntries((parent === "fields" ? Object.keys(value) : Object.keys(value).sort()).map(key => [key, canonical(value[key], key)])) : value;
}
export function fingerprint(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }

function normalizeFields(input, label, depth = 0) {
  if (!object(input)) throw new Error(`${label} must be an object`);
  if (depth > 20) throw new Error("field definitions are nested too deeply");
  const fields = {};
  for (const [name, value] of Object.entries(input)) {
    text(name, "field name"); safeKey(name, depth);
    if (!object(value)) throw new Error(`${label}.${name} must be an object`);
    keys(value, FIELD_KEYS, `${label}.${name}`);
    if (!FORMATS.has(value.type)) throw new Error(`${label}.${name}: unsupported format ${value.type}`);
    const field = structuredClone(value);
    for (const flag of ["required", "packet"]) if (field[flag] !== undefined && typeof field[flag] !== "boolean") throw new Error(`${name}.${flag} must be boolean`);
    for (const key of ["guide", "section", "target_kind"]) if (field[key] !== undefined) text(field[key], `${name}.${key}`);
    if (field.target_kind && field.type !== "ref") throw new Error(`${name}.target_kind requires ref`);
    if (["record", "record-list"].includes(field.type)) {
      field.fields = normalizeFields(field.fields, `${label}.${name}`, depth + 1);
      if (field.paired_fields !== undefined && (!Array.isArray(field.paired_fields) || field.paired_fields.some(pair => !Array.isArray(pair) || pair.length < 2 || pair.some(key => !Object.hasOwn(field.fields, key))))) throw new Error(`${name}.paired_fields must name nested fields`);
    } else if (field.fields !== undefined || field.paired_fields !== undefined) throw new Error(`${name}: nested fields require record or record-list`);
    if (Object.hasOwn(field, "default")) normalizeFieldValue(field.default, field, `${name}.default`);
    fields[name] = field;
  }
  return fields;
}

export function normalizeType(input) {
  if (!object(input)) throw new Error("type must be an object");
  keys(input, new Set(["id", "label", "fields"]), "type");
  const id = text(input.id, "type id");
  if (!/^[a-z][a-z0-9_-]*$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error(`invalid type id: ${id}`);
  return { id, ...(input.label !== undefined ? { label: text(input.label, "type label") } : {}), fields: normalizeFields(input.fields, id) };
}

export function typeDefinition(schema, id) {
  const kind = schema.kinds[id];
  if (!kind) throw new Error(`unknown type: ${id}`);
  return { id, ...(kind.label ? { label: kind.label } : {}), fields: kind.definitions };
}

export function schemaFromTypes(types, defaultKind = types[0]?.id) {
  const kinds = {};
  for (const entry of types) {
    const { origin = "custom", revision, ...input } = entry;
    const definition = normalizeType(input);
    if (Object.hasOwn(kinds, definition.id)) throw new Error(`duplicate type: ${definition.id}`);
    if (!["builtin", "custom"].includes(origin)) throw new Error(`invalid type origin: ${origin}`);
    if (origin === "builtin" && !["project", "service", "host"].includes(definition.id)) throw new Error(`unknown bundled type: ${definition.id}`);
    if (revision !== undefined) text(revision, "type revision");
    kinds[definition.id] = { label: definition.label, origin, revision: revision || fingerprint(definition), fields: Object.keys(definition.fields), definitions: definition.fields };
  }
  if (!Object.hasOwn(kinds, defaultKind)) throw new Error(`default type is missing: ${defaultKind}`);
  function check(field) {
    if (field.target_kind && !Object.hasOwn(kinds, field.target_kind)) throw new Error(`ref targets unknown type: ${field.target_kind}`);
    for (const nested of Object.values(field.fields || {})) check(nested);
  }
  for (const kind of Object.values(kinds)) for (const field of Object.values(kind.definitions)) check(field);
  const host = kinds.host?.definitions;
  const schema = { id: "buro", version: 3, default_kind: defaultKind, kinds, fields: {}, sections: {}, context: host ? { kind: "host", ...(host.aliases?.type === "string-list" ? { alias_field: "aliases" } : {}), member_field: "locations" } : null };
  return { ...schema, hash: fingerprint(schema), core_fields: CORE };
}

export function schemaTypes(schema) {
  return Object.keys(schema.kinds).map(id => ({ ...typeDefinition(schema, id), origin: schema.kinds[id].origin, revision: schema.kinds[id].revision }));
}

export function normalizeSchema(input) {
  if (!object(input) || input.version !== 3 || input.id !== "buro" || !object(input.kinds)) throw new Error("BURO v3 definitions required; run buro init to upgrade");
  return schemaFromTypes(Object.keys(input.kinds).map(id => ({ id, label: input.kinds[id].label, fields: input.kinds[id].definitions, origin: input.kinds[id].origin, revision: input.kinds[id].revision })), input.default_kind);
}

export function loadTypeDefinition(id) {
  if (!["project", "service", "host"].includes(id)) throw new Error(`no bundled type: ${id}`);
  return normalizeType(yaml.load(readFileSync(new URL(`../types/${id}.yaml`, import.meta.url), "utf8")));
}

export function bundledSchema() { return schemaFromTypes(["project", "service", "host"].map(id => ({ ...loadTypeDefinition(id), origin: "builtin" })), "project"); }

export function loadSchema(config) {
  const owned = !config.database || typeof config.database.prepare !== "function";
  const db = owned ? new (require("node:sqlite").DatabaseSync)(config.databasePath, { readOnly: true }) : config.database;
  try {
    const row = db.prepare("SELECT value FROM buro_meta WHERE key = 'model'").get();
    if (!row) throw new Error("memory has no saved definitions; run buro init");
    const schema = normalizeSchema(JSON.parse(row.value));
    const generation = db.prepare("SELECT value FROM buro_meta WHERE key='generation'").get()?.value;
    if (!generation) throw new Error("memory needs upgrading; run buro init");
    return { ...schema, generation };
  } finally { if (owned) db.close(); }
}

export function fieldDefinition(schema, kind, name) { return schema.kinds[kind]?.definitions?.[name]; }
export function kindFields(schema, kind) {
  if (!Object.hasOwn(schema.kinds, kind)) throw new Error(`unknown type: ${kind}`);
  return schema.kinds[kind].fields;
}

export function normalizeFieldValue(value, field, label) {
  if (value === null || value === undefined || value === "") return undefined;
  if (["string", "text", "ref"].includes(field.type)) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return field.type === "text" ? value : value.trim();
  }
  if (field.type === "boolean") { if (typeof value !== "boolean") throw new Error(`${label} must be boolean`); return value; }
  if (["number", "integer"].includes(field.type)) {
    if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "integer" && !Number.isSafeInteger(value))) throw new Error(`${label} must be ${field.type}`);
    return value;
  }
  if (["record-list", "string-list"].includes(field.type)) {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
    return value.map((entry, index) => {
      if (field.type !== "string-list") {
        if (!object(entry)) throw new Error(`${label}[${index}] must be an object`);
        return normalizeFieldValue(entry, { ...field, type: "record" }, `${label}[${index}]`);
      }
      if (typeof entry !== "string" || !entry.trim()) throw new Error(`${label}[${index}] must be a non-empty string`);
      return entry.trim();
    });
  }
  if (field.type === "record") {
    if (!object(value)) throw new Error(`${label} must be an object`);
    keys(value, new Set(Object.keys(field.fields)), label);
    const result = {};
    for (const [name, nested] of Object.entries(field.fields)) {
      const normalized = normalizeFieldValue(Object.hasOwn(value, name) ? value[name] : nested.default, nested, `${label}.${name}`);
      if (normalized !== undefined) result[name] = normalized;
      else if (nested.required) throw new Error(`${label}.${name} is required`);
    }
    for (const pair of field.paired_fields || []) if (pair.some(name => result[name] !== undefined) && pair.some(name => result[name] === undefined)) throw new Error(`${label}.${pair.join(" and ")} must be provided together`);
    if (!Object.keys(result).length) throw new Error(`${label} must not be empty`);
    return result;
  }
  throw new Error(`unsupported format: ${field.type}`);
}

export function normalizeEntity(input, schema, options = {}) {
  if (!object(input)) throw new Error("record must be an object");
  const entity = { id: text(input.id, "record id"), name: text(input.name, "record name"), kind: text(input.kind, "record kind") };
  const fields = kindFields(schema, entity.kind);
  keys(input, new Set([...CORE, ...fields, "updated_at"]), `${entity.kind} record`);
  for (const name of fields) {
    const field = fieldDefinition(schema, entity.kind, name);
    const value = normalizeFieldValue(Object.hasOwn(input, name) ? input[name] : field.default, field, name);
    if (value !== undefined) entity[name] = value;
    else if (field.required && !options.allowMissingRequired) throw new Error(`${name} is required`);
  }
  if (input.updated_at) entity.updated_at = String(input.updated_at);
  const locations = fieldDefinition(schema, entity.kind, "locations");
  if (locations?.type === "record-list" && locations.fields.host?.type === "string" && locations.fields.path?.type === "string") {
    const previous = new Set((options.previous?.locations || []).map(value => JSON.stringify([value.host, value.path, value.url])));
    for (const location of entity.locations || []) {
      const unchanged = previous.has(JSON.stringify([location.host, location.path, location.url]));
      if (!location.host && location.path && !unchanged && options.currentContext) location.host = options.currentContext;
      if (location.path && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(location.path) && !unchanged && !options.allowExistingPaths) throw new Error("locations.path must be absolute");
      if (!location.host && !location.path && !location.url) throw new Error("location needs host, path, or url");
    }
  }
  const related = fieldDefinition(schema, entity.kind, "related");
  if (schema.kinds[entity.kind].origin === "builtin" && related?.type === "record-list" && ["id", "path", "url"].every(key => related.fields[key]?.type === "string")) {
    for (const link of entity.related || []) if ([link.id, link.path, link.url].filter(Boolean).length !== 1) throw new Error("related: choose exactly one of id, path, url");
  }
  return entity;
}

export function newEntity(id, kind, schema) { return normalizeEntity({ id, name: id, kind: kind || schema.default_kind }, schema, { allowMissingRequired: true }); }
export function entityData(entity, schema) { return Object.fromEntries(kindFields(schema, entity.kind).filter(name => entity[name] !== undefined).map(name => [name, entity[name]])); }
export function rowToEntity(row, schema) { return row ? normalizeEntity({ id: row.id, name: row.name, kind: row.kind, ...JSON.parse(row.data), updated_at: row.updated_at }, schema, { allowExistingPaths: true }) : null; }
