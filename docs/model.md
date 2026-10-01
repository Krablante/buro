# Types and saved records

[English](model.md) · [Русский](model.ru.md) · [README](../README.md)

A record has `id`, `name`, `kind`, and a revision `updated_at`. The revision is
managed by BURO. Content fields belong to the selected type definition. Missing
fields stay missing; empty lists are not rendered. There is no mandatory host,
workspace root, description, or current-context record.

The defaults are `project`, `service`, `host`, and `item`. Inspect them with
`buro types` and `buro types project`. Each definition is one YAML file under
`types/`, containing `id`, an optional `label`, and a `fields` object. Field
order is output order. `section` groups output; `guide` explains the field to
people and agents. Fields are optional unless marked `required: true`.

## Custom definitions

```yaml
id: project
label: My project records
fields:
  important:
    type: string-list
    guide: Confirmed rules that affect future work.
```

This is a complete valid definition, including when it is the only active
type. Save it outside the installed package and select it in config.json:

```json
{
  "type_files": ["/path/to/project.yaml", "service", "host", "item"]
}
```

Built-in names resolve inside the package; relative YAML paths resolve from the
configuration file's directory. `buro types copy project <file>` copies the
built-in definition without overwriting an existing file. A new `id` creates
your own type. One definition per id is allowed. There is no inheritance or
field merging across types. Fields with the same name may have different
definitions in different types. `default_kind` in config selects the default;
otherwise it is project when present, or the first selected type.

HTTP clients receive active definitions from the registry server. Change and
apply definitions on that server; a client-side type_files setting does not
replace the shared model.

Supported field formats: `string`, `text`, `boolean`, `integer`, `number`,
`ref`, `string-list`, `record`, `record-list`. Records declare nested fields.
`ref` values point to existing ids and can constrain `target_kind`. A string
target in `related` can also describe a path or URL without creating a record.
Unknown fields and invalid values are rejected. `packet: false` hides a field
from packets; `draft_optional: false` omits absent optional fields from drafts.
Neither setting deletes data. Definitions cannot execute code or SQL.

Standard `locations` records have optional `host`, `path`, `url`, and `purpose`.
New paths must be absolute; a missing host gets the client's current machine
on a normal write and is shown in the diff. No host record is required. Keep
machine names unique, or configure `current_context` explicitly. Unknown
ownership in legacy data is preserved rather than guessed during migration
or a later unrelated edit. Supply its host when ownership becomes known.
An unchanged relative legacy location also survives unrelated edits; resolve
it to an absolute path when changing that location.
Host records can hold existing folder conventions; particular objects can
describe their exceptions. No layout is inferred from a type name.

## Applying a changed definition

Run `buro init --dry-run`, then `buro init`. BURO validates all stored records
and references before applying the model. Compatible changes do not require a
handwritten migration or global version increment. Changed guides do not affect
the data hash. Removing a populated field, removing a used type, or changing a
format to something incompatible rejects adoption and preserves the database.
Restore the definition or explicitly transform a whole-registry export and
import it with `--adopt`. Schema adoption should be done without active drafts;
changed records receive new revisions, so old drafts cannot overwrite them.

The database stores the applied definition for migration and recovery, not a
second editable configuration. Normal reads refuse an unapplied model. Exports
include the applied model and records; keep custom definition files backed up.

## Upgrading v1

The known starter v2 and Politia v5 models are bundled under `presets/legacy/`
only to recognize exact historical bindings. `buro init` converts non-host
`host/path` fields to `locations` and starter `document` records to `item`.
Other fields and ids are preserved. A pre-write SQLite snapshot is created;
previewing does not write or take a snapshot. Version 1 exports remain readable
and migrate with `buro import <file> --adopt` when a known old model is recognized.

Legacy full-model YAML files selected through `preset` or `schema_path` remain
supported, including optional context and field sets. Politia uses that format
for its existing specialized vocabulary. It is not required for public setup.
