import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API_PORT = 8765;
const DEFAULT_BACKUP_RETENTION = 20;
const DEFAULT_PRESET = "starter";

export function contextKey(value) {
  return String(value || "").trim().toLowerCase();
}

function detectedContext(systemHostname = hostname()) {
  return contextKey(String(systemHostname || "unknown").split(".", 1)[0]) || "unknown";
}

function configPath() {
  return process.env.BURO_CONFIG || path.join(homedir(), ".config", "buro", "config.json");
}

function loadFileConfig() {
  const filePath = configPath();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be a JSON object");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`invalid BURO config ${filePath}: ${error.message}`);
  }
}

function normalizeApiUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function bundledPresetPath(preset) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(preset)) throw new Error(`invalid BURO preset name: ${preset}`);
  return fileURLToPath(new URL(`../presets/${preset}.yaml`, import.meta.url));
}

export function loadConfig() {
  const fileConfig = loadFileConfig();
  const currentContext = contextKey(
    process.env.BURO_CURRENT_CONTEXT
      || fileConfig.current_context
      || detectedContext(),
  );
  const mode = String(process.env.BURO_MODE || fileConfig.mode || (process.env.BURO_API_URL ? "client" : "local"))
    .trim()
    .toLowerCase();
  if (!new Set(["local", "central", "client"]).has(mode)) throw new Error(`unsupported BURO mode: ${mode}`);

  const centralHost = contextKey(process.env.BURO_CENTRAL_HOST || fileConfig.central_host || detectedContext());
  const apiUrl = normalizeApiUrl(
    process.env.BURO_API_URL
      || fileConfig.api_url
      || `http://${mode === "client" ? centralHost : "127.0.0.1"}:${DEFAULT_API_PORT}`,
  );
  const instanceRoot = path.resolve(
    process.env.BURO_ROOT || fileConfig.instance_root || path.join(homedir(), ".local", "share", "buro"),
  );
  const stateDir = path.resolve(
    process.env.BURO_STATE_DIR || fileConfig.state_dir || path.join(instanceRoot, "state", "buro"),
  );
  const databasePath = path.resolve(
    process.env.BURO_DATABASE_PATH || fileConfig.database_path || path.join(stateDir, "buro.sqlite3"),
  );
  const backupDir = path.resolve(
    process.env.BURO_BACKUP_DIR || fileConfig.backup_dir || path.join(stateDir, "backups", "sqlite"),
  );
  const backupRetention = Number.parseInt(
    process.env.BURO_BACKUP_RETENTION || fileConfig.backup_retention || DEFAULT_BACKUP_RETENTION,
    10,
  );
  if (!Number.isInteger(backupRetention) || backupRetention < 1) {
    throw new Error("BURO backup retention must be a positive integer");
  }
  const preset = String(process.env.BURO_PRESET || fileConfig.preset || DEFAULT_PRESET).trim().toLowerCase();
  const schemaPath = path.resolve(
    process.env.BURO_SCHEMA_PATH || fileConfig.schema_path || bundledPresetPath(preset),
  );
  const draftPath = path.resolve(
    process.env.BURO_DRAFT_PATH || fileConfig.draft_path || path.join(instanceRoot, "BURO_DRAFT.yaml"),
  );

  return {
    configPath: configPath(),
    currentContext,
    centralHost,
    mode,
    apiUrl,
    instanceRoot,
    stateDir,
    databasePath,
    backupDir,
    backupRetention,
    preset,
    schemaPath,
    draftPath,
  };
}

export function hasDirectStorage(config) {
  return config.mode !== "client";
}
