#!/usr/bin/env node
import { realpathSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, hasDirectStorage } from "./config.js";
import { connectAgent } from "./agent.js";
import { serve } from "./api.js";
import { createApiClient } from "./api-client.js";
import { initializeRegistry, saveConfig } from "./migration.js";
import { loadSchema, loadTypeDefinition, typeDefinition } from "./schema.js";
import { applyChange, resolveCurrentContext, resolveEntity, resolveEntityPacket, resolveEntitySummaries } from "./resolver.js";
import { clearDraft, draftMetadata, dump, lineDiff, readDraft, writeDraft, writeNewRecordDraft } from "./draft.js";
import { renderCliError, renderCurrentContext, renderDefinitions, renderEntityListLine, renderUsage } from "./cli-output.js";
import { renderPacket } from "./packet.js";
import { backupDatabase } from "./db.js";
import { installBackupSchedule, scheduledBackup } from "./backup.js";
import { exportRegistry, importRegistry, restoreRegistry } from "./registry.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
function parse(argv) {
  const args = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) { args.push(token); continue; }
    const [name, ...values] = token.slice(2).split("=");
    if (["help", "version", "dry-run", "scheduled"].includes(name)) { if (values.length) throw new Error(`${name} takes no value`); options[name] = true; }
    else { const value = values.length ? values.join("=") : argv[++i]; if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`); options[name] = value; }
  }
  return { args, options };
}
function syntax(args, options, max, allowed = []) {
  if (args.length > max) throw new Error(`unexpected argument: ${args[max]}`);
  for (const name of Object.keys(options)) if (!allowed.includes(name)) throw new Error(`unsupported option: --${name}`);
}
function required(value, label) { if (!value) throw new Error(`${label} is required; see buro help`); return value; }
function direct(command, config) { if (!hasDirectStorage(config)) throw new Error(`${command} runs on the device holding SQLite; this client uses ${config.apiUrl}`); }

function clientFor(config) {
  if (config.apiUrl) return createApiClient(config.apiUrl, { timeoutMs: config.apiTimeoutMs, currentContext: config.currentContext, currentLimit: config.currentLimit });
  return {
    schema: async () => loadSchema(config),
    entity: (id, exact) => resolveEntity(id, { ...config, exact }),
    packet: id => resolveEntityPacket(id, config),
    entitySummaries: (kind, page) => resolveEntitySummaries(kind, { ...config, ...page }),
    current: () => resolveCurrentContext(config),
    change: (change, dryRun) => applyChange(change, { ...config, dryRun }),
  };
}
async function entityOrNull(client, id, exact = false) { try { return await client.entity(id, exact); } catch (error) { if (error.status === 404) return null; throw error; } }
function ready(file) { console.log(`Draft: ${file}\nEdit the YAML, then:\n  buro draft diff "${file}"\n  buro draft push "${file}"`); }

export async function runCli(argv = process.argv.slice(2)) {
  const { args, options } = parse(argv);
  const command = options.help ? "help" : options.version ? "version" : args[0] || "help";
  if (command === "version") { syntax(args, options, 1, ["version"]); console.log(VERSION); return; }
  if (command === "connect") { syntax(args, options, 2, ["path"]); console.log(await connectAgent(required(args[1], "agent name"), options)); return; }
  const config = loadConfig();
  if (command === "help") {
    syntax(args, options, 1, ["help"]);
    console.log(`BURO ${VERSION}\nMemory: ${config.apiUrl || config.databasePath}\nConfig: ${config.configPath}\n\n${renderUsage()}`);
    try { process.stdout.write(`\nActive definitions\n${renderDefinitions(await clientFor(config).schema())}`); }
    catch (error) { console.log(`\nActive definitions unavailable: ${error.message}`); }
    return;
  }
  if (command === "init") {
    syntax(args, options, 1, ["dry-run"]);
    // v2 used an endpoint in central mode to describe its own server.
    const local = ["central", "local"].includes(config.previousConfig.mode) ? { ...config, apiUrl: "" } : config;
    if (local.apiUrl) {
      await clientFor(local).schema();
      if (!options["dry-run"]) { const { mode, central_host, preset, schema_path, type_files, draft_path, ...settings } = local.previousConfig; await saveConfig(local, settings); }
      console.log(`Shared memory ready: ${local.apiUrl}. This device holds no database or backup schedule.`); return;
    }
    const result = await initializeRegistry(local, { dryRun: Boolean(options["dry-run"]) });
    console.log(`BURO ${options["dry-run"] ? "preview" : "ready"}: ${local.databasePath}\nRecords: ${result.count}; types: ${Object.keys(result.schema.kinds).join(", ")}${result.upgraded ? " (preserved as custom definitions)" : ""}`);
    if (result.backupPath) console.log(`Pre-upgrade snapshot: ${result.backupPath}`);
    if (result.preservedDraftPath) console.log(`Previous single draft preserved: ${result.preservedDraftPath}`);
    if (!options["dry-run"] && local.backupSchedule) { console.log(await installBackupSchedule(local)); for (const file of await scheduledBackup(local)) console.log(`Scheduled snapshot: ${file}`); }
    else if (!options["dry-run"]) console.log("Backup schedule disabled by config.json backup_schedule=false.");
    return;
  }
  if (command === "backup") { syntax(args, options, 1, ["scheduled"]); direct(command, config); const files = options.scheduled ? await scheduledBackup(config) : [await backupDatabase(config.databasePath, config)]; for (const file of files) console.log(`BURO backup created: ${file}`); return; }
  if (command === "serve") { syntax(args, options, 1, ["host", "port"]); direct(command, config); await serve({ ...config, apiHost: options.host, apiPort: options.port }); return; }
  if (["export", "import", "restore"].includes(command)) {
    syntax(args, options, 2, command === "export" ? [] : ["dry-run"]); direct(command, config);
    const file = required(args[1], "file");
    const result = command === "export" ? await exportRegistry(file, config) : await (command === "import" ? importRegistry : restoreRegistry)(file, config, { dryRun: Boolean(options["dry-run"]) });
    console.log(dump(result)); return;
  }
  const client = clientFor(config);
  if (["list", "search"].includes(command)) {
    syntax(args, options, 2, ["limit", "offset"]);
    const limit = Number(options.limit ?? 100), offset = Number(options.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error("limit must be 1..1000; offset must be nonnegative");
    const page = { limit, offset, ...(command === "search" ? { query: required(args[1], "search text") } : {}) };
    const result = await client.entitySummaries(command === "list" ? args[1] : undefined, page);
    for (const entity of result.entities) console.log(renderEntityListLine(entity, result.current_context));
    if (result.entities.length === limit) console.log(`# Next page: --limit ${limit} --offset ${offset + limit}`);
    return;
  }
  if (command === "current") { syntax(args, options, 1); process.stdout.write(renderCurrentContext(await client.current(), renderPacket)); return; }
  if (command === "draft") {
    const action = required(args[1], "draft action");
    syntax(args, options, action === "new" ? 4 : 3);
    const target = required(args[2], "record or draft file");
    if (["diff", "push", "clear"].includes(action)) {
      if (action === "clear") { console.log(`Discarded: ${await clearDraft(target)}`); return; }
      const { metadata, value } = await readDraft(target);
      const result = await client.change({ metadata, value }, action === "diff");
      if (action === "diff") { console.log(`${metadata.subject}: ${result.id}`); process.stdout.write(lineDiff(result.before ? dump(result.before) : "", result.after ? dump(result.after) : "")); if (result.default_kind) console.log(`Default type after change: ${result.default_kind}`); }
      else { await clearDraft(target); console.log(`${result.action}: ${result.id}`); }
      return;
    }
    const schema = await client.schema();
    if (action === "new") { if (await entityOrNull(client, target, true)) throw new Error(`record already exists: ${target}`); ready(await writeNewRecordDraft(target, args[3] || schema.default_kind, schema)); return; }
    if (!["pull", "delete"].includes(action)) throw new Error(`unknown draft action: ${action}`);
    const entity = await entityOrNull(client, target);
    if (!entity) throw new Error(`record not found: ${target}`);
    const { updated_at, ...facts } = entity;
    const metadata = draftMetadata(schema, "record", action === "delete" ? "delete" : "update", entity.id, updated_at);
    ready(await writeDraft(action === "delete" ? null : facts, metadata, schema)); return;
  }
  if (command === "types") {
    syntax(args, options, 3, ["from"]);
    const action = required(args[1], "types new, edit, or delete"), id = required(args[2], "type ID");
    if (!["new", "edit", "delete"].includes(action) || (options.from && action !== "new")) throw new Error("use types new <id> [--from type], types edit <id>, or types delete <id>");
    const schema = await client.schema();
    const kind = schema.kinds[id];
    if (action === "new" ? kind : !kind) throw new Error(action === "new" ? `type already exists: ${id}` : `unknown type: ${id}`);
    if (action !== "new" && kind.origin === "builtin") throw new Error(`copy ${id} to a new ID with types new --from`);
    let value = null;
    if (action === "new") value = options.from ? { ...(["project", "service", "host"].includes(options.from) ? loadTypeDefinition(options.from) : typeDefinition(schema, options.from)), id } : { id, label: id, fields: {} };
    if (action === "edit") value = typeDefinition(schema, id);
    ready(await writeDraft(value, draftMetadata(schema, "type", action === "new" ? "create" : action === "edit" ? "update" : "delete", id, kind?.revision), schema)); return;
  }
  syntax(args, options, command === "get" ? 2 : 1);
  const id = command === "get" ? required(args[1], "record ID or name") : command;
  const packet = await client.packet(id);
  if (!packet) throw new Error(`record not found: ${id}`);
  process.stdout.write(renderPacket(packet));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await runCli(); } catch (error) { process.stderr.write(renderCliError(error)); process.exitCode = 1; }
}
