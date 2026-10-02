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
by default. An unchanged `init` creates no snapshot. New databases and snapshots
are created with mode 0600; existing permissions are preserved. Backups copy the database, so high-frequency edits to a large
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

`npm run deploy:politia` (alias `deploy:live`) is the Linux rollout for Politia's
existing central installation and clients. It previews adoption, packs once,
stops the API, saves the old package and a snapshot, and upgrades the central
installation. Rollback remains available until installed CLI and HTTP checks
succeed. Workers receive the same package. Existing configuration files stay
in place, including custom endpoints and draft paths. SSH, sudo, Node, and the
user unit `buro-api.service` must already work. This workflow uses the central
configuration and does not require ffmpeg. Source edits alone are not installed
behavior; review the script before using it outside Politia.

```sh
npm run deploy:politia -- --dry-run
npm run deploy:politia
```

Offline workers are reported as pending. A reachable worker failure fails the
deployment. Each run retains its package, rollback materials, and `pending.json`
under `<state_dir>/deployments/<version>-<timestamp>/`. The record contains the
package checksum and worker results. Keep it until the rollout is complete;
install the retained package on an offline worker when it returns. The script
refreshes the OpenCodez connection; changed plugin code needs a client restart.

`BURO_SOURCE_ROOT` selects the checkout; `BURO_ROOT` still selects instance data.
`PACK_DIR` overrides artifact storage. `BURO_WORKER_HOSTS` limits the rollout to
space-separated SSH names; otherwise hosts come from the registry.
`BURO_WORKER_PREFIX` defaults to `/usr`; the central prefix is `/usr/local`.
`--skip-workers` updates only the central installation. Terminal media belongs
to [development](development.md), independently of runtime deployment.

## Recovery and common errors

Test recovery in another instance first. Point it at the same definitions and
an isolated data root, initialize it, then import the export:

```sh
BURO_CONFIG=/path/to/recovery/config.json BURO_ROOT=/path/to/recovery/data buro init
BURO_CONFIG=/path/to/recovery/config.json BURO_ROOT=/path/to/recovery/data buro import /path/to/export.yaml
BURO_CONFIG=/path/to/recovery/config.json BURO_ROOT=/path/to/recovery/data buro list
```

For custom definitions, create the recovery config before initializing. Its
`type_files` must select the saved custom files, or `schema_path` can point at
the export's `model` saved as its own YAML file. A SQLite snapshot can replace
the target database while its API and writers are stopped; verify `buro list`
and a known record before restarting the service.

| Symptom | Next action |
| --- | --- |
| Unapplied model / different hash | Review `init --dry-run`; restore the definition if the preview rejects saved fields. |
| Draft already exists | Inspect the printed file; finish it or preserve it before `draft clear`. |
| Revision conflict | Preserve edits, pull a fresh draft, and review them against the current record. |
| API unavailable / timeout | Check the client's URL and `/health` on the registry host. The draft is retained; read the record before retrying a write. |
| Agent ignores BURO | Check `buro` in the agent's terminal, reconnect, then start a new session. |
