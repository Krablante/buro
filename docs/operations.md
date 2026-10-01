# Configuration and operation

[English](operations.md) · [Русский](operations.ru.md) · [README](../README.md)

Local use requires no server or editable configuration. `buro init` creates
SQLite and, when absent, a small config file with the default type selection.
Mutable data lives outside the installed package:

```text
~/.config/buro/config.json
~/.local/share/buro/
  BURO_DRAFT.yaml                 # while editing
  state/buro/buro.sqlite3
  state/buro/backups/sqlite/
```

Two configuration concerns are independent: program settings and YAML type
definitions. See [model](model.md) for selecting or changing types. Local mode
opens SQLite; central mode adds the optional HTTP service; client mode uses the
same registry through HTTP and keeps no database copy. A client can use:

```json
{
  "api_url": "http://registry:8765",
  "current_context": "worker-a"
}
```

An API URL implies client mode unless mode is explicit. Machine identity
defaults to the short hostname. Use a unique `current_context` if hostnames
collide. Creating a host record is optional; it supplies machine-wide rules and
can define an existing workspace root.

`BURO_CONFIG` selects a config file; environment settings override JSON values.
`type_files` selects built-in names or YAML paths, and `default_kind` chooses
the default type. Those two settings are configured through JSON. Legacy
`preset` / `schema_path` full models remain available; an explicit type_files
selection takes precedence over them.

| JSON key | Environment |
| --- | --- |
| mode | BURO_MODE |
| current_context | BURO_CURRENT_CONTEXT |
| api_url | BURO_API_URL |
| central_host | BURO_CENTRAL_HOST |
| instance_root | BURO_ROOT |
| state_dir | BURO_STATE_DIR |
| database_path | BURO_DATABASE_PATH |
| backup_dir | BURO_BACKUP_DIR |
| backup_retention | BURO_BACKUP_RETENTION |
| draft_path | BURO_DRAFT_PATH |
| preset | BURO_PRESET |
| schema_path | BURO_SCHEMA_PATH |

`buro backup` uses SQLite's online backup API. Successful mutations and schema
adoption take pre-write snapshots; previews do not. The newest 20 are retained
by default. Backups copy the database, so high-frequency edits to a large
registry cost I/O and disk space. Keep events and transcripts elsewhere. Check
recovery in a separate instance using an export/import or a snapshot.

To upgrade, install the new package, review `buro init --dry-run`, apply with
`buro init`, and reconnect your agent. Stop a central API while adopting a
changed model, then restart it and update clients. Known v1 models migrate
without dropping records. Keep the previous package and snapshot until the
new API and clients have been verified. Do not restore a live database while
its service or clients are writing.

`init`, `backup`, `export`, `import`, and `serve` require direct storage.
The HTTP server has no auth or TLS; bind to loopback unless a trusted private
network or access-controlled proxy supplies that boundary. Worker clients
must not copy, synchronize, or open the central SQLite file.

## Politia deployment

`npm run deploy:politia` (alias `deploy:live`) is the existing Linux operator
workflow, not the public installer. It checks the terminal demos, previews the
central migration, packs once, upgrades the central installation and API, and
installs the same package on reachable workers. It uses the configured SSH and
sudo access and the Politia preset. Review `scripts/deploy-live.sh` before use
outside that environment. Source edits alone are not installed behavior.

```sh
npm run deploy:politia -- --dry-run
npm run deploy:politia
```

Offline workers are reported as pending. A reachable worker failure fails the
deployment. Keep the package when rollout is incomplete; finish it when the
host becomes available. Agent plugins need their own refresh and process restart.

## Terminal demos

`npm run demos` regenerates the bilingual GIFs from real CLI use with isolated
starter data. `npm run demos:check` checks them against that flow. Rendering
requires ffmpeg with ass/palette filters and DejaVu Sans/Mono; select fonts with
`BURO_DEMO_FONTS_DIR`. No operator database or draft is used.
