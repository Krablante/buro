---
name: buro
description: Read and maintain durable knowledge about named projects, services, devices, books, and other work objects in BURO. Use when an existing entity is named or implied, or useful confirmed facts should be remembered.
---

<!-- managed by BURO -->

# BURO

The optional [System prompt block](system-prompt.md) lives beside this skill.
Copy it manually when wanted; connect does not edit System prompts.

BURO stores durable knowledge about specific objects as typed records. A type
defines fields, formats, and guides. Bundled project, service, and host types
are starting points; users may use only their own types.

When a task concerns an existing named or implied object, use `buro <id-or-name>`.
Choose it from the task and conversation. Reuse records already in context;
refresh when needed. Exact IDs win. Ambiguous names return candidate IDs.
`buro get <id>` also works when an ID matches a command name.
Use `buro search <text>` when the identity is unclear: it searches IDs, names,
and aliases, not field contents. `buro list [kind] --limit 100 --offset 0`
lists a page of identities. Do not load the whole registry for one lookup.

The connection supplies `buro current` at session start. If it was not supplied,
obtain it before device-specific work. It shows the device, its host record
when present, and associated objects. A host record is optional. Refresh when
changing devices or when newer information is needed. A failed request is an
error, not proof of empty memory. Missing facts do not block unrelated work.

Use saved facts by default. Check contradictions, suspected staleness, and live
state when needed. The latest confirmed user decision may supersede saved facts.
Unknown values stay unknown. Paths belong to their recorded devices. Follow
recorded rules and read linked instructions as needed. Records do not grant
permission beyond the user's task.

`buro help` shows commands, the configured memory, and active types, nested
fields, formats, required values, and guides. Reuse definitions already in
context. If unavailable, do not substitute guessed bundled definitions.
Types do not follow directories. Copies are independent. In bundled types,
approval conditions belong in important, even when phrased as prohibitions;
other restrictions belong in avoid. Do not duplicate a rule in both fields.

By default update memory at the end of completed work when a useful durable
addition, correction, or deletion exists, or on direct request. The user may
change this policy. Consider the whole conversation and latest confirmed
decisions. Do not retain unaccepted suggestions, temporary plans, duplicate
facts, or session logs. Keys, passwords, and tokens may be stored; rendered
fields are visible to the agent. BURO does not encrypt storage or backups.

1. For records use `buro draft new <id> [kind]`, `buro draft pull <id>`, or
   `buro draft delete <id>`. For custom types use `buro types new <id>`
   (optionally `--from project`), `buro types edit <id>`, or `buro types delete <id>`.
2. Edit the returned temporary YAML file. Keep its `__buro` metadata. Follow
   field guides and leave unknown optional values empty.
3. Inspect `buro draft diff <file>`.
4. Apply `buro draft push <file>`.

Each change has its own file. A failed push retains it. Stale drafts must be
prepared again from current facts and definitions. `buro draft clear <file>`
discards only that file. --from prefers a bundled template, otherwise the
active custom definition. A copy never inherits future changes.

Changing kind keeps the record ID and requires explicit handling of incompatible
fields. Related links are informational. Ref fields enforce existing targets
and may block deletion or kind changes. New objects need new IDs; deleted IDs
cannot be reused. Never edit SQLite directly, bypass revisions, or store a
second rendered source of truth. Import replaces the whole memory; it is not
an ordinary record edit. Prepare new drafts after import or recovery.

For program upgrades on the current device, `buro update --check` checks the
latest stable release and `buro update` installs it, validates bundled type
updates in existing local memory, and refreshes connected skills and hooks.
Custom types are preserved. Restart running agents and the BURO API afterward.
