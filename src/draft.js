import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { newEntity } from "./schema.js";

export const dump = value => yaml.dump(value, { noRefs: true, lineWidth: -1, sortKeys: false });

export function draftMetadata(schema, subject, mode, id, revision) {
  return { version: 3, subject, mode, base_id: id, generation: schema.generation,
    type_revisions: Object.fromEntries(Object.entries(schema.kinds).map(([id, kind]) => [id, kind.revision])),
    ...(revision ? { base_revision: revision } : {}) };
}

function fieldGuide(name, field, indent = "") {
  return [`# ${indent}${name} (${field.type}${field.required ? ", required" : ""})${field.guide ? `: ${field.guide}` : ""}`,
    ...Object.entries(field.fields || {}).flatMap(([key, nested]) => fieldGuide(key, nested, `${indent}  `))];
}

export function draftYaml(value, metadata, schema) {
  const lines = ["# BURO draft. Keep __buro metadata. Unknown optional facts stay empty.", dump({ __buro: metadata }).trimEnd()];
  if (value) {
    lines.push("", dump(value).trimEnd());
    if (metadata.subject === "record") {
      for (const [name, field] of Object.entries(schema.kinds[value.kind].definitions)) {
        lines.push("", ...fieldGuide(name, field));
        if (!Object.hasOwn(value, name)) lines.push(`# ${name}: ${field.type.endsWith("-list") ? "[]" : ""}`);
      }
    }
  }
  lines.push("", "# Review: buro draft diff <this-file>", "# Apply:  buro draft push <this-file>");
  return `${lines.join("\n")}\n`;
}

export async function writeDraft(value, metadata, schema) {
  const directory = await mkdtemp(path.join(tmpdir(), "buro-draft-"));
  const file = path.join(directory, "change.yaml");
  await writeFile(file, draftYaml(value, metadata, schema), { mode: 0o600, flag: "wx" });
  return file;
}
export async function writeRecordDraft(entity, mode, schema) {
  return writeDraft(mode === "delete" ? null : entity, draftMetadata(schema, "record", mode, entity.id, entity.updated_at), schema);
}
export async function writeNewRecordDraft(id, kind, schema) { return writeRecordDraft(newEntity(id, kind, schema), "create", schema); }

export async function readDraft(file) {
  if (!file) throw new Error("provide the YAML file printed when creating the draft");
  const filePath = path.resolve(file);
  const parsed = yaml.load(await readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.__buro) throw new Error("not a BURO draft");
  const { __buro: metadata, ...value } = parsed;
  const allowed = ["version", "subject", "mode", "base_id", "generation", "type_revisions", "base_revision"];
  if (Object.keys(metadata).some(key => !allowed.includes(key))) throw new Error("unknown draft metadata; prepare a fresh draft");
  if (metadata.version !== 3 || !metadata.base_id || !metadata.generation) throw new Error("obsolete or incomplete draft; prepare a new draft");
  if (metadata.mode === "delete" && Object.keys(value).length) throw new Error("deletion draft must contain only metadata");
  return { filePath, metadata, value: metadata.mode === "delete" ? null : value };
}
export async function clearDraft(file) {
  const { filePath } = await readDraft(file);
  await rm(filePath);
  const directory = path.dirname(filePath);
  if (path.basename(directory).startsWith("buro-draft-") && path.dirname(directory) === tmpdir()) await rmdir(directory).catch(error => { if (error.code !== "ENOTEMPTY") throw error; });
  return filePath;
}

export function lineDiff(fromText, toText) {
  const from = String(fromText).trimEnd().split("\n");
  const to = String(toText).trimEnd().split("\n");
  if (fromText === toText) return "No changes.\n";
  let prefix = 0;
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix++;
  let a = from.length, b = to.length;
  while (a > prefix && b > prefix && from[a - 1] === to[b - 1]) { a--; b--; }
  const removed = from.slice(prefix, a), added = to.slice(prefix, b);
  const output = ["--- saved", "+++ draft", ...from.slice(0, prefix).map(line => `  ${line}`)];
  if (removed.length * added.length > 2_000_000) {
    output.push(...removed.map(line => `- ${line}`), ...added.map(line => `+ ${line}`));
  } else {
    const table = Array.from({ length: removed.length + 1 }, () => new Uint32Array(added.length + 1));
    for (let i = removed.length - 1; i >= 0; i--) for (let j = added.length - 1; j >= 0; j--) table[i][j] = removed[i] === added[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < removed.length || j < added.length) {
      if (i < removed.length && j < added.length && removed[i] === added[j]) { output.push(`  ${removed[i++]}`); j++; }
      else if (j < added.length && (i === removed.length || table[i][j + 1] >= table[i + 1][j])) output.push(`+ ${added[j++]}`);
      else output.push(`- ${removed[i++]}`);
    }
  }
  return `${[...output, ...from.slice(a).map(line => `  ${line}`)].join("\n")}\n`;
}
