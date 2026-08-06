# Architecture

BURO has one engine, one active preset, and one SQLite database.

```text
CLI reads ──────┐
CLI draft push ─┼─ resolver ─ schema validation ─ entities table
HTTP API ───────┘                         └─────── online backups
                     ↑
               active preset
```

The CLI owns the local draft file and its review UX. The resolver owns storage operations, validation, rendering, and backups; the HTTP API is a transport over those same operations. The preset owns vocabulary: kinds, fields, finite field types, context relationships, and display sections. SQLite owns instance facts.

Every entity occupies one row. Core identity columns stay directly queryable; preset-defined data is one validated JSON object. This avoids EAV joins and avoids creating physical tables from preset vocabulary.

Local mode opens SQLite directly. Central mode opens the same file and adds the HTTP transport. Client mode asks the central API for both schema and entities and never copies the database.

All entity mutations pass through the same resolver operations, whether a local CLI pushes a draft or a client-mode push crosses HTTP. Top-level preset reference fields are checked before creation or update, entities targeted by those references cannot be deleted, and every successful mutation has an online pre-mutation snapshot. The API carries entity JSON and does not keep a second server-side draft.
