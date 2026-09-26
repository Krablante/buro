# Entity model and presets

[English](model.md) · [Русский](model.ru.md) · [README](../README.md)

An entity has a stable `id`, a human `name`, a preset-defined `kind`, and a
revision (`updated_at`). The remaining fields belong to that kind. Use
`buro schema` to see the active preset and `buro schema <kind>` to see its
fields and guidance. `buro list [kind]` discovers identifiers; `buro <id>`
renders a packet.

The preset defines the vocabulary, field order, section guides, and the
relationship between a current context (usually a host) and its members.
It contains **structure**, never an instance's private records. The bundled
[`starter`](../presets/starter.yaml) defines host, project, service, and
document; [`politia`](../presets/politia.yaml) is a larger production
vocabulary. Choose one with `preset` / `BURO_PRESET`, or set `schema_path` /
`BURO_SCHEMA_PATH` to your own YAML file.

## A custom vocabulary

This example uses workspaces and notes. Save it outside the installed package,
point `schema_path` at it, then run `buro init` in local or central mode.

```yaml
id: notes
version: 1
default_kind: note

context:
  kind: workspace
  alias_field: aliases
  member_field: workspace
  root_field: root

sections:
  summary:
    guide: A short verified description of the item.
    draft_guide: Describe the item itself, not today's task.
  details:
    guide: Useful details about the item.

kinds:
  note:
    fields: [workspace, summary, tags]
  workspace:
    fields: [aliases, root, summary]

fields:
  workspace:
    type: ref
    target_kind: workspace
    section: location
  aliases:
    type: string-list
    section: identity
  root:
    type: string
    section: location
    required: true
  summary:
    type: text
    section: summary
    required: true
  tags:
    type: string-list
    section: details
```

The engine supports `string`, `text`, `boolean`, `integer`, `number`, `ref`,
`string-list`, `record`, and `record-list`. Nested records declare their own
finite fields. Unknown fields and invalid values fail validation. Top-level
references with `target_kind` must point to a record of that kind. String
paths and URLs are stored as facts; BURO does not check external resources.

`sections.<name>.guide` appears with a populated section in packets and
drafts; `draft_guide` appears only in drafts. A field's `guide` appears in
packets, help, schema output, and drafts. `packet: false` keeps a field out of
rendered packets while retaining it in entity JSON. `draft_optional: false`
hides an absent optional field from drafts. Guides are one line and are never
stored as entity data.

Preset definitions are checked when loaded: unknown options, broken field
sets, invalid defaults, context fields, and reference targets are rejected.
The preset cannot run code or SQL. Context identifiers and aliases match
case-insensitively; dots and colons remain significant. Ambiguous context
names are rejected.

## Changing a live model

SQLite binds to the preset id, version, and model hash. Guide wording is
excluded from the hash; editing it leaves existing data usable. When the
contract or meaning changes, increase `version`. `buro init` backs up the
database and validates every stored entity before adopting a compatible
version. A changed model hash at the same version is refused.

For an incompatible change, [export the complete registry](interfaces.md)
under the old preset, transform the manifest outside BURO, then import under
the new preset with `--adopt`. Import checks all records and references before
replacing the registry.
