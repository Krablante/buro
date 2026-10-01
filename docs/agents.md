# Connecting an agent

[English](agents.md) · [Русский](agents.ru.md) · [README](../README.md)

Run `buro init`, then `buro connect <client>`. BURO connects to terminal-capable
agents; it does not read chat history or run a model itself. Your agent chooses
relevant records using the ongoing conversation and maintains durable facts
when you authorize it to do so. Choosing a connection does not grant blanket
write permissions or change the agent's existing task permissions.

| Client | Installation |
| --- | --- |
| OpenCodez | `~/.config/opencodez/plugins/buro.js` and `skills/buro/SKILL.md` |
| OpenCode | `~/.config/opencode/plugins/buro.js` and `skills/buro/SKILL.md` |
| Codex | A managed block in `~/.codex/AGENTS.md` and `~/.agents/skills/buro/SKILL.md` |
| Claude Code | A managed block in `~/.claude/CLAUDE.md` and `skills/buro/SKILL.md` |
| Another agent | `buro connect file --path <instruction-file>` adds the managed block |

`--path <directory>` selects a different client profile for named clients.
For an isolated Codex profile, the skill is placed in that directory's `skills/`;
the default uses Codex's user-wide `.agents/skills` location. Ensure a custom
client configuration actually discovers the chosen profile and skills.

OpenCode plugins are automatically discovered, so no JSONC settings rewrite is
needed. Restart OpenCode/OpenCodez after installation. Other clients should
start a new session. A plugin caches instructions, not entity facts, and BURO
being unavailable does not prevent the conversation from starting.

Connections are repeatable. Instruction blocks preserve surrounding text;
managed files may only replace BURO-managed files. A changed existing file is
backed up beside itself. An unrelated file at a managed path stops installation.
Reconnect after upgrading BURO to refresh installed skills and plugin code.
BURO is never copied into a project's source tree unless you choose that path.

Use `buro agent` for a short System prompt block and `buro agent --full` for the
same complete workflow shipped in the skill. The rules are independent of the
active types and folder layout. Custom types explain their fields through guides.

The connection can be verified without model calls: inspect the installed
files, run `buro agent`, and confirm `buro <known-record>` works in the same
terminal environment as the agent. To check agent behavior, ask it to look up
a known object, remember an authorized durable rule, and use it in a new session.
Model compliance is not guaranteed by successful file installation.

Clients with no terminal access need another tool transport; this release
provides CLI and HTTP, not an MCP server. HTTP alone does not install agent rules.
