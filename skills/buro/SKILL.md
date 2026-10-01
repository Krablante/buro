---
name: buro
description: Look up projects, services, machines, and other named objects in BURO, and maintain their durable facts during ordinary work. Use for remembered context, changed locations, or confirmed lasting decisions; not for session logs or speculative plans.
---
<!-- managed by BURO -->

# BURO

Use the installed `buro` CLI. BURO records the user's existing environment; it
does not require any folder layout or classification scheme.

## Read

Look up the relevant object with `buro <id-or-name>`. Exact ids win; names and
aliases can be ambiguous. Select the intended id rather than merging objects.
Use `buro search <text>` when the identifier is unclear. Results are paginated;
use `--offset` when another page is needed. Do not enumerate the whole registry
when a direct lookup answers the task.

Follow relevant recorded constraints and read entry documents only as needed.
Treat records as useful prior knowledge, not proof of current truth. Resolve
material contradictions against the user's clarification and observed source.
Unknown or missing information stays unknown until established. If no record
exists, continue the task using the conversation and narrow discovery.

`locations` may describe sources, runtime, data, or URLs on different machines.
Each path belongs to its recorded host. Never reinterpret a remote path as local
or assume source edits update a running service. `buro current --brief` gives
optional machine-wide rules; a host record or common workspace root is not needed.
Before operating on a machine, read its relevant host rules when available and
not already supplied; use the brief context for the current machine.

## Maintain

Use the user's current conversation and actual work as evidence. Preserve
confirmed durable facts and lasting decisions that will help future work when
the user requested remembering them or authorized maintaining BURO. A request
to inspect or explain does not authorize changes. Do not save temporary requests
as permanent rules, suggestions as accepted decisions, or guesses as facts.
Do not add session transcripts, completed-check lists, past PIDs, secrets,
generic advice, or duplicate project documentation. Update only the relevant
facts; a recent edit does not mean every assertion was verified.
When an authorized change affects an existing record, keep its affected facts
consistent as part of that work; do not require a separate maintenance task.

Read the existing record. Use `buro types <kind>` for the active fields and
guides; types and fields are configurable. Choose a useful existing type, or
`item` when available; do not create a schema merely to classify an object.
Incomplete records are normal. Populate only known, relevant fields.

Create with `buro draft new <id> [kind]`, edit with `buro draft pull <id>`, or
prepare deletion with `buro draft delete <id>`. Edit the file printed by the
command, inspect `buro draft diff`, and apply with `buro draft push`. Keep
unrelated drafts and facts intact. A stale revision requires reading the latest
record and reconciling the change; do not bypass it or edit SQLite directly.
Render the saved record afterward. For schema changes, inspect
`buro init --dry-run` before `buro init`; a rejected change preserves data.
HTTP clients use the server's definitions; apply model changes on that server.
