# Architecture

[English](architecture.md) · [Русский](architecture.ru.md) · [README](../README.md)

CLI and HTTP use the same resolver for lookup, validation, rendering, revisions,
and changes. The CLI manages the local YAML draft. Local mode opens SQLite;
client mode uses HTTP and stores only its configuration and draft. A server is
optional. Agent connections supply instructions; no model or disk indexer runs
inside BURO.

```text
CLI / local draft ─┐
                  ├─ resolver ─ selected type definitions ─ SQLite
HTTP clients ─────┘                                └────── pre-write backups
```

One record is one row: id, name, kind, revision, and validated JSON content.
There is no table per type. Independent YAML type definitions compile into the
same normalized model as legacy full presets. Field and section guides do not
affect the data contract hash. The last applied model is stored in metadata so
adoption and exports can interpret existing records without losing fields.

Names and aliases use an indexed lookup table. Machine membership uses an
indexed location table. Both are derived from canonical rows and updated in the
same write transaction; they are not separately editable facts. Exact-id reads
do not scan the registry. List and search return identity columns with bounded
pages. Machine member lists show at most 100 records; brief context omits them.
Substring search can scan lookup keys; BURO does not claim semantic retrieval.

Changes take a SQLite write lock, check the starting revision and references,
create a consistent pre-write backup, and update the canonical row and indexes.
The process serializes mutations; SQLite coordinates other processes. Nested
declared references are checked too. Failed writes preserve the draft.
Machine-id and alias conflicts use the lookup index instead of enumerating the
registry. Deletion checks only types that declare references and reads their
rows one at a time; a model without references needs no deletion scan.

`init` validates a proposed model before adoption. Known old models migrate
host/path to locations; incompatible custom changes fail before writes. Changed
records receive new revisions. A preview runs validation without modifying the
database. Server startup verifies the applied binding without rebuilding all
indexes on every restart.
Repeating `init` with unchanged definitions leaves the database and backups
untouched. Guide-only changes update model metadata without rebuilding rows or
indexes. A preview uses a read transaction, so it does not take a write lock.

Full enumeration is used for export, explicit administration, and changed schema
adoption. Backups copy SQLite before mutations, so frequent writes to a large
registry have real I/O cost. BURO is intended for durable facts, not event logs.

The source tree follows these responsibilities: `schema.js` reads and validates
definitions and values; `db.js` owns SQLite and derived indexes; `resolver.js`
owns lookup and mutation rules; `migration.js` and `registry.js` apply models and
portable exports. CLI/draft, HTTP/client, packet rendering, and agent connections
each keep their own presentation or transport details. There is no separate
service per responsibility. [Development](development.md) covers changing and
packaging these parts.
