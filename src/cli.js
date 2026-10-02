#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { createApiClient } from "./api-client.js";
import { agentContract, connectAgent, fullAgentWorkflow } from "./agent.js";
import { serve } from "./api.js";
import { hasDirectStorage, loadConfig } from "./config.js";
import {
  clearDraft,
  entityToDraftYaml,
  lineDiff,
  readDraft,
  writeDeleteDraft,
  writeEntityDraft,
  writeNewEntityDraft,
} from "./draft.js";
import { backupDatabase } from "./db.js";
import { initializeRegistry } from "./migration.js";
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
  resolveCurrentContext,
  resolveEntities,
  resolveEntitySummaries,
  resolveEntity,
  resolveEntityPacket,
  updateEntityRecord,
} from "./resolver.js";
import { loadSchema, loadTypeDefinition, normalizeEntity, normalizeSchema } from "./schema.js";

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
    const equal = token.indexOf("=");
    const name = token.slice(2, equal === -1 ? undefined : equal).replaceAll("-", "_");
    if (["help", "version", "dry_run", "brief", "full", "adopt"].includes(name)) {
      if (equal !== -1) throw new Error(`${token.slice(0, equal)} does not take a value`);
      options[name] = true;
      continue;
    }
    if (equal !== -1) {
      const value = token.slice(equal + 1);
      if (!value) throw new Error(`${token.slice(0, equal)} requires a value`);
      options[name] = value;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${token} requires a value`);
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
      entitySummaries: (kind, page) => resolveEntitySummaries(kind, { ...options, ...page }),
      current: (brief) => resolveCurrentContext({ ...options, brief }),
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
    entitySummaries: (kind, page) => api.entitySummaries(kind, config.currentContext, page),
    current: async (brief) => {
      try {
        return await api.current(config.currentContext, brief);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("BURO API 404: current context not found:")) return null;
        throw error;
      }
    },
    entity: (id) => api.entity(id),
    createEntity: (id, entity) => api.createEntity(id, entity, config.currentContext),
    updateEntity: (id, entity, revision) => api.updateEntity(id, entity, revision, config.currentContext),
    deleteEntity: (id, revision) => api.deleteEntity(id, revision),
    packetText: async (id) => renderPacket(await api.entityPacket(id, config.currentContext)),
  };
}

async function getEntityOrNull(client, id) {
  try {
    return await client.entity(id);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function printCurrentContext(client, config, schema, brief) {
  const current = await client.current(brief);
  const context = current?.context;
  if (!context) throw new Error("BURO API did not return machine context");
  process.stdout.write(renderCurrentContext({
    currentContext: context.id,
    home: process.env.HOME || homedir(),
    contextRoot: schema.context?.root_field ? context[schema.context.root_field] : undefined,
    packetText: current.packet ? renderPacket(current.packet) : "No machine-wide rules recorded.",
    members: current.members,
    brief,
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
    const existing = await getEntityOrNull(client, id);
    if (existing?.id === id) throw new Error(`entity already exists: ${id}`);
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
    const found = await getEntityOrNull(client, draft.entity.id);
    const existing = draft.mode === "create" && found?.id !== draft.entity.id ? null : found;
    draft.entity = normalizeEntity(draft.entity, schema, { currentContext: config.currentContext, previous: existing });
    if (draft.mode === "create" && existing?.id === draft.entity.id) throw new Error(`entity already exists: ${draft.entity.id}`);
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
      draft.entity = normalizeEntity(draft.entity, schema, { currentContext: config.currentContext });
      await client.createEntity(draft.entity.id, draft.entity);
      action = "created";
    } else {
      const existing = await getEntityOrNull(client, draft.entity.id);
      if (!existing) throw new Error(`entity not found: ${draft.entity.id}`);
      assertFreshRevision(existing, draft.metadata);
      draft.entity = normalizeEntity(draft.entity, schema, { currentContext: config.currentContext, previous: existing });
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

  if (options.help || !args.length || args[0] === "help") {
    rejectOptions(options, ["help"]);
    process.stdout.write(renderUsage());
    return 0;
  }
  const limits = { connect: 2, agent: 1, init: 1, backup: 1, serve: 1, export: 2, import: 2, current: 1, list: 2, search: 2, schema: 2, get: 2 };
  const limit = args[0] === "types" ? (args[1] === "copy" ? 4 : 2)
    : args[0] === "draft" ? (args[1] === "new" ? 4 : ["pull", "delete"].includes(args[1]) ? 3 : 2)
      : limits[args[0]] ?? 1;
  if (args.length > limit) throw new Error(`unexpected argument: ${args[limit]}; use buro help for command syntax`);

  const command = args[0];
  if (command === "agent") {
    rejectOptions(options, ["full"]);
    process.stdout.write(options.full ? await fullAgentWorkflow() : agentContract());
    return 0;
  }
  if (command === "connect") {
    rejectOptions(options, ["path"]);
    const files = await connectAgent(requireArg(args[1], "connect requires an agent name"), options);
    console.log(`BURO connected:\n${files.join("\n")}\nStart a new agent session; restart OpenCode/OpenCodez after plugin installation.`);
    return 0;
  }
  if (command === "types" && args[1] === "copy") {
    rejectOptions(options);
    const { filePath } = loadTypeDefinition(requireArg(args[2], "types copy requires a built-in type"));
    const target = path.resolve(requireArg(args[3], "types copy requires a destination YAML file"));
    if (existsSync(target)) throw new Error(`file already exists: ${target}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(filePath, target);
    console.log(`Type definition copied: ${target}\nSelect it in config.json type_files instead of the built-in name, then run buro init --dry-run and buro init.`);
    return 0;
  }
  const config = loadConfig();
  if (command === "backup") {
    rejectOptions(options);
    requireDirectStorage(command, config);
    console.log(`BURO backup created: ${await backupDatabase(config.databasePath, config)}`);
    return 0;
  }
  const direct = hasDirectStorage(config);
  const localSchema = direct ? loadSchema(config) : null;

  if (command === "init") {
    rejectOptions(options, ["dry_run"]);
    requireDirectStorage(command, config);
    const result = await initializeRegistry(config, localSchema, { dryRun: options.dry_run === true });
    console.log(`BURO SQLite ${options.dry_run ? "preview" : "ready"}: ${config.databasePath}`);
    console.log(`Preset: ${localSchema.id} v${localSchema.version}`);
    if (result.backupPath) console.log(`Pre-init backup: ${result.backupPath}`);
    console.log(`Records: ${result.count}; migrated: ${result.transformed}`);
    if (result.created) console.log("Ready to add records; no host record is required.\nConnect your agent: buro connect <agent>");
    if (!options.dry_run && !existsSync(config.configPath)) {
      await mkdir(path.dirname(config.configPath), { recursive: true });
      const initial = process.env.BURO_SCHEMA_PATH ? { schema_path: config.schemaPath }
        : config.preset === "starter" ? { type_files: ["project", "service", "host", "item"] } : { preset: config.preset };
      await writeFile(config.configPath, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      console.log(`Configuration: ${config.configPath}`);
    }
    if (result.adopted) console.log(options.dry_run ? "Definitions can be adopted after complete saved-record validation." : "Definitions validated against all saved records and adopted.");
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

  rejectOptions(options, command === "current" ? ["brief"] : ["list", "search"].includes(command) ? ["limit", "offset"] : []);
  const client = dataClient(config, localSchema);
  const needsSchema = !command || ["help", "schema", "types", "draft", "current"].includes(command);
  const schema = direct ? localSchema : needsSchema ? await client.schema() : null;
  if (command === "schema") {
    process.stdout.write(args[1] ? renderKindSchema(schema, args[1]) : renderSchemaSummary(schema));
    return 0;
  }
  if (command === "types") {
    process.stdout.write(args[1] ? renderKindSchema(schema, args[1]) : `${[
      "BURO record types",
      `default: ${schema.default_kind}`,
      ...Object.entries(schema.kinds).map(([name, definition]) => `- ${name}${definition.label ? ` — ${definition.label}` : ""}`),
    ].join("\n")}\n`);
    return 0;
  }
  if (command === "list" || command === "search") {
    const kind = command === "list" ? args[1] : undefined;
    if (kind && schema && !Object.hasOwn(schema.kinds, kind)) throw new Error(`unsupported entity kind: ${kind}`);
    const limit = Number(options.limit ?? 100);
    const offset = Number(options.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error("limit must be 1..1000; offset must be nonnegative");
    const query = command === "search" ? requireArg(args[1], "search requires text") : undefined;
    const result = await client.entitySummaries(kind, { limit, offset, query });
    for (const entity of result.entities) console.log(renderEntityListLine(entity, result.current_context));
    if (result.entities.length === limit) console.log(`# Next page: --limit ${limit} --offset ${offset + limit}`);
    return 0;
  }
  if (command === "current") {
    await printCurrentContext(client, config, schema, options.brief === true);
    return 0;
  }
  if (command === "draft") return runDraftCommand(args, options, config, client, schema);
  const text = await client.packetText(command === "get" ? requireArg(args[1], "get requires an id or name") : command);
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
