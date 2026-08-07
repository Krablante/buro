# Architecture

BURO has one engine, one active preset, and one SQLite database.

```text
CLI reads ──────┐
CLI draft push ─┼─ resolver ─ schema validation ─ entities table
HTTP API ───────┘          └─ write transaction └─ online backup
                     ↑
               active preset
```

The CLI owns the local draft and review UX. The resolver owns storage operations, validation, rendering, revision checks, and backups. The HTTP API is transport over those same operations. The preset owns vocabulary: kinds, finite fields, context relationships, and display sections. SQLite owns instance facts.

Every entity occupies one row. Core identity columns stay directly queryable; preset-defined data is one validated JSON object. This avoids EAV joins and avoids creating physical tables from preset vocabulary.

The database is bound to the active preset id, version, and SHA-256 schema hash. Ordinary reads and writes refuse a different vocabulary. Explicit `buro init` validates every stored entity before adopting a compatible changed preset; incompatible model changes use full export/import.

Local mode opens SQLite directly. Central mode opens the same file and adds HTTP. Client mode fetches schema and entities from the central API and never needs a local preset or database copy.

Every mutation is serialized in-process and runs under one SQLite `BEGIN IMMEDIATE` transaction. Reference checks, context-alias uniqueness, revision checks, backup, and mutation therefore observe one write-locked state. A stale draft cannot overwrite or delete a newer entity.
