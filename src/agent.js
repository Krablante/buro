import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const START = "<!-- BURO:START -->", END = "<!-- BURO:END -->";
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
    return `Instructions added to ${file}. Automatic session context must be configured separately.`;
  }
  const home = options.home || homedir();
  const profile = options.path || (["opencode", "opencodez"].includes(target) && process.env.OPENCODE_CONFIG_DIR);
  const root = profile ? path.resolve(profile) : path.join(home, target === "codex" ? ".codex" : target === "claude" ? ".claude" : `.config/${target}`);
  const skillRoot = target === "codex" && !options.path ? path.join(home, ".agents/skills") : path.join(root, "skills");
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
  return `BURO connected:\n${changes.map(change => change.file).join("\n")}\n${openCode ? "Restart OpenCode/OpenCodez." : target === "codex" ? "Review and trust the SessionStart hook in /hooks, then start a new session. Hooks must be enabled in your Codex version." : "Start a new Claude Code session. SessionStart command hooks must be enabled."}\nSystem prompts are configured by you. Optional text: ${path.join(skillRoot, "buro/system-prompt.md")}.`;
}
