import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readConfigFile } from "./config.js";
import { saveConfig } from "./migration.js";

const START = "<!-- BURO:START -->", END = "<!-- BURO:END -->";
const targets = ["opencode", "opencodez", "codex", "claude"];
function connectionKey({ target, path: root }) { return `${["opencode", "opencodez"].includes(target) ? "opencode" : target}:${root}`; }
function connectionsFile(home) { return path.join(home, ".config/buro/connections.json"); }
function savedConnections(home) {
  const { connections = [] } = readConfigFile(connectionsFile(home));
  if (!Array.isArray(connections) || connections.some(item => !item || ![...targets, "file"].includes(item.target) || !path.isAbsolute(item.path || "") || (item.target !== "file" && !path.isAbsolute(item.skillRoot || "")))) throw new Error("invalid BURO connections.json; reconnect the affected profiles");
  return connections;
}
async function rememberConnection(connection, home) {
  const connections = savedConnections(home).filter(item => connectionKey(item) !== connectionKey(connection));
  connections.push(connection);
  await saveConfig({ configPath: connectionsFile(home) }, { connections });
}
async function existing(file) { try { return await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } }
async function save(file, contents, old) {
  if (contents === old) return;
  await mkdir(path.dirname(file), { recursive: true });
  if (old) await copyFile(file, `${file}.buro-backup-${Date.now()}`);
  await writeFile(file, contents, { mode: 0o600 });
}
function blockContents(file, old, contents) {
  const start = old.indexOf(START), end = old.indexOf(END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start) || old.indexOf(START, start + START.length) !== -1 || old.indexOf(END, end + END.length) !== -1) throw new Error(`malformed BURO block in ${file}`);
  const block = contents ? `${START}\n${contents.trim()}\n${END}` : "";
  return start === -1 ? contents ? `${old}${old ? "\n\n" : ""}${block}\n` : old : old.slice(0, start) + block + old.slice(end + END.length);
}
export async function connectAgent(target, options = {}) {
  if (!["file", "opencode", "opencodez", "codex", "claude"].includes(target)) throw new Error("choose opencodez, opencode, codex, claude, or file");
  if (target === "file") {
    if (!options.path) throw new Error("connect file requires --path");
    const file = path.resolve(options.path), old = await existing(file);
    await save(file, blockContents(file, old, await readFile(new URL("../skills/buro/system-prompt.md", import.meta.url), "utf8")), old);
    if (options.register !== false) await rememberConnection({ target, path: file }, options.home || homedir());
    return `Instructions added to ${file}. Automatic session context must be configured separately.`;
  }
  const home = options.home || homedir();
  const profile = options.path || (["opencode", "opencodez"].includes(target) && process.env.OPENCODE_CONFIG_DIR);
  const root = profile ? path.resolve(profile) : path.join(home, target === "codex" ? ".codex" : target === "claude" ? ".claude" : `.config/${target}`);
  const skillRoot = options.skillRoot || (target === "codex" && !options.path ? path.join(home, ".agents/skills") : path.join(root, "skills"));
  const resources = [
    [path.join(skillRoot, "buro/SKILL.md"), "../skills/buro/SKILL.md"],
    [path.join(skillRoot, "buro/system-prompt.md"), "../skills/buro/system-prompt.md"],
  ];
  const openCode = ["opencode", "opencodez"].includes(target);
  if (openCode) resources.push([path.join(root, "plugins/buro.js"), "../integrations/opencode/plugin.js"]);
  else resources.push([path.join(root, "hooks/buro-session-start.cjs"), "../integrations/session-start.cjs"]);
  const changes = [];
  for (const [file, resource] of resources) {
    const old = await existing(file);
    if (old && !old.includes("managed by BURO")) throw new Error(`existing user file: ${file}; integrate manually or choose --path`);
    changes.push({ file, old, contents: await readFile(new URL(resource, import.meta.url), "utf8") });
  }
  if (!openCode) {
    const file = path.join(root, target === "codex" ? "hooks.json" : "settings.json");
    const old = await existing(file), config = old ? JSON.parse(old) : {};
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`invalid hook config: ${file}`);
    config.hooks ||= {};
    const previous = config.hooks.SessionStart || [];
    if (!Array.isArray(previous)) throw new Error(`SessionStart must be an array: ${file}`);
    // Remove only our previous handler; preserve every unrelated hook and group.
    const groups = previous.map(group => ({ ...group, hooks: group.hooks.filter(hook => !hook.command?.includes("buro-session-start.cjs")) })).filter(group => group.hooks.length);
    const script = path.join(root, "hooks/buro-session-start.cjs");
    if (/[\r\n"`$]/.test(script + process.execPath)) throw new Error("hook paths contain unsupported shell characters; integrate manually");
    groups.push({ matcher: "startup|clear", hooks: [{ type: "command", command: `"${process.execPath}" "${script}"`, timeout: 10, ...(target === "codex" ? { additionalContextLimit: 16000 } : {}) }] });
    config.hooks.SessionStart = groups;
    changes.push({ file, old, contents: `${JSON.stringify(config, null, 2)}\n` });
    const instructions = path.join(root, target === "codex" ? "AGENTS.md" : "CLAUDE.md");
    const prior = await existing(instructions);
    if (prior.includes(START)) changes.push({ file: instructions, old: prior, contents: blockContents(instructions, prior, "") });
  }
  for (const change of changes) await save(change.file, change.contents, change.old);
  if (options.register !== false) await rememberConnection({ target, path: root, skillRoot }, home);
  return `BURO connected:\n${changes.map(change => change.file).join("\n")}\n${openCode ? "Restart OpenCode/OpenCodez." : target === "codex" ? "Review and trust the SessionStart hook in /hooks, then start a new session. Hooks must be enabled in your Codex version." : "Start a new Claude Code session. SessionStart command hooks must be enabled."}\nSystem prompts are configured by you. Optional text: ${path.join(skillRoot, "buro/system-prompt.md")}.`;
}

export async function refreshConnections({ home = homedir(), profile = home === homedir() ? process.env.OPENCODE_CONFIG_DIR : undefined } = {}) {
  const connections = savedConnections(home);
  // Discover connections installed before tracking existed, without creating new ones.
  for (const target of targets) {
    const root = path.join(home, target === "codex" ? ".codex" : target === "claude" ? ".claude" : `.config/${target}`);
    connections.push({ target, path: root, skillRoot: target === "codex" ? path.join(home, ".agents/skills") : path.join(root, "skills") });
    if (["opencode", "opencodez"].includes(target) && profile) {
      const selected = path.resolve(profile);
      connections.push({ target, path: selected, skillRoot: path.join(selected, "skills") });
    }
  }
  const refreshed = [], failures = [], seen = new Set();
  for (const connection of connections) {
    const { target, path: root } = connection, key = connectionKey(connection);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (target === "file") {
        if (!(await existing(root)).includes(START)) continue;
      } else {
        const openCode = ["opencode", "opencodez"].includes(target);
        const handler = path.join(root, openCode ? "plugins/buro.js" : "hooks/buro-session-start.cjs");
        if (!(await existing(handler)).includes("managed by BURO")) continue;
        if (!openCode) {
          const config = JSON.parse(await existing(path.join(root, target === "codex" ? "hooks.json" : "settings.json")) || "{}");
          if (!config.hooks?.SessionStart?.some(group => group.hooks?.some(hook => hook.command?.includes("buro-session-start.cjs")))) continue;
        }
      }
      await connectAgent(target, { path: root, skillRoot: connection.skillRoot, home, register: false });
      refreshed.push(connection);
    } catch (error) { failures.push(`${target} (${root}): ${error.message}`); }
  }
  if (refreshed.length) {
    const retained = savedConnections(home);
    for (const connection of refreshed) if (!retained.some(item => connectionKey(item) === connectionKey(connection))) retained.push(connection);
    await saveConfig({ configPath: connectionsFile(home) }, { connections: retained });
  }
  if (failures.length) throw new Error(`connection refresh failed:\n${failures.join("\n")}\nFix these profiles and run buro update again.`);
  return refreshed;
}
