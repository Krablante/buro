# Architecture

BURO has one engine, one active preset, and one SQLite database.

```text
CLI reads ──────┐
CLI draft push ─┼─ resolver ─ schema validation ─ entities table
HTTP API ───────┘          └─ write transaction └─ online backup
                     ↑
               active preset
```

The CLI owns the local draft and review UX. The resolver owns storage operations, validation, rendering, revision checks, and backups. The HTTP API is transport over those same operations. The preset owns vocabulary and presentation: kinds, finite fields, context relationships, display sections, and concise guidance. SQLite owns instance facts.

Every entity occupies one row. Core identity columns stay directly queryable; preset-defined data is one validated JSON object. This avoids EAV joins and avoids creating physical tables from preset vocabulary.

The database is bound to the active preset id, version, and SHA-256 model hash. The hash covers data shape and validation semantics but excludes human wording such as field and section guides. Editing guidance therefore needs no data migration; changing the preset version or semantic model requires explicit `buro init`, which validates every stored entity before adoption. Incompatible model changes use full export/import.

Local mode opens SQLite directly. Central mode opens the same file and adds HTTP. Client mode fetches schema and entities from the central API and never needs a local preset or database copy.

Every mutation is serialized in-process and runs under one SQLite `BEGIN IMMEDIATE` transaction. Reference checks, context-alias uniqueness, revision checks, backup, and mutation therefore observe one write-locked state. A stale draft cannot overwrite or delete a newer entity.
