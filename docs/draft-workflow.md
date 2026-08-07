# BURO Draft Workflow

Draft is the supported ordinary mutation path. It gives a human or agent one local YAML file to edit and one visible diff before SQLite changes.

```text
buro draft pull <id>
buro draft new <id> [kind]
buro draft delete <id>
buro draft diff
buro draft push
buro draft clear
```

Only one draft may exist at a time. Pull/new/delete refuses to overwrite it; push it or clear it deliberately. The draft is generated from the active preset. Existing facts are active YAML, required missing fields are active and labelled, and optional missing fields stay commented with their guides and complete record shape.

Internal `__buro` metadata records whether the operation creates, updates, or deletes and captures the base entity revision. The stable entity id cannot be renamed inside an update draft. Diff and push reject a stale revision, so another host or operator cannot be overwritten after review.

In local mode push goes through the resolver into SQLite. In client mode the worker fetches the central schema, validates the same YAML shape, and sends entity JSON plus the revision to the API. The server stores no second draft. Successful create, update, and delete operations make a consistent pre-mutation backup under the same SQLite write lock. Failed pushes leave the local draft in place.

The draft path defaults to `<instance_root>/BURO_DRAFT.yaml` and can be overridden with `draft_path` or `BURO_DRAFT_PATH`.
