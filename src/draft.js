import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { kindFields, newEntity, normalizeEntity } from "./schema.js";

export const DRAFT_FILE_NAME = "BURO_DRAFT.yaml";
const DELETE_DRAFT_KEY = "__buro_delete_entity";
const OPTIONAL = "# OPTIONAL TO FILL — uncomment only when applicable and verified:";

function defaultInstanceRoot() {
  return path.join(homedir(), ".local", "share", "buro");
}

export function resolveInstanceRoot(options = {}) {
  return path.resolve(options.instance_root || options.instanceRoot || process.env.BURO_ROOT || defaultInstanceRoot());
}

export function resolveDraftPath(options = {}) {
  return path.resolve(options.draft_path || options.draftPath || process.env.BURO_DRAFT_PATH || path.join(resolveInstanceRoot(options), DRAFT_FILE_NAME));
}

async function writeDraftFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return filePath;
}

function scalarToYaml(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text === "") return '""';
  if (/\n|^\s|\s$|[#[\]{},]|:\s|^[-?]|^(null|true|false|~)$/i.test(text)) return JSON.stringify(text);
  return text;
}

function valuePresent(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function nestedToYaml(name, value, field, indent = "") {
  if (field.type === "text" && String(value).includes("\n")) {
    return [`${indent}${name}: |`, ...String(value).split("\n").map((line) => `${indent}  ${line}`)];
  }
  return [`${indent}${name}: ${scalarToYaml(value)}`];
}

function recordToYaml(name, value, field) {
  const lines = [`${name}:`];
  const missing = [];
  for (const [nestedName, nestedField] of Object.entries(field.fields)) {
    if (valuePresent(value?.[nestedName])) lines.push(...nestedToYaml(nestedName, value[nestedName], nestedField, "  "));
    else missing.push(nestedName);
  }
  if (missing.length) {
    lines.push(`  ${OPTIONAL}`, ...missing.map((nestedName) => `  # ${nestedName}:`));
  }
  return lines;
}

function recordListToYaml(name, values, field) {
  const lines = [`${name}:`];
  for (const value of values) {
    const entries = Object.entries(field.fields).filter(([nestedName]) => valuePresent(value?.[nestedName]));
    if (!entries.length) continue;
    const [[firstName, firstField], ...rest] = entries;
    lines.push(`  - ${firstName}: ${scalarToYaml(value[firstName])}`);
    for (const [nestedName, nestedField] of rest) {
      lines.push(...nestedToYaml(nestedName, value[nestedName], nestedField, "    "));
    }
  }
  return lines;
}

function fieldToYaml(name, value, field) {
  if (field.type === "record") return recordToYaml(name, value, field);
  if (field.type === "record-list") return recordListToYaml(name, value, field);
  if (field.type === "string-list") return [`${name}:`, ...value.map((entry) => `  - ${scalarToYaml(entry)}`)];
  if (field.type === "text") {
    const text = String(value);
    return text.includes("\n") ? [`${name}: |`, ...text.split("\n").map((line) => `  ${line}`)] : [`${name}: ${scalarToYaml(text)}`];
  }
  return [`${name}: ${field.type === "boolean" ? String(value) : scalarToYaml(value)}`];
}

function optionalFieldToYaml(name, field) {
  if (field.type === "record") {
    return [`# ${name}:`, ...Object.keys(field.fields).map((nestedName) => `#   ${nestedName}:`)];
  }
  if (field.type === "record-list") {
    const fields = Object.keys(field.fields);
    return [
      `# ${name}:`,
      ...(fields.length ? [`#   - ${fields[0]}:`, ...fields.slice(1).map((nestedName) => `#     ${nestedName}:`)] : []),
    ];
  }
  if (field.type === "string-list") return [`# ${name}: []`];
  return [`# ${name}:`];
}

function orderedSections(entity, schema) {
  const names = kindFields(schema, entity.kind);
  const sections = [];
  for (const fieldName of names) {
    const sectionName = schema.fields[fieldName].section || "facts";
    let section = sections.find((entry) => entry.name === sectionName);
    if (!section) {
      section = { name: sectionName, fields: [] };
      sections.push(section);
    }
    section.fields.push(fieldName);
  }
  return sections;
}

export function entityToDraftYaml(entity = {}, schema) {
  const normalized = normalizeEntity(entity, schema);
  const lines = [
    "# BURO entity draft. Existing facts are active YAML fields.",
    "# Missing fields are OPTIONAL TO FILL: uncomment only when applicable and verified.",
    "",
    `id: ${scalarToYaml(normalized.id)}`,
    `name: ${scalarToYaml(normalized.name)}`,
    `kind: ${scalarToYaml(normalized.kind)}`,
  ];
  for (const section of orderedSections(normalized, schema)) {
    lines.push("");
    let optionalOpen = false;
    for (const fieldName of section.fields) {
      const field = schema.fields[fieldName];
      const value = normalized[fieldName];
      if (!valuePresent(value) && field.draft_optional === false) continue;
      if (valuePresent(value)) {
        optionalOpen = false;
        lines.push(...fieldToYaml(fieldName, value, field));
      } else {
        if (!optionalOpen) lines.push(OPTIONAL);
        optionalOpen = true;
        lines.push(...optionalFieldToYaml(fieldName, field));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function validateDraftEntity(entity, schema) {
  return normalizeEntity(entity, schema);
}

export async function writeEntityDraft(entity, options = {}, schema) {
  const filePath = resolveDraftPath(options);
  await writeDraftFile(filePath, entityToDraftYaml(entity, schema));
  return filePath;
}

export async function writeNewEntityDraft(id, kind, options = {}, schema) {
  return writeEntityDraft(newEntity(id, kind, schema), options, schema);
}

export async function writeDeleteDraft(id, options = {}) {
  const filePath = resolveDraftPath(options);
  const entityId = String(id || "").trim();
  await writeDraftFile(filePath, [
    `# BURO delete draft. Generated for ${entityId}.`,
    "# Run `buro draft push` to delete the entity or `buro draft clear` to cancel.",
    `${DELETE_DRAFT_KEY}: ${scalarToYaml(entityId)}`,
    "",
  ].join("\n"));
  return filePath;
}

export async function clearDraft(options = {}) {
  const filePath = resolveDraftPath(options);
  await rm(filePath, { force: true });
  return filePath;
}

function isMeaningfulLine(line) {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

export function parseDraft(text, schema) {
  if (!String(text || "").split("\n").some(isMeaningfulLine)) return { mode: "empty" };
  const parsed = yaml.load(String(text || "")) ?? {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("draft must be a plain YAML document");
  const deleteId = parsed[DELETE_DRAFT_KEY];
  if (deleteId) return { mode: "delete", id: String(deleteId).trim() };
  return { mode: "entity", entity: validateDraftEntity(parsed, schema) };
}

export async function readDraft(options = {}, schema) {
  const filePath = resolveDraftPath(options);
  try {
    const text = await readFile(filePath, "utf8");
    return { filePath, text, ...parseDraft(text, schema) };
  } catch (error) {
    if (error?.code === "ENOENT") return { filePath, text: "", mode: "empty" };
    throw error;
  }
}

function linesOf(text) {
  const normalized = String(text || "").replaceAll("\r\n", "\n").replace(/\n$/, "");
  return normalized ? normalized.split("\n") : [];
}

export function lineDiff(fromText, toText, { fromLabel = "BURO current", toLabel = "draft" } = {}) {
  const from = linesOf(fromText);
  const to = linesOf(toText);
  if (from.join("\n") === to.join("\n")) return "No draft changes.\n";
  const table = Array.from({ length: from.length + 1 }, () => Array(to.length + 1).fill(0));
  for (let i = from.length - 1; i >= 0; i -= 1) {
    for (let j = to.length - 1; j >= 0; j -= 1) {
      table[i][j] = from[i] === to[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const output = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  let i = 0;
  let j = 0;
  while (i < from.length || j < to.length) {
    if (i < from.length && j < to.length && from[i] === to[j]) {
      output.push(`  ${from[i]}`); i += 1; j += 1;
    } else if (j < to.length && (i === from.length || table[i][j + 1] >= table[i + 1][j])) {
      output.push(`+ ${to[j]}`); j += 1;
    } else {
      output.push(`- ${from[i]}`); i += 1;
    }
  }
  return `${output.join("\n")}\n`;
}
