# Editing with a draft

[English](draft-workflow.md) · [Русский](draft-workflow.ru.md) · [README](../README.md)

One local YAML draft is the ordinary write path, whether the CLI talks to
SQLite directly or to a central API. To create, edit, or delete a record:

```text
buro draft new my-service service    # or: pull my-service / delete my-service
# Open the file path printed by the command and edit its YAML.
buro draft diff
buro draft push
```

`new` uses the preset's default kind when the kind is omitted. The draft
contains active existing facts, clearly marked missing required fields, and
commented optional fields with their complete record shape. Section and field
guides explain where facts belong. Leave unknown facts empty. Only one draft
can exist at a time; `buro draft clear` deliberately discards it.

Internal `__buro` metadata records create, update, or delete and the starting
revision. The id stays fixed in an update. `diff` compares the edited draft
with the current record and rejects a stale revision; `push` validates the
record, checks references and uniqueness, takes a pre-write SQLite snapshot,
applies the change, and clears the draft. Failed pushes leave it in place.
If someone else changed the record, pull a fresh draft and review the edit
again. Even a large draft can be reviewed without allocating a quadratic
diff table; a mostly rewritten region may appear as removed and added lines.

Only known, relevant fields need filling. A record can contain just its
identity and one rule. A standard location path without a host gets the current
client machine; `diff` shows that value before saving. Do not clear an unrelated
draft to start another task. Complete or deliberately preserve the draft before
changing type definitions.

The default draft path is `<instance_root>/BURO_DRAFT.yaml`. Set `draft_path`
or `BURO_DRAFT_PATH` to change it. A client keeps its draft locally and sends
validated entity JSON with its revision to the server; the server stores no
second draft. See [interfaces](interfaces.md) for API details.
