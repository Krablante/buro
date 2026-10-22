# Operation and recovery

[English](operations.md) · [Русский](operations.ru.md) · [README](../README.md)

`buro init` creates local memory and installs the native backup schedule.
Configuration and state stay outside the package:

```text
~/.config/buro/config.json
~/.local/share/buro/state/buro/buro.sqlite3
~/.local/share/buro/state/buro/backups/sqlite/{mutation,hourly,daily}/
```

Repeated and concurrent init calls preserve existing memory. If the first init
fails before committing, retry it after correcting the error; an empty database
left by that attempt is safe to initialize.

Drafts are private files in OS temporary directories, each with its own path.
They are not stored next to source. Temporary-directory cleanup may remove old
drafts; preserve intended edits elsewhere if they must survive that cleanup.

## Configuration

No editable config is required for the local default. A shared-memory client uses:

```json
{
  "api_url": "http://registry:8765",
  "current_context": "laptop",
  "current_limit": 100
}
```

The presence of api_url selects HTTP. Its absence selects SQLite. Clients never
initialize or use a fallback database. Current context defaults to the short
system hostname. It need not correspond to a host record. A host record can
provide rules; current also lists objects located on that device. If the bounded
list has more records, the output explicitly reports truncation.

`BURO_CONFIG` selects the config file. Environment values override JSON:

| JSON setting | Environment | Default |
| --- | --- | --- |
| api_url | BURO_API_URL | empty: direct SQLite |
| current_context | BURO_CURRENT_CONTEXT | short hostname |
| current_limit | BURO_CURRENT_LIMIT | 100, maximum 10000 |
| api_timeout_ms | BURO_API_TIMEOUT_MS | 5000 |
| instance_root | BURO_ROOT | ~/.local/share/buro |
| state_dir | BURO_STATE_DIR | instance_root/state/buro |
| database_path | BURO_DATABASE_PATH | state_dir/buro.sqlite3 |
| backup_dir | BURO_BACKUP_DIR | state_dir/backups/sqlite |
| backup_retention | BURO_BACKUP_RETENTION | 20 mutation snapshots |
| backup_schedule | — | true; false disables installing a schedule |

The active model and default type live in SQLite. Preset paths, type_files,
schema_path, mode, central_host, and the single draft_path are obsolete. Init
converts the saved v2 model and removes those config selections after success.
An old central config's api_url described its own server; init removes that
endpoint. An old client's api_url remains its shared-memory target.
If a v2 client relied only on mode/central_host, set its existing server's api_url
before upgrading. Init refuses to create a local memory for that old client.

## Backups

Snapshots use SQLite's consistent backup API and private permissions. A new file
receives its final name only after completion. A failure cancels the write.
Retention removes older snapshots only after a successful new snapshot in the
same group. Interrupted .partial files are not recovery snapshots.

| Group | Retained |
| --- | --- |
| hourly | Latest 8 snapshots, at least 3 hours apart |
| daily | Latest 8 snapshots, at least 24 hours apart |
| mutation | Latest 20 snapshots before record, type, import, or restore changes; manual snapshots use this group too |

`buro backup` takes a manual snapshot. `buro backup --scheduled` creates currently
due hourly/daily snapshots without replaying missed intervals. Repeated init
updates one schedule per database, not duplicate tasks. Only the database device
installs it. The CLI is short-lived; no backup daemon stays running.

Linux uses user systemd timers with Persistent=true. macOS uses a LaunchAgent
with RunAtLoad and a three-hour interval. Windows uses a user scheduled task
with StartWhenAvailable, including the selected config and storage paths. If the native
scheduler fails or is unavailable, init says the schedule was NOT enabled and
prints the command to schedule manually. Linux integration is exercised on live
systems; macOS and Windows installers require verification on those platforms.
The device must be on to make copies. Linux persistent timers catch up once on
return; macOS RunAtLoad does so at login; Windows catches up when available.
Schedules retain the selected database, backup directory, and device context,
including settings supplied through environment variables during init.

Snapshots include records, definitions, retired IDs, the BURO version, and the
database device's context settings, independently of the writing client's identity.
Keep copies on another device for protection against disk loss.
Frequent writes copy the database and therefore have real I/O and storage cost.
Use BURO for durable facts rather than event streams.

## Export, replacement, and recovery

```sh
buro export memory.yaml
buro import memory.yaml --dry-run
buro import memory.yaml
buro restore /absolute/path/to/snapshot.sqlite3 --dry-run
buro restore /absolute/path/to/snapshot.sqlite3
```

Import replaces the entire memory: definitions, records, and retired IDs. Preview
shows old/new counts and disappearing IDs (first 100, with the full count).
The whole input is validated before replacement. Even an empty but valid export
can clear the registry. Before import or recovery, a snapshot is mandatory.
Replacements are transactional and invalidate every old draft.

For recovery, stop the API and other writers, preview the selected snapshot,
restore it, check `buro list` and a known record, then restart the API. Restore
also restores current_context and current_limit. The target device's existing
storage paths and transport configuration stay in place, so a recovery copy
does not accidentally reopen the original database. When config writing fails,
database replacement is rolled back. Use `buro init` in an isolated data root
first when validating recovery on another device. V2 snapshots containing a
saved model can be restored through the same one-time definition conversion.

A client timeout does not prove a write failed: the server may complete after
the connection is gone. Read the affected record before retrying. Failed pushes
retain their draft. Incompatible type changes leave the previous model readable.

| Symptom | Next step |
| --- | --- |
| API unavailable | Check api_url and reachability from this device; keep the configured memory target. |
| Draft is stale | Pull a fresh draft and reconcile the intended change with current values. |
| Backup fails | Check free space and permissions on backup_dir, then retry the retained draft. |
| No initial context | Check `buro current` in the harness environment, reconnect, and restart OpenCode/OpenCodez or review the terminal hook. |

## Shared memory and deployment

`buro serve` binds to 127.0.0.1:8765. `--host` and `--port` select another bind.
The built-in HTTP server has no authentication, authorization, or TLS. Every
admitted client can read and change the memory. Restrict access using the network,
a VPN, a tunnel, or a protected HTTPS proxy. BURO does not encrypt storage,
exports, snapshots, or ordinary HTTP. packet:false is not access control.

`npm run deploy:live` is the optional Politia Linux rollout, not a public setup
requirement. It packs once, stops the central API, retains the old package,
config, and snapshot, upgrades and verifies the installed CLI/API, then updates
reachable workers with the same package. Offline workers are recorded as pending;
a reachable installation failure fails the rollout. The retained directory
contains its package checksum and continuation record. Reconnect agents after
upgrading; changed plugin code needs an agent-service restart.

Use `--dry-run` for a rollout preview or `--skip-workers` for the central device
alone. BURO_WORKER_HOSTS may provide space-separated SSH names; otherwise enabled
host records supply ssh_target. BURO_SOURCE_ROOT chooses source, PACK_DIR chooses
artifact storage, and BURO_WORKER_PREFIX defaults to /usr. Local data and the
central database are never synchronized to workers.
