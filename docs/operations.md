# Configuration and operations

[English](operations.md) · [Русский](operations.ru.md) · [README](../README.md)

Local mode opens SQLite directly. Central mode opens the same database and
adds `buro serve` for clients. Client mode calls the central API and holds no
local SQLite file or preset copy. All three use the same entity model and
reviewed [draft workflow](draft-workflow.md).

The default local layout keeps mutable state outside the source checkout:

```text
~/.config/buro/config.json
~/.local/share/buro/
├── BURO_DRAFT.yaml              # only while editing
└── state/buro/
    ├── buro.sqlite3
    └── backups/sqlite/
```

`starter`, `local`, and the short system hostname are the default preset,
mode, and current context. A client configuration can be as small as:

```json
{
  "mode": "client",
  "current_context": "worker-a",
  "central_host": "registry",
  "api_url": "http://registry:8765"
}
```

`BURO_CONFIG` selects another config file. Environment settings override its
JSON keys. An explicit schema path takes precedence over the bundled preset.

| JSON key | Environment setting |
| --- | --- |
| `mode` | `BURO_MODE` |
| `preset` | `BURO_PRESET` |
| `current_context` | `BURO_CURRENT_CONTEXT` |
| `central_host` | `BURO_CENTRAL_HOST` |
| `api_url` | `BURO_API_URL` |
| `instance_root` | `BURO_ROOT` |
| `state_dir` | `BURO_STATE_DIR` |
| `database_path` | `BURO_DATABASE_PATH` |
| `backup_dir` | `BURO_BACKUP_DIR` |
| `backup_retention` | `BURO_BACKUP_RETENTION` |
| `draft_path` | `BURO_DRAFT_PATH` |
| `schema_path` | `BURO_SCHEMA_PATH` |

Backups retain the newest 20 snapshots by default. `buro backup` uses
SQLite's online backup API; each successful mutation takes a pre-write copy
under the SQLite write lock. Frequent writes to a large database therefore
cost real I/O and storage. Set retention for your available disk space and
test recovery by importing a [whole-registry export](interfaces.md) or
restoring a snapshot into a separate instance. `buro init` creates the
database; on an existing database it backs up, checks every entity and
explicitly adopts a compatible new preset. Normal reads refuse a mismatched
binding.

`buro init`, `buro backup`, `buro export`, `buro import`, and `buro serve`
require local or central mode. The built-in HTTP server has no authentication
or TLS. Bind to loopback unless a trusted private network or external proxy
provides the access boundary. Never copy or synchronize the central SQLite
file to workers.

## Politia maintainer deployment

The repository's `npm run deploy:politia` (alias `deploy:live`) is an operator
script for Politia on Linux, not a general installer. It packs the checkout
once, installs it on the central host, validates/adopts the active `politia`
preset, restarts `buro-api.service`, and installs the same package on reachable
workers. Workers come from `buro list host`; `BURO_WORKER_HOSTS` overrides
discovery. An unreachable worker is reported and left untouched; a reachable
worker failure fails the deployment.

```sh
npm run deploy:politia -- --dry-run
npm run deploy:politia
```

The script checks its terminal demos before packing and verifies the installed
CLI and API afterward. It needs the operator's configured SSH/sudo access.
Source edits alone do not update the live CLI, API, or remote clients. Review
`scripts/deploy-live.sh` and the configured service before deploying to an
installation other than Politia.

## README terminal demos

`npm run demos` regenerates the English and Russian GIFs in `assets/` from
real CLI commands against isolated temporary `starter` state. `npm run
demos:check` checks the committed artifacts against the same flow; the
operator deploy runs it before packing. The renderer needs `ffmpeg` with
`ass`, `palettegen`, and `paletteuse`, plus DejaVu Sans and Mono. Use
`BURO_DEMO_FONTS_DIR` to select another font directory. No operator registry
or draft is used by the demo generator.
