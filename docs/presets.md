# Presets

A preset is declarative YAML selected by `preset` / `BURO_PRESET`, or loaded from `schema_path` / `BURO_SCHEMA_PATH`. It defines one id, version, default kind, current-context relationship, finite kinds, finite fields, and reusable field sets.

The engine supports string, text, boolean, integer, number, reference, string-list, record, and record-list fields. A top-level reference may declare `target_kind`. Records declare finite nested fields and are shape-validated recursively.

Preset definitions are strict. Unknown options, wrong option types, invalid defaults, broken field sets, invalid context fields, and unknown reference targets fail at load time. Presets cannot execute code, SQL, hooks, processors, plugins, or templates.

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

Save it outside the installed package and set `schema_path` to that file. Increment `version` whenever its meaning changes. If existing data remains compatible, run `buro init` to validate every row and adopt the new binding. Otherwise export, transform the manifest outside BURO, and import it under the new preset with `--adopt`.
