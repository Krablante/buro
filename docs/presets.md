# Presets

A preset is declarative YAML selected by `preset` / `BURO_PRESET`, or loaded from `schema_path` / `BURO_SCHEMA_PATH`. It defines one id, version, default kind, current-context relationship, finite kinds, finite fields, reusable field sets, and optional plain-language section guidance.

The engine supports string, text, boolean, integer, number, reference, string-list, record, and record-list fields. A top-level reference may declare `target_kind`. Records declare finite nested fields and are shape-validated recursively.

Preset definitions are strict. Unknown options, wrong option types, invalid defaults, broken field sets, invalid context fields, unused section definitions, and unknown reference targets fail at load time. Presets cannot execute code, SQL, hooks, processors, plugins, or templates.

`sections.<name>.guide` explains what a section means wherever a populated entity is rendered and wherever that section appears in a draft. Optional `draft_guide` adds filling advice only to drafts. Existing field `guide` values remain the concise meaning of individual fields and are shown in rendered packets, help, schema output, and drafts. Guidance must be one line and is never stored in SQLite.

Guidance wording is presentation metadata and does not affect the model hash. A wording correction can therefore keep the same preset version. Change `version` when the contract or meaning of the preset changes, and use `buro init` to validate and adopt that version against existing entities.

The bundled `starter` preset is the default. It provides `host`, `project`, `service`, and `document` kinds and works in both single-host and multihost modes. `politia` is the real production preset used by Politia. Both contain structure only; instance ids, paths, repositories, network data, and operating facts belong exclusively in SQLite.

## A small custom preset

This replaces the vocabulary with workspaces and notes while preserving the BURO engine:

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
    guide: A short verified explanation of the item.
    draft_guide: Describe the item itself, not the current task.
  details:
    guide: Additional facts that help classify or find the item.

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

Save it outside the installed package and set `schema_path` to that file. Increment `version` whenever its data contract or meaning changes; guidance-only wording corrections do not require a version bump. If existing data remains compatible, run `buro init` to validate every row and adopt the new binding. Otherwise export, transform the manifest outside BURO, and import it under the new preset with `--adopt`.
