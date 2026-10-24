# Agent connections

[English](agents.md) · [Русский](agents.ru.md) · [README](../README.md)

Agents need terminal access to `buro` and instructions about when to use memory.
The supplied skill explains lookup and reviewed maintenance. The optional
[System prompt block](../skills/buro/system-prompt.md) lives beside SKILL.md and can be copied manually.
BURO never selects or rewrites your System prompt.

## Included connections

| Target | Files installed in the default profile | Session context |
| --- | --- | --- |
| opencodez | ~/.config/opencodez/skills/buro/SKILL.md; plugins/buro.js | System transform plugin |
| opencode | ~/.config/opencode/skills/buro/SKILL.md; plugins/buro.js | System transform plugin |
| codex | ~/.agents/skills/buro/SKILL.md; ~/.codex/hooks/buro-session-start.cjs; hooks.json | SessionStart command hook |
| claude | ~/.claude/skills/buro/SKILL.md; hooks/buro-session-start.cjs; settings.json | SessionStart command hook |

Run `buro connect <target>`. For OpenCode/OpenCodez, `OPENCODE_CONFIG_DIR` selects
the profile when set; `--path <profile>` takes precedence. An explicit profile's
skill goes under its skills directory. Unrelated hooks and
settings are retained. Files changed by connect receive a backup; unchanged
connections are not rewritten. A conflicting unmanaged skill or plugin is
reported instead of overwritten. Old BURO-managed instruction blocks in Codex
or Claude instruction files are removed when reconnecting; other text stays.

Each connection installs `system-prompt.md` beside `buro/SKILL.md`. It is a
ready-to-copy resource; the connection does not insert it into a System prompt.

OpenCode and OpenCodez load the plugin at startup and require a restart. The
plugin uses `experimental.chat.system.transform`, runs current once per session,
coalesces concurrent first requests, and reuses that result for subsequent model
requests. Deleting a session releases its cache entry. Only current context is
supplied; the plugin does not insert the agent contract or all definitions.

Local Codex must support `hooks.json`, SessionStart, and `hookSpecificOutput.additionalContext`.
Current releases document these in [Codex hooks](https://developers.openai.com/codex/hooks).
Run `/hooks` to inspect and trust the installed definition, enable hooks if
disabled, then start a new session. Hook trust is controlled by Codex; connect
does not bypass it. Claude Code must support SessionStart command hooks and
additionalContext; see [Claude hooks](https://code.claude.com/docs/en/hooks).
The shared runner is a Node CommonJS file with no third-party dependencies.

SessionStart matches startup or clear. Resuming a session reuses its existing
context; compacting does not trigger another automatic load. Refresh with
`buro current` when needed. These integrations target local terminal harnesses;
they do not configure cloud-hosted Codex sessions.

The command has an eight-second deadline. A missing CLI, timeout, unreachable
server, or invalid current output produces a visible memory-loading error while
allowing the conversation to begin. The full device record can contain whatever
you saved there, including secrets. Keep its contents appropriate for automatic
context and use current_limit to bound the identity list.

## Other agents

```sh
buro connect file --path /path/to/AGENTS.md
```

This explicit command maintains a marked instruction block in the chosen file.
It installs neither a plugin nor automatic current. Alternatively copy the
supplied prompt or skill and configure the harness's own startup mechanism.
The agent should obtain current before device-specific work when it has not
already received it.

`buro update` refreshes existing connections from the same release, then asks you
to restart connected agents. Connect records each profile's location, including
`--path`, for later refreshes. Default profiles from older releases are discovered
automatically; reconnect an older custom profile or explicit instruction file
once to register it. A manual npm upgrade still needs connect. See
[updating BURO](operations.md#updating-buro) for package and memory behavior.
