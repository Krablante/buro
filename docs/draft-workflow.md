# BURO Draft Workflow

Draft is the only public mutation path. It gives a human or agent one local YAML file to edit and one visible diff before SQLite changes.

```text
buro draft pull <id>
buro draft new <id> [kind]
buro draft delete <id>
buro draft diff
buro draft push
buro draft clear
```

The draft is generated from the active preset. Existing facts are active YAML. Missing optional fields remain commented in canonical order with their complete record shape. Unknown keys and wrong types are rejected before any backup or mutation occurs.

`draft new` uses the preset's default kind when kind is omitted, preserving the existing `project` behavior for Politia. Supplying the kind directly is clearer and generates the correct shape immediately.

In local mode the draft pushes through the resolver into local SQLite. In client mode the worker fetches the central schema, validates the same YAML shape, and sends the entity through the central API. Successful create, update, and delete operations create a pre-mutation SQLite backup. Failed pushes leave the draft in place.

The draft path defaults to `<instance_root>/BURO_DRAFT.yaml` and can be overridden with `draft_path` or `BURO_DRAFT_PATH`.
