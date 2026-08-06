#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./api-client.js";
import { serve } from "./api.js";
import { canonicalHost, isCentralHost, loadConfig } from "./config.js";
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
  renderSchemaSummary,
  renderUsage,
} from "./cli-output.js";
import { renderPacket } from "./packet.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  resolveEntities,
  resolveEntity,
  resolveEntityPacket,
  updateEntityRecord,
} from "./resolver.js";
import { loadSchema, normalizeSchema } from "./schema.js";

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

function rejectPublicOptions(options) {
  const names = Object.keys(options).filter((name) => name !== "help");
  if (names.length) throw new Error(`unsupported option: --${names[0].replaceAll("_", "-")}`);
}

function requireDirectStorage(command, config) {
  if (!isCentralHost(config)) {
    throw new Error(`${command} requires local BURO storage. Run it in local/central mode on ${config.centralHost}.`);
  }
}

function localOptions(config, schema) {
  return {
    databasePath: config.databasePath,
    currentHost: config.currentHost,
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
    schema,
  };
}

function dataClient(config, localSchema) {
  if (isCentralHost(config)) {
    const options = localOptions(config, localSchema);
    return {
      schema: async () => localSchema,
      entities: () => resolveEntities(options),
      entity: (id) => resolveEntity(id, options),
      createEntity: (id, entity) => createEntityRecord(id, entity, options),
      updateEntity: (id, entity) => updateEntityRecord(id, entity, options),
      deleteEntity: (id) => deleteEntityRecord(id, options),
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
    updateEntity: (id, entity) => api.updateEntity(id, entity),
    deleteEntity: (id) => api.deleteEntity(id),
    packetText: async (id) => renderPacket(await api.entityPacket(id, config.currentHost)),
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
  const candidate = canonicalHost(value);
  return canonicalHost(entity.id) === candidate
    || (entity[schema.context.alias_field] || []).some((alias) => canonicalHost(String(alias).split(":", 1)[0]) === candidate);
}

async function printCurrentContext(client, config, schema) {
  const entities = await client.entities();
  const context = entities.find((entity) => entity.kind === schema.context.kind && contextMatches(entity, config.currentHost, schema));
  if (!context) throw new Error(`${schema.context.kind} not found: ${config.currentHost}`);
  const packetText = await client.packetText(context.id);
  const members = entities.filter((entity) => (
    entity.kind !== schema.context.kind && entity[schema.context.member_field] === context.id
  ));
  process.stdout.write(renderCurrentContext({
    currentContext: context.id,
    home: process.env.HOME || homedir(),
    instanceRoot: context[schema.context.root_field] || config.instanceRoot,
    packetText,
    members,
    schema,
  }));
}

async function runDraftCommand(args, options, config, client, schema) {
  const action = args[1] || "help";
  const target = config.mode === "client" ? `API ${config.apiUrl}` : `SQLite ${config.databasePath}`;
  const draftOptions = { ...options, draftPath: config.draftPath };
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
    if (!await getEntityOrNull(client, id)) throw new Error(`entity not found: ${id}`);
    const filePath = await writeDeleteDraft(id, draftOptions);
    process.stdout.write(renderDraftDeleteReady({ filePath, id, target }));
    return 0;
  }
  if (action === "diff") {
    const draft = await readDraft(draftOptions, schema);
    if (draft.mode === "empty") throw new Error(`BURO draft is empty: ${draft.filePath}`);
    if (draft.mode === "delete") {
      const existing = await getEntityOrNull(client, draft.id);
      if (!existing) throw new Error(`entity not found: ${draft.id}`);
      process.stdout.write(renderDraftDiffResult({
        id: draft.id,
        mode: "delete entity",
        diffText: lineDiff(entityToDraftYaml(existing, schema), "", { fromLabel: `BURO entity ${draft.id}`, toLabel: "delete draft" }),
      }));
      return 0;
    }
    const existing = await getEntityOrNull(client, draft.entity.id);
    process.stdout.write(renderDraftDiffResult({
      id: draft.entity.id,
      mode: existing ? "edit entity" : "new entity",
      diffText: lineDiff(existing ? entityToDraftYaml(existing, schema) : "", entityToDraftYaml(draft.entity, schema), {
        fromLabel: existing ? `BURO entity ${draft.entity.id}` : "new entity",
        toLabel: "draft",
      }),
    }));
    return 0;
  }
  if (action === "push") {
    const draft = await readDraft(draftOptions, schema);
    if (draft.mode === "empty") throw new Error(`BURO draft is empty: ${draft.filePath}`);
    if (draft.mode === "delete") {
      if (!await getEntityOrNull(client, draft.id)) throw new Error(`entity not found: ${draft.id}`);
      await client.deleteEntity(draft.id);
      const filePath = await clearDraft(draftOptions);
      process.stdout.write(renderDraftPushResult({ action: "deleted", id: draft.id, filePath }));
      return 0;
    }
    const existing = await getEntityOrNull(client, draft.entity.id);
    if (existing) await client.updateEntity(draft.entity.id, draft.entity);
    else await client.createEntity(draft.entity.id, draft.entity);
    const filePath = await clearDraft(draftOptions);
    process.stdout.write(renderDraftPushResult({ action: existing ? "updated" : "created", id: draft.entity.id, filePath }));
    return 0;
  }
  throw new Error(`unknown draft action: ${action}`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { args, options } = parseArgs(argv);
  const config = loadConfig();
  const command = args[0];
  const localSchema = loadSchema(config.schemaPath);

  if (command === "init") {
    requireDirectStorage(command, config);
    await initDb(config.databasePath, localSchema);
    console.log(`BURO SQLite ready: ${config.databasePath}`);
    return 0;
  }
  if (command === "backup") {
    requireDirectStorage(command, config);
    console.log(`BURO backup created: ${await backupDatabase(config.databasePath, config)}`);
    return 0;
  }
  if (command === "serve") {
    requireDirectStorage(command, config);
    await serve({ databasePath: config.databasePath, schema: localSchema, apiHost: options.host, apiPort: options.port });
    return 0;
  }

  rejectPublicOptions(options);
  const client = dataClient(config, localSchema);
  const schema = isCentralHost(config) ? localSchema : await client.schema();
  if (!command || command === "help" || options.help) {
    process.stdout.write(renderUsage(schema));
    return 0;
  }
  if (command === "schema") {
    process.stdout.write(renderSchemaSummary(schema));
    return 0;
  }
  if (command === "list") {
    const kind = args[1];
    if (kind && !schema.kinds[kind]) throw new Error(`unsupported entity kind: ${kind}`);
    const entities = (await client.entities()).filter((entity) => !kind || entity.kind === kind);
    const current = entities.find((entity) => entity.kind === schema.context.kind && contextMatches(entity, config.currentHost, schema))?.id;
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
