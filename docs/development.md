# Development and releases

[English](development.md) · [Русский](development.ru.md) · [README](../README.md)

Use Node.js 24.14+. SQLite is provided by Node; js-yaml is the only runtime
dependency. There is no build step or database daemon for local use.

```sh
npm ci
npm test
node src/cli.js help
npm pack --pack-destination /absolute/path/to/artifacts
```

For an isolated instance, select BURO_CONFIG and BURO_ROOT outside the checkout.
Set backup_schedule:false in its config when you do not want a real OS timer.
Do not point experimental code at a live database. Tests create temporary
instances and exercise preservation, concurrency, references, failed backups,
replacement, recovery, CLI drafts, and connection configuration.

## Responsibilities

CLI and HTTP call the same resolver. Preview and push both use applyChange;
push repeats validation after acquiring SQLite's write lock. Schema code owns
field definitions and normalization. DB code owns canonical rows, derived lookup
indexes, transactions, and consistent snapshots. Registry code owns complete
export/import and recovery. Migration is the narrow one-time conversion of v2's
saved model; it does not keep old presets or command behavior alive.

The active model is stored in SQLite metadata. Each type has its own revision.
Records have independent revisions, and a registry generation changes after
replacement/recovery. Draft metadata carries the original generation, record
revision, and type revisions. Only relevant type revisions are checked for a
record change, so an unrelated type edit does not invalidate it.

Each record is one row: ID, name, kind, JSON values, revision. Deleted IDs go in
retired_ids. Indexed normalized identities support exact names and aliases;
device membership uses a derived locations index. These indexes are updated in
the same transaction as canonical data. Exact ID reads do not scan the memory.
List/search use bounded identity projections. Substring search may scan lookup
keys; it does not inspect record bodies or claim semantic retrieval. Large
offsets walk skipped index entries. Current may sort matching identities before
applying its output limit. Type format changes validate affected records
one at a time before adoption; label/guide changes do not scan records. Ordinary
record writes do not enumerate the registry unless incoming
refs need checking. Whole-memory export/import is intentionally proportional
to the full memory size and holds its complete manifest in memory.

Successful mutation snapshots are made before canonical writes, while a write
transaction prevents concurrent writers. SQLite serializes other processes;
the resolver queues writes inside one server process. Read definitions are loaded
from the saved model, so an invalid proposal never blocks the accepted model.
The HTTP server reads current definitions rather than pinning them until restart.
No second registry, worker DB copies, RAG store, or background model is involved.

Every changed write also copies the complete database for its mandatory snapshot.
This is the main cost that grows with saved content; bounded query results do not
make writes constant-time. Keep high-frequency logs and large binary data outside
BURO and store their useful facts and locations instead.

## HTTP

`buro serve` exposes the following JSON routes. These v3 routes replace the v2
transport; update clients with the server.

| Method and path | Response / purpose |
| --- | --- |
| GET /health | Storage status and record count |
| GET /definitions | Accepted schema plus registry generation |
| GET /current | Device record, member identities, limit, truncation flag |
| GET /records | Identity page; kind, limit, offset, query parameters; full=1 includes record content for bulk consumers |
| GET /records/:id-or-name | Full record including hidden packet fields |
| GET /records/:id?exact=1 | Exact ID only |
| GET /records/:id-or-name?packet=1 | Renderable record packet |
| POST /drafts/preview | Validate a draft and return before/after |
| POST /drafts/push | Validate again, snapshot, apply |

Requests may include current_context and current_limit. Draft POST bodies are
`{metadata, value}` from the YAML draft's __buro and remaining fields; deletion
uses value:null. Both endpoints require v3 revision/generation metadata. Conflicts
return HTTP 409. JSON request bodies are limited to 1 MiB. There are no unchecked
record PUT/DELETE routes. The API has no auth or TLS; see operation boundaries
before exposing it.

## Documentation languages

English uses the unsuffixed Markdown filename; translations use the same name
with a language suffix, such as `model.ru.md` or `model.uk.md`. Keep each guide's
language links and the README navigation table in sync. Adding a language needs
no runtime or build change. Translate the same topics and behavior naturally.
Type guides and integration resources are instructions used directly by agents;
keep their behavior consistent with the human guides.

## Packaging and release

One package contains CLI, server, three bundled definitions, the agent skill,
manual prompt, plugin, hook runner, documentation, and optional operator scripts.
Test sources, private facts, local databases, temporary files, and dependencies
from the checkout are excluded by the package file list. The public repository
and package never contain operator records.

Update the package version and lockfile together, run tests and a real packaged
installation, then exercise new setup and an upgrade/recovery copy. Update both
README languages and affected guides. Create the Git commit and tag only after
the result is verified. Publish the tgz as the matching GitHub release asset.
Local source edits do not update installed CLI or live services.

`npm run demos` generates the bilingual README GIFs from disposable real CLI
flows using ffmpeg with libass and DejaVu Sans/Mono. `npm run demos:check` verifies
their content. Set BURO_DEMO_FONTS_DIR if fonts are elsewhere. This media tool
is independent of runtime installation. Inspect actual rendered frames after
changing the CLI or demonstration, especially long lines and Russian text.
