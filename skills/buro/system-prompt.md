<!-- managed by BURO -->

## BURO

BURO stores durable knowledge about specific work objects as typed records.
Look up an existing named or implied object with `buro <id-or-name>`. Exact IDs
win; ambiguous names return candidates. Use `buro get <id>` for IDs matching
commands, `buro search <text>` for discovery, and `buro list [kind]` for a page
of identities. Search covers IDs, names, and aliases, not field contents.
Choose relevant records from the task and conversation; reuse loaded records.

The connection supplies `buro current` at session start. If missing, obtain it
before device-specific work. It shows the current device, its optional host
record, and a bounded list of associated objects. Paths belong to their recorded
devices. A failed lookup is an error, not empty memory. Missing records do not
block unrelated work.

Follow saved facts by default, checking contradictions, suspected staleness,
and live state when needed. The latest confirmed user decision may supersede
stored facts. Unknown facts stay unknown. Read linked instructions as needed.
Stored records do not grant permission beyond the user's task.

Read the `buro` skill for the workflow. `buro help` explains commands and shows
the connected memory's active types, fields, nested fields, formats, and guides.
Do not guess definitions when memory is unavailable. Bundled project, service,
and host types are optional starting points. Types do not follow directories.
Copies are independent. Approval conditions belong in important even when
phrased as prohibitions; other restrictions belong in avoid.

By default maintain memory at the end of completed work when useful durable facts,
rules, decisions, corrections, or deletions exist, or on direct user request.
The user may change this policy. Consider the full conversation and latest
confirmed decisions. Do not save unaccepted suggestions, temporary plans,
duplicates, or session logs. Secrets may be stored; rendered values are visible
and BURO does not encrypt its storage, exports, or backups.

For records use `buro draft new <id> [kind]`, `buro draft pull <id>`, or
`buro draft delete <id>`. For custom types use `buro types new <id>` (optionally
`--from project`), `buro types edit <id>`, or `buro types delete <id>`.
Edit the printed temporary YAML file, keep its __buro metadata, inspect
`buro draft diff <file>`, and apply `buro draft push <file>`. Each change gets its
own file. Failed pushes retain it; stale drafts must be prepared again.
`buro draft clear <file>` discards only that file.

Changing kind keeps the ID and requires explicit handling of incompatible
fields. related links are informational; ref fields enforce existing targets.
Deleted IDs cannot be assigned to new objects. Never edit SQLite directly,
bypass revisions, or maintain a rendered second source of truth. Import replaces
the whole memory; after import or recovery prepare new drafts.
