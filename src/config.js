import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";

export function contextKey(value) { return String(value || "").trim().toLowerCase(); }

export function readConfigFile(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`invalid BURO config ${file}: ${error.message}`);
  }
}

export function loadConfig() {
  const configPath = path.resolve(process.env.BURO_CONFIG || path.join(homedir(), ".config/buro/config.json"));
  const file = readConfigFile(configPath);
  const setting = (key, fallback) => process.env[`BURO_${key.toUpperCase()}`] ?? file[key] ?? fallback;
  const instanceRoot = path.resolve(setting("root", file.instance_root || path.join(homedir(), ".local/share/buro")));
  const stateDir = path.resolve(setting("state_dir", path.join(instanceRoot, "state/buro")));
  const apiUrl = String(setting("api_url", "")).replace(/\/+$/, "");
  if (!apiUrl && file.mode === "client" && process.env.BURO_API_URL === undefined) throw new Error("v2 client configuration needs api_url for its existing shared memory; no local database was opened");
  if (file.backup_schedule !== undefined && typeof file.backup_schedule !== "boolean") throw new Error("backup_schedule must be boolean");
  if (apiUrl && !/^https?:\/\//.test(apiUrl)) throw new Error("api_url must be an HTTP or HTTPS URL");
  const integer = (key, fallback, max = 2147483647) => {
    const value = Number(setting(key, fallback));
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${key} must be an integer from 1 to ${max}`);
    return value;
  };
  return {
    configPath, instanceRoot, stateDir, apiUrl,
    currentContext: contextKey(setting("current_context", hostname().split(".")[0])),
    currentLimit: integer("current_limit", 100, 10000),
    apiTimeoutMs: integer("api_timeout_ms", 5000),
    databasePath: path.resolve(setting("database_path", path.join(stateDir, "buro.sqlite3"))),
    backupDir: path.resolve(setting("backup_dir", path.join(stateDir, "backups/sqlite"))),
    backupRetention: integer("backup_retention", 20),
    backupSchedule: file.backup_schedule !== false,
    // Read only during the one-time v2 upgrade; never used to select a live model.
    previousConfig: file,
  };
}

export function hasDirectStorage(config) { return !config.apiUrl; }
