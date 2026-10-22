import { readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { backupDatabase, openDatabase, withWriteTransaction } from "./db.js";
import { serializeMutation } from "./resolver.js";

const run = promisify(execFile);
export async function scheduledBackup(config) {
  return serializeMutation(async () => {
    const database = openDatabase(config.databasePath, { mustExist: true });
    try {
      return await withWriteTransaction(database, async () => {
        const results = [];
        for (const [group, interval] of [["hourly", 3 * 3600000], ["daily", 24 * 3600000]]) {
          const directory = path.join(config.backupDir, group);
          const names = existsSync(directory) ? (await readdir(directory)).filter(name => /^buro-\d{8}T\d{9}Z-[a-f0-9-]+\.sqlite3$/.test(name)).sort() : [];
          const latest = names.at(-1)?.match(/^buro-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z/);
          const when = latest ? Date.UTC(...latest.slice(1).map((value, index) => Number(value) - (index === 1 ? 1 : 0))) : 0;
          if (Date.now() - when >= interval) results.push(await backupDatabase(config.databasePath, { ...config, group }));
        }
        return results;
      });
    } finally { database.close(); }
  });
}

// Native timers start a short-lived CLI. No daemon, overlapping catch-up jobs,
// or extra scheduler dependency is needed.
export async function installBackupSchedule(config) {
  const id = createHash("sha256").update(config.databasePath).digest("hex").slice(0, 12);
  const name = `buro-backup-${id}`;
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const environment = { BURO_CONFIG: config.configPath, BURO_DATABASE_PATH: config.databasePath, BURO_BACKUP_DIR: config.backupDir, BURO_CURRENT_CONTEXT: config.currentContext, BURO_CURRENT_LIMIT: String(config.currentLimit), BURO_API_URL: "" };
  const quote = value => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
  try {
    if (process.platform === "linux") {
      const directory = path.join(homedir(), ".config/systemd/user");
      await mkdir(directory, { recursive: true });
      const service = `[Unit]\nDescription=BURO scheduled snapshots\n[Service]\nType=oneshot\n${Object.entries(environment).map(([key, value]) => `Environment=${quote(`${key}=${value}`)}`).join("\n")}\nExecStart=${quote(process.execPath)} ${quote(cli)} backup --scheduled\nUMask=0077\n`;
      const timer = `[Unit]\nDescription=BURO backup schedule\n[Timer]\nOnCalendar=*-*-* 00/3:00:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n`;
      await writeFile(path.join(directory, `${name}.service`), service, { mode: 0o600 });
      await writeFile(path.join(directory, `${name}.timer`), timer, { mode: 0o600 });
      await run("systemctl", ["--user", "daemon-reload"]);
      await run("systemctl", ["--user", "enable", "--now", `${name}.timer`]);
      return `Backup schedule enabled: ${name}.timer (3 hours; daily snapshots retained separately).`;
    }
    if (process.platform === "darwin") {
      const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      const directory = path.join(homedir(), "Library/LaunchAgents");
      const file = path.join(directory, `org.buro.${id}.plist`);
      await mkdir(directory, { recursive: true });
      await writeFile(file, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>org.buro.${id}</string><key>ProgramArguments</key><array>${[process.execPath, cli, "backup", "--scheduled"].map(value => `<string>${xml(value)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join("")}</dict><key>StartInterval</key><integer>10800</integer><key>RunAtLoad</key><true/></dict></plist>`, { mode: 0o600 });
      await run("launchctl", ["bootout", `gui/${process.getuid()}`, file]).catch(() => {});
      await run("launchctl", ["bootstrap", `gui/${process.getuid()}`, file]);
      return `Backup schedule enabled: org.buro.${id}.`;
    }
    if (process.platform === "win32") {
      const ps = value => `'${value.replaceAll("'", "''")}'`;
      const command = `${Object.entries(environment).map(([key, value]) => `$env:${key}=${ps(value)}; `).join("")}& ${ps(process.execPath)} ${ps(cli)} backup --scheduled`;
      const encoded = Buffer.from(command, "utf16le").toString("base64");
      const script = `$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -EncodedCommand ${encoded}'; $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 3); $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName ${ps(name)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`;
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      return `Backup schedule enabled: ${name}.`;
    }
    throw new Error(`no native scheduler integration for ${process.platform}`);
  } catch (error) { return `Backup schedule NOT enabled: ${error.message.split("\n")[0]}. Run buro backup --scheduled every 3 hours using your scheduler (BURO_CONFIG=${config.configPath}).`; }
}
