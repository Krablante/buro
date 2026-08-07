#!/usr/bin/env node
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./api-client.js";
import { serve } from "./api.js";
import { contextKey, hasDirectStorage, loadConfig } from "./config.js";
import {
  clearDraft,
  entityToDraftYaml,
  lineDiff,
  readDraft,
  writeDeleteDraft,
  writeEntityDraft,
  writeNewEntityDraft,
} from "./draft.js";
import { backupDatabase, initDb } from "./db.js";
import {
  renderCliError,
  renderCurrentContext,
  renderDraftClearResult,
  renderDraftDeleteReady,
  renderDraftDiffResult,
  renderDraftEntityReady,
  renderDraftPushResult,
  renderEntityListLine,
  renderKindSchema,
  renderSchemaSummary,
  renderUsage,
} from "./cli-output.js";
import { renderPacket } from "./packet.js";
import { exportRegistry, importRegistry } from "./registry.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  resolveEntities,
  resolveEntity,
  resolveEntityPacket,
  updateEntityRecord,
} from "./resolver.js";
import { loadSchema, normalizeSchema } from "./schema.js";

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require("../package.json");

function parseArgs(argv) {
  const args = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const name = token.slice(2).replaceAll("-", "_");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) options[name] = true;
    else { options[name] = next; index += 1; }
  }
  return { args, options };
}

function requireArg(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function rejectOptions(options, allowed = []) {
  const names = Object.keys(options).filter((name) => !allowed.includes(name));
  if (names.length) throw new Error(`unsupported option: --${names[0].replaceAll("_", "-")}`);
}

function requireDirectStorage(command, config) {
  if (!hasDirectStorage(config)) {
    throw new Error(`${command} requires local BURO storage. Run it in local/central mode on ${config.centralHost}.`);
  }
}

function localOptions(config, schema) {
  return {
    databasePath: config.databasePath,
    currentContext: config.currentContext,
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
    schema,
  };
}

function dataClient(config, localSchema) {
  if (hasDirectStorage(config)) {
    const options = localOptions(config, localSchema);
    return {
      schema: async () => localSchema,
      entities: () => resolveEntities(options),
      entity: (id) => resolveEntity(id, options),
      createEntity: (id, entity) => createEntityRecord(id, entity, options),
      updateEntity: (id, entity, revision) => updateEntityRecord(id, entity, { ...options, expectedUpdatedAt: revision }),
      deleteEntity: (id, revision) => deleteEntityRecord(id, { ...options, expectedUpdatedAt: revision }),
      packetText: async (id) => {
        const packet = await resolveEntityPacket(id, options);
        return packet ? renderPacket(packet) : null;
      },
    };
  }
  const api = createApiClient(config.apiUrl);
  return {
    schema: async () => normalizeSchema(await api.schema(), `API ${config.apiUrl}/schema`),
    entities: () => api.entities(),
    entity: (id) => api.entity(id),
    createEntity: (id, entity) => api.createEntity(id, entity),
    updateEntity: (id, entity, revision) => api.updateEntity(id, entity, revision),
    deleteEntity: (id, revision) => api.deleteEntity(id, revision),
    packetText: async (id) => renderPacket(await api.entityPacket(id, config.currentContext)),
  };
}

async function getEntityOrNull(client, id) {
  try {
    return await client.entity(id);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

function contextMatches(entity, value, schema) {
  const candidate = contextKey(value);
  return [entity.id, ...(entity[schema.context.alias_field] || [])].map(contextKey).includes(candidate);
}

function findCurrentContext(entities, value, schema) {
  const matches = entities.filter((entity) => entity.kind === schema.context.kind && contextMatches(entity, value, schema));
  if (matches.length > 1) throw new Error(`ambiguous current context ${value}: ${matches.map((entity) => entity.id).join(", ")}`);
  return matches[0] || null;
}

async function printCurrentContext(client, config, schema) {
  const entities = await client.entities();
  const context = findCurrentContext(entities, config.currentContext, schema);
  if (!context) {
    throw new Error(`${schema.context.kind} not found for current context ${config.currentContext}; create it with \`buro draft new ${config.currentContext} ${schema.context.kind}\``);
  }
  const packetText = await client.packetText(context.id);
  const members = entities.filter((entity) => (
    entity.kind !== schema.context.kind && entity[schema.context.member_field] === context.id
  ));
  process.stdout.write(renderCurrentContext({
    currentContext: context.id,
    home: process.env.HOME || homedir(),
    contextRoot: schema.context.root_field ? context[schema.context.root_field] : undefined,
    packetText,
    members,
  }));
}

function assertFreshRevision(entity, metadata) {
  if (entity.updated_at !== metadata.base_updated_at) {
    throw new Error(`entity changed after this draft was created: ${entity.id}; pull a fresh draft and review again`);
  }
}

function sameEntity(left, right) {
  const { updated_at: _leftRevision, ...leftFacts } = left;
  const { updated_at: _rightRevision, ...rightFacts } = right;
  return JSON.stringify(leftFacts) === JSON.stringify(rightFacts);
}

async function runDraftCommand(args, options, config, client, schema) {
  rejectOptions(options);
  const action = args[1] || "help";
  const target = config.mode === "client" ? `API ${config.apiUrl}` : `SQLite ${config.databasePath}`;
  const draftOptions = { draftPath: config.draftPath };
  if (action === "help") {
    console.log("Usage: buro draft pull/new/delete/diff/push/clear");
    return 0;
  }
  if (action === "clear") {
    const filePath = await clearDraft(draftOptions);
    process.stdout.write(renderDraftClearResult({ filePath }));
    return 0;
  }
  if (action === "pull") {
    const id = requireArg(args[2], "draft pull requires an entity id");
    const entity = await getEntityOrNull(client, id);
    if (!entity) throw new Error(`entity not found: ${id}`);
    const filePath = await writeEntityDraft(entity, draftOptions, schema);
    process.stdout.write(renderDraftEntityReady({ filePath, id, mode: "edit entity", target }));
    return 0;
  }
  if (action === "new") {
    const id = requireArg(args[2], "draft new requires an entity id");
    const kind = args[3] || schema.default_kind;
    if (await getEntityOrNull(client, id)) throw new Error(`entity already exists: ${id}`);
    const filePath = await writeNewEntityDraft(id, kind, draftOptions, schema);
    process.stdout.write(renderDraftEntityReady({ filePath, id, mode: `new ${kind}`, target }));
    return 0;
  }
  if (action === "delete") {
    const id = requireArg(args[2], "draft delete requires an entity id");
    const entity = await getEntityOrNull(client, id);
    if (!entity) throw new Error(`entity not found: ${id}`);
    const filePath = await writeDeleteDraft(entity, draftOptions);
    process.stdout.write(renderDraftDeleteReady({ filePath, id, target }));
    return 0;
  }
  if (action === "diff") {
    const draft = await readDraft(draftOptions, schema);
    if (draft.mode === "empty") throw new Error(`BURO draft is empty: ${draft.filePath}`);
    if (draft.mode === "delete") {
      const existing = await getEntityOrNull(client, draft.id);
      if (!existing) throw new Error(`entity not found: ${draft.id}`);
      assertFreshRevision(existing, draft.metadata);
      process.stdout.write(renderDraftDiffResult({
        id: draft.id,
        mode: "delete entity",
        diffText: lineDiff(
          entityToDraftYaml(existing, schema, { metadata: draft.metadata }),
          "",
          { fromLabel: `BURO entity ${draft.id}`, toLabel: "delete draft" },
        ),
      }));
      return 0;
    }
    const existing = await getEntityOrNull(client, draft.entity.id);
    if (draft.mode === "create" && existing) throw new Error(`entity already exists: ${draft.entity.id}`);
    if (draft.mode === "update") {
      if (!existing) throw new Error(`entity not found: ${draft.entity.id}`);
      assertFreshRevision(existing, draft.metadata);
    }
    process.stdout.write(renderDraftDiffResult({
      id: draft.entity.id,
      mode: draft.mode === "create" ? "new entity" : "edit entity",
      diffText: lineDiff(
        existing ? entityToDraftYaml(existing, schema, { metadata: draft.metadata }) : "",
        entityToDraftYaml(draft.entity, schema, { metadata: draft.metadata }),
        { fromLabel: existing ? `BURO entity ${draft.entity.id}` : "new entity", toLabel: "draft" },
      ),
    }));
    return 0;
  }
  if (action === "push") {
    const draft = await readDraft(draftOptions, schema);
    if (draft.mode === "empty") throw new Error(`BURO draft is empty: ${draft.filePath}`);
    if (draft.mode === "delete") {
      await client.deleteEntity(draft.id, draft.metadata.base_updated_at);
      const filePath = await clearDraft(draftOptions);
      process.stdout.write(renderDraftPushResult({ action: "deleted", id: draft.id, filePath }));
      return 0;
    }
    let action;
    if (draft.mode === "create") {
      await client.createEntity(draft.entity.id, draft.entity);
      action = "created";
    } else {
      const existing = await getEntityOrNull(client, draft.entity.id);
      if (!existing) throw new Error(`entity not found: ${draft.entity.id}`);
      assertFreshRevision(existing, draft.metadata);
      if (!sameEntity(existing, draft.entity)) {
        await client.updateEntity(draft.entity.id, draft.entity, draft.metadata.base_updated_at);
        action = "updated";
      } else {
        action = "unchanged";
      }
    }
    const filePath = await clearDraft(draftOptions);
    process.stdout.write(renderDraftPushResult({ action, id: draft.entity.id, filePath }));
    return 0;
  }
  throw new Error(`unknown draft action: ${action}`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { args, options } = parseArgs(argv);
  if (options.version || args[0] === "version") {
    rejectOptions(options, ["version"]);
    console.log(PACKAGE_VERSION);
    return 0;
  }

  const config = loadConfig();
  const command = args[0];
  const direct = hasDirectStorage(config);
  const localSchema = direct ? loadSchema(config.schemaPath) : null;

  if (options.help) {
    rejectOptions(options, ["help"]);
    const schema = direct ? localSchema : await dataClient(config, localSchema).schema();
    process.stdout.write(renderUsage(schema));
    return 0;
  }

  if (command === "init") {
    rejectOptions(options);
    requireDirectStorage(command, config);
    let backupPath = null;
    if (existsSync(config.databasePath) && statSync(config.databasePath).size > 0) {
      backupPath = await backupDatabase(config.databasePath, config);
    }
    const result = await initDb(config.databasePath, localSchema, { adoptSchema: true });
    console.log(`BURO SQLite ready: ${config.databasePath}`);
    console.log(`Preset: ${localSchema.id} v${localSchema.version}`);
    if (backupPath) console.log(`Pre-init backup: ${backupPath}`);
    const entities = await resolveEntities(localOptions(config, localSchema));
    if (!entities.length) console.log(`Next: buro draft new ${config.currentContext} ${localSchema.context.kind}`);
    if (result.adopted) console.log("Preset binding adopted after complete entity validation.");
    return 0;
  }
  if (command === "backup") {
    rejectOptions(options);
    requireDirectStorage(command, config);
    console.log(`BURO backup created: ${await backupDatabase(config.databasePath, config)}`);
    return 0;
  }
  if (command === "serve") {
    rejectOptions(options, ["host", "port"]);
    requireDirectStorage(command, config);
    await serve({ databasePath: config.databasePath, schema: localSchema, apiHost: options.host, apiPort: options.port });
    return 0;
  }
  if (command === "export") {
    rejectOptions(options);
    requireDirectStorage(command, config);
    const filePath = requireArg(args[1], "export requires a destination file");
    const result = await exportRegistry(filePath, await resolveEntities(localOptions(config, localSchema)), localSchema);
    console.log(`BURO registry exported: ${result.filePath}`);
    console.log(`Entities: ${result.count}`);
    return 0;
  }
  if (command === "import") {
    rejectOptions(options, ["adopt"]);
    requireDirectStorage(command, config);
    const filePath = requireArg(args[1], "import requires a registry file");
    const result = await importRegistry(filePath, { ...config, schema: localSchema, adopt: options.adopt === true });
    console.log(`BURO registry imported: ${result.source}`);
    console.log(`Entities: ${result.count}`);
    console.log(`Previous entities: ${result.previousCount}`);
    if (result.adopted) console.log(`Preset adopted: ${result.sourcePreset.id} v${result.sourcePreset.version} -> ${localSchema.id} v${localSchema.version}`);
    if (result.backupPath) console.log(`Pre-import backup: ${result.backupPath}`);
    return 0;
  }

  rejectOptions(options);
  const client = dataClient(config, localSchema);
  const schema = direct ? localSchema : await client.schema();
  if (!command || command === "help") {
    process.stdout.write(renderUsage(schema));
    return 0;
  }
  if (command === "schema") {
    process.stdout.write(args[1] ? renderKindSchema(schema, args[1]) : renderSchemaSummary(schema));
    return 0;
  }
  if (command === "list") {
    const kind = args[1];
    if (kind && !schema.kinds[kind]) throw new Error(`unsupported entity kind: ${kind}`);
    const all = await client.entities();
    const entities = all.filter((entity) => !kind || entity.kind === kind);
    const current = findCurrentContext(all, config.currentContext, schema)?.id;
    for (const entity of entities) console.log(renderEntityListLine(entity, current));
    return 0;
  }
  if (command === "current") {
    await printCurrentContext(client, config, schema);
    return 0;
  }
  if (command === "draft") return runDraftCommand(args, options, config, client, schema);
  const text = await client.packetText(command);
  if (!text) throw new Error(`entity not found: ${command}`);
  process.stdout.write(text);
  return 0;
}

function isMainModule() {
  return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(renderCliError(error));
    process.exit(1);
  }
}
