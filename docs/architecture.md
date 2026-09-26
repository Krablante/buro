# Architecture

[English](architecture.md) · [Русский](architecture.ru.md) · [README](../README.md)

BURO has one active preset and one SQLite database per local or central
instance. The CLI handles commands and the local YAML draft. The resolver
handles entity lookup, validation, rendering, revisions, and mutations. The
HTTP API calls the resolver; client mode uses that API and holds no database
copy. The preset defines vocabulary and presentation. SQLite stores the
instance's records.

```text
CLI / draft ─┐
             ├─ resolver ─ schema + packets ─ SQLite
HTTP API ────┘                         └────── backups before writes
                                  ↑
                            active preset
```

An entity is one row: `id`, `name`, `kind`, `updated_at`, and a validated JSON
object for preset fields. Identity and kind remain directly queryable without
creating a database table for every vocabulary. The database binding includes
the preset id, version, and a SHA-256 hash of its data contract. Human guide
wording is outside that hash. A version or model change requires explicit
adoption through `buro init` or a whole-registry import.

Every mutation takes a SQLite `BEGIN IMMEDIATE` write lock, checks revisions
and declared references, makes a consistent pre-write backup, then changes
the row. The process also serializes its own mutations; SQLite coordinates
other processes. Failed checks leave the draft for correction. Import checks
the complete new entity set before replacing all rows in one transaction.

The hot read paths are narrower than a registry export. A direct entity
lookup reads one row plus context records for aliases; `buro list` reads only
identity columns; `buro current` reads the context and member summaries.
Member selection still scans stored JSON fields because the member field is
chosen by the preset. Full entity enumeration is reserved for export and
explicit `/entities` reads. Backups copy the database on each mutation, so
write cost grows with database size; this favors reviewed, relatively
infrequent fact changes over high-rate event storage.
