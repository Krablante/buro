# Architecture

BURO has one engine, one active preset, and one SQLite database.

```text
CLI ─┐
     ├─ resolver ─ schema validation ─ entities table
API ─┘                         └─────── online backups
```

The engine owns storage, validation, drafts, rendering, backups, and transports. The preset owns vocabulary: kinds, fields, finite field types, context relationships, and display sections. SQLite owns instance facts.

Every entity occupies one row. Core identity columns stay directly queryable; preset-defined data is one validated JSON object. This avoids EAV joins and avoids creating physical tables from preset vocabulary.

Local mode opens SQLite directly. Central mode opens the same file and adds the HTTP transport. Client mode asks the central API for both schema and entities and never copies the database.

All writes pass through the same resolver operations. References are checked before creation or update, referenced entities cannot be deleted, and every mutation creates an online pre-mutation snapshot.
