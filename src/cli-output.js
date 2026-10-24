export function renderUsage() {
  return `BURO stores durable knowledge about specific work objects as typed records.

Read:
  buro <id-or-name>                 Open one complete record; exact IDs win
  buro get <id-or-name>             Also works for IDs matching command names
  buro search <text>                Search IDs, names, aliases (not field contents)
  buro list [kind]                  List identities; --limit 100 --offset 0
  buro current                     Current device, its record, associated objects

Change records:
  buro draft new <id> [kind]
  buro draft pull <id-or-name>
  buro draft delete <id-or-name>
Change custom types:
  buro types new <id> [--from <type>]
  buro types edit <id>
  buro types delete <id>
Each command prints its own temporary YAML file. Keep its __buro metadata:
  buro draft diff <file>            Validate and review this change
  buro draft push <file>            Apply; remove this file only after success
  buro draft clear <file>           Discard only this draft
Stale drafts must be prepared again. Changing kind preserves the record ID;
handle incompatible fields explicitly. Deleted record IDs cannot be reused.
Copies are independent. --from prefers the bundled template when one exists,
otherwise the active custom type. Bundled types cannot be edited or deleted.

Setup and operation:
  buro update [--check]             Latest stable GitHub release; --check only reads
  buro init [--dry-run]             Create memory or preview/upgrade saved types
  buro connect <opencodez|opencode|codex|claude> [--path <profile>]
                                   Install skill and session context connection
  buro connect file --path <file>   Explicitly add instructions to that file
  buro export <file>               Save all records, types, retired IDs
  buro import <file> [--dry-run]    Replace the WHOLE memory; preview removals
  buro backup [--scheduled]         Snapshot; scheduled keeps hourly/daily groups
  buro restore <snapshot> [--dry-run]
                                   Restore memory and device context settings
  buro serve [--host <address>] [--port <port>]  Share local memory over HTTP
  buro help                        Commands and active definitions
  buro --version

connect never edits System prompts. A ready-to-copy prompt is included in the
package at skills/buro/system-prompt.md, beside SKILL.md. Enable it yourself if wanted.
OpenCode/OpenCodez need a restart; Codex needs hook review in /hooks.
No api_url: local SQLite. api_url set: shared memory, no local fallback.
The HTTP server has no authentication or TLS; restrict access to trusted clients.
Before writes BURO requires a successful snapshot. Import/restore invalidates
old drafts. Snapshot groups: 8 every 3h, 8 daily, 20 before mutations.
Keys and tokens may be stored, but storage, exports, and backups are unencrypted.
`;
}
export function renderDefinitions(schema) {
  const lines = [`Default type: ${schema.default_kind}`];
  function fields(definitions, indent) {
    for (const [name, field] of Object.entries(definitions)) {
      lines.push(`${indent}${name} (${field.type}, ${field.required ? "required" : "optional"}${field.target_kind ? ` → ${field.target_kind}` : ""}${field.packet === false ? ", hidden in packets" : ""})${field.guide ? `: ${field.guide}` : ""}`);
      if (field.default !== undefined) lines.push(`${indent}  default: ${JSON.stringify(field.default)}`);
      if (field.fields) fields(field.fields, `${indent}  `);
    }
  }
  for (const [id, kind] of Object.entries(schema.kinds)) {
    lines.push("", `${id}${kind.label ? ` — ${kind.label}` : ""} [${kind.origin === "builtin" ? "bundled" : "custom"}]`, "  id, name, kind (string, required): permanent ID, display name, record type");
    fields(kind.definitions, "  ");
  }
  return `${lines.join("\n")}\n`;
}
export function renderEntityListLine(entity, currentContext) { return `${entity.kind}\t${entity.id}\t${entity.name}${entity.id === currentContext ? " [CURRENT]" : ""}`; }
export function renderCurrentContext(current, renderPacket) {
  return [`## BURO Current Context`, "", "source: buro current", `device: ${current.context.id}`, "", current.packet ? renderPacket(current.packet).trimEnd() : "No host record for this device. This is normal.", "", "Associated objects:", ...current.members.map(entity => renderEntityListLine(entity)), ...(current.members.length ? [] : ["No associated records."]), ...(current.truncated ? [`Limited to ${current.limit} records; use search or list to narrow the lookup.`] : [])].join("\n") + "\n";
}
export function renderCliError(error) { return `BURO error: ${error.message || error}\n`; }
