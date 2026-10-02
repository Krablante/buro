import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { replaceRegistryRecords, validateEntitySet } from "./resolver.js";
import { loadSchema, normalizeSchema } from "./schema.js";
import { migrateEntities } from "./migration.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FORMAT = "buro-registry";
const FORMAT_VERSION = 2;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function manifestFor(entities, schema) {
  const { source: _source, hash: _hash, core_fields: _coreFields, ...model } = schema;
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    model,
    preset: {
      id: schema.id,
      version: schema.version,
      hash: schema.hash,
    },
    entities: [...entities].sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
    )),
  };
}

export async function exportRegistry(filePath, entities, schema) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  const text = yaml.dump(manifestFor(entities, schema), {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
  try {
    await writeFile(target, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`registry export already exists: ${target}`);
    throw error;
  }
  return { filePath: target, count: entities.length };
}

export async function readRegistryManifest(filePath, schema, options = {}) {
  const source = path.resolve(filePath);
  const manifest = yaml.load(await readFile(source, "utf8"));
  if (!plainObject(manifest)) throw new Error("registry export must be a YAML object");
  const unknown = Object.keys(manifest).filter((key) => !["format", "version", "model", "preset", "exported_at", "entities"].includes(key));
  if (unknown.length) throw new Error(`registry export contains unknown fields: ${unknown.join(", ")}`);
  if (manifest.format !== FORMAT || ![1, FORMAT_VERSION].includes(manifest.version)) {
    throw new Error(`unsupported registry export format: ${manifest.format || "unknown"} v${manifest.version || "unknown"}`);
  }
  if (!plainObject(manifest.preset)) throw new Error("registry export preset metadata is required");
  const unknownPreset = Object.keys(manifest.preset).filter((key) => !["id", "version", "hash"].includes(key));
  if (unknownPreset.length) throw new Error(`registry export preset contains unknown fields: ${unknownPreset.join(", ")}`);
  if (typeof manifest.preset.id !== "string" || !Number.isInteger(manifest.preset.version) || typeof manifest.preset.hash !== "string") {
    throw new Error("registry export preset metadata is invalid");
  }
  const presetMatches = manifest.preset.id === schema.id
    && manifest.preset.version === schema.version
    && manifest.preset.hash === schema.hash;
  if (!presetMatches && !options.adopt) {
    throw new Error(`registry export uses ${manifest.preset.id} v${manifest.preset.version}; active preset is ${schema.id} v${schema.version}`);
  }
  if (!Array.isArray(manifest.entities)) throw new Error("registry export entities must be a list");
  let previous = manifest.model ? normalizeSchema(manifest.model, "registry export") : null;
  if (!previous && ["starter", "politia"].includes(manifest.preset.id)) {
    const legacyFile = new URL(`../presets/legacy/${manifest.preset.id}-v${manifest.preset.version}.yaml`, import.meta.url);
    if (existsSync(legacyFile)) previous = loadSchema(fileURLToPath(legacyFile));
  }
  if (previous && previous.hash !== manifest.preset.hash) throw new Error("export model does not match its declared hash");
  const result = presetMatches ? { entities: validateEntitySet(manifest.entities, schema) }
    : migrateEntities(manifest.entities, { preset: manifest.preset.id }, previous, schema);
  return { source, manifest, presetMatches, ...result };
}

export async function importRegistry(filePath, options) {
  const { source, manifest, presetMatches, entities } = await readRegistryManifest(filePath, options.schema, options);
  if (options.draftPath && existsSync(options.draftPath)) throw new Error(`active draft at ${options.draftPath}; finish or preserve it before replacing the registry`);
  return { source, sourcePreset: manifest.preset, adopted: !presetMatches, ...(await replaceRegistryRecords(entities, options)) };
}
