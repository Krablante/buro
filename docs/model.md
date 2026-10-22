# Records, types, and changes

[English](model.md) · [Русский](model.ru.md) · [README](../README.md)

One record describes one specific object. Its ID is unique across the memory,
permanent, and never reassigned after deletion. Names may repeat. Exact IDs take
precedence over names or aliases. Restoring a backup may bring back the original
record with its original ID.

## Bundled types

`project` describes a product or independent undertaking, including a book or
research project. `service` describes a technical working-environment component.
`host` describes a computer, server, or VM. Source and runtime information can
remain in one record; a separate service record is useful when the component
has its own maintenance responsibility.

All three share eight optional fields:

| Field | Meaning |
| --- | --- |
| summary | What it is, why it exists, what it does |
| important | Confirmed facts, decisions, requirements, approval conditions |
| avoid | Other prohibitions and operating restrictions |
| locations | Source, runtime, data, materials, or web locations |
| related | Informational references to records, files, or web resources |
| read_first | Main documents and instructions |
| aliases | Alternate lookup names |
| notes | Durable details beyond the short summary |

Approval conditions always belong in `important`, including “do not publish
without approval.” Do not duplicate the same rule in `avoid`.
Project and service add optional `repo`. Host adds optional `addresses`
(string-list), `ssh_target` (string), and `git_identities` (records containing
user_name, user_email, gh_cli_user, instructions).

Each location may contain `host`, `path`, `url`, and `purpose`. A new path must
be absolute. A missing host on a new path is filled with the client's device;
diff shows the addition. A host record is optional. Related entries select
exactly one of `id`, `path`, or `url`, with optional `note`. They do not enforce
target existence or prevent deletion. A `ref` field does both.

## Custom types

`buro types new book` prints a temporary YAML file. Keep its `__buro` metadata
and edit the definition below it:

```yaml
id: book
label: Book
fields:
  editorial_rules:
    type: string-list
    guide: Confirmed editorial requirements for this book.
  published:
    type: boolean
    guide: Whether the book has been published.
```

Run `buro draft diff <file>`, then `buro draft push <file>`. The type is immediately
available. `buro types edit book` and `buro types delete book` prepare changes
through the same workflow. A used type cannot be deleted. Bundled types cannot
be edited or deleted; make an independent copy with `types new my-project --from project`.

`--from` prefers the bundled template even when a migrated custom type has the
same ID. Otherwise it copies the active custom definition. Copies have no
inheritance and never receive future changes to their source.

The type's `id` is permanent. `label` is optional and can change independently.
Fields are local to the type: the same name may have a different format or
guide in another type. No bundled fields are automatically mixed into yours.

| Format | Value |
| --- | --- |
| string / text | Short / extended text |
| boolean | YAML true or false |
| integer / number | Safe whole number / finite number |
| string-list | List of non-empty strings |
| record / record-list | Nested fields / list of those objects |
| ref | Existing record ID; optional target_kind limits its type |

`guide` explains what to save. `required: true` requires a value. `default`
supplies an omitted value. `section` groups fields in record output; definition
order controls display order. `packet: false` hides a field from normal record
output, not from storage or direct API reads. It is not a secrecy boundary.
Nested fields use the same definitions. Empty custom types are valid.
When a type change supplies defaults to older records, those values are saved
in the same transaction. Changing the default later does not rewrite them.
For migrated definitions, `paired_fields` preserves an existing constraint that
listed nested fields must be present together.

Only string-list `aliases` participates in alias lookup. Standard locations
participate in device membership. Other field names do not add hidden behavior.
Unknown fields and invalid formats are rejected. `buro help` describes the
definitions of the connected memory, including nested guides.

## Reviewed changes

`draft new`, `draft pull`, `draft delete`, and type commands each return their
own temporary file. It is created with private permissions. Keep the service
metadata, edit the content, inspect `draft diff <file>`, then `draft push <file>`.
Push removes only its successfully applied file. Failed pushes retain it;
`draft clear <file>` deliberately discards that one file.

Diff runs the same validation as push. Push validates again inside the write
transaction. Other records can change concurrently. A changed record revision,
changed relevant type revision, or replaced memory rejects the stale draft.
Pull a fresh one and reconcile the intended facts. A preview does not reserve
the right to write later.

Changing a record's kind keeps its ID. Explicitly move or delete incompatible
fields; leaving unknown fields rejects the change. Diff shows every removed
value. Incoming refs constrained to the former kind block the move until fixed.
Renaming a field requires an explicit data migration too. Validate bulk changes
on a copy; import replaces the entire memory and is not a shortcut for one edit.

## Upgrade from v2

Stop the API, keep the previous package and a snapshot, install v3, preview
`buro init --dry-run`, then apply `buro init` and restart the API. Update shared
clients and connections together.

V2's applied model is already saved in SQLite. V3 expands those saved definitions
into independent custom types under their previous IDs, including project,
service, item, or lab when present. Record IDs, values, and revisions are preserved.
These types do not merge with new templates or inherit their updates. External
type files and preset selections are no longer used. Init removes obsolete
selection and mode settings after successful adoption. V2's single draft is
not accepted by v3; preserve its intended edits and prepare new file drafts.

Lookup aliases in v3 use a declared string-list `aliases`. If an old context
used a differently named device alias field, add aliases to the custom host
definition and copy its alternate names through reviewed record drafts. The
old field values remain intact; v3 does not give arbitrary fields hidden lookup
behavior. A custom context kind other than host remains an ordinary custom type.

For a new template, create a differently named type with `--from` and explicitly
move records. Removing old content is a separate reviewed operation. A database
without a saved model must first be opened and initialized with BURO v2 and its
original definitions. V3 exports contain the complete active model; v1 presets
and older export formats are not read by v3.
