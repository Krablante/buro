import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const START = "<!-- BURO:START -->";
const END = "<!-- BURO:END -->";
const managed = "managed by BURO";

export function agentContract() {
  return `## BURO Agent Contract

BURO stores durable facts about the user's existing work and environment.
For a named project, service, machine, or other work object, first use
\`buro <id-or-name>\`; use \`buro search <text>\` only when its identity is unclear.
Read the \`buro\` skill when available, or \`buro agent --full\` for the workflow.
Follow relevant recorded rules, read entry documents as needed, and verify
material contradictions. Missing facts or records do not block ordinary work.
Types and fields are configurable; inspect \`buro types <kind>\` when needed.
Paths belong to their recorded machines. Before operating on a machine, read
its recorded rules when not already supplied; \`buro current --brief\` gives
local machine rules without requiring a host record or folder layout.
When authorized to maintain BURO, preserve confirmed durable facts and lasting
decisions from the conversation and work. Do not turn temporary requests,
suggestions, guesses, or session logs into permanent facts. A read-only request
does not authorize writes. Keep affected records consistent with authorized
changes as part of that work. Review changes through draft pull/new/delete,
edit the printed file, inspect draft diff, then draft push; never bypass
revisions or edit SQLite directly. BURO does not grant extra task permissions.
`;
}

async function existing(file) {
  try { return await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function save(file, contents, old) {
  if (old === contents) return;
  await mkdir(path.dirname(file), { recursive: true });
  if (old) await copyFile(file, `${file}.buro-backup-${Date.now()}`);
  await writeFile(file, contents, { mode: 0o600 });
}

async function instructionFile(file) {
  const old = await existing(file);
  const block = `${START}\n${agentContract()}${END}`;
  const start = old.indexOf(START);
  const end = old.indexOf(END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start) || old.indexOf(START, start + START.length) !== -1) {
    throw new Error(`malformed BURO block in ${file}; preserve and repair it before reconnecting`);
  }
  const contents = start === -1 ? `${old}${old && !old.endsWith("\n") ? "\n" : ""}${old ? "\n" : ""}${block}\n`
    : old.slice(0, start) + block + old.slice(end + END.length);
  await save(file, contents, old);
}

async function managedFile(file, resource) {
  const contents = await readFile(new URL(resource, import.meta.url), "utf8");
  const old = await existing(file);
  if (old && !old.includes(managed)) throw new Error(`existing user file ${file}; choose another path or integrate manually`);
  await save(file, contents, old);
}

export async function connectAgent(target, options = {}) {
  const userRoot = options.home || homedir();
  const files = [];
  if (target === "file") {
    if (!options.path) throw new Error("connect file requires --path to an agent instruction file");
    const file = path.resolve(options.path);
    await instructionFile(file);
    return [file];
  }
  if (!["opencodez", "opencode", "codex", "claude"].includes(target)) throw new Error("choose opencodez, opencode, codex, claude, or file");
  const root = options.path ? path.resolve(options.path) : path.join(userRoot,
    target === "codex" ? ".codex" : target === "claude" ? ".claude" : `.config/${target}`);
  const skillRoot = target === "codex" && !options.path ? path.join(userRoot, ".agents", "skills") : path.join(root, "skills");
  // Refuse unrelated files before changing any integration files.
  const skill = path.join(skillRoot, "buro", "SKILL.md");
  const plugin = path.join(root, "plugins", "buro.js");
  for (const file of [skill, ...(["opencode", "opencodez"].includes(target) ? [plugin] : [])]) {
    const old = await existing(file);
    if (old && !old.includes(managed)) throw new Error(`existing user file ${file}; choose another path or integrate manually`);
  }
  await managedFile(skill, "../skills/buro/SKILL.md");
  files.push(skill);
  if (["opencode", "opencodez"].includes(target)) {
    await managedFile(plugin, "../integrations/opencode/plugin.js");
    files.push(plugin);
  } else {
    const file = path.join(root, target === "claude" ? "CLAUDE.md" : "AGENTS.md");
    await instructionFile(file);
    files.push(file);
  }
  return files;
}

export async function fullAgentWorkflow() {
  return readFile(new URL("../skills/buro/SKILL.md", import.meta.url), "utf8");
}
