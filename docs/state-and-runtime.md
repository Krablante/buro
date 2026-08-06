# State And Runtime

Source, instance state, and installed runtime are separate surfaces. The source repository contains code, docs, public presets, and README assets. SQLite, backups, and the draft belong to the configured instance root. Installed package code belongs to the package-manager prefix.

The default single-host root is:

```text
~/.local/share/buro/
├── BURO_DRAFT.yaml                 # created only while a draft exists
└── state/buro/
    ├── buro.sqlite3
    └── backups/sqlite/
```

Runtime configuration lives in `~/.config/buro/config.json`. File keys and their environment overrides are:

| Config key | Environment override |
| --- | --- |
| `mode` | `BURO_MODE` |
| `current_host` | `BURO_CURRENT_HOST` |
| `central_host` | `BURO_CENTRAL_HOST` |
| `api_url` | `BURO_API_URL` |
| `instance_root` | `BURO_ROOT` |
| `state_dir` | `BURO_STATE_DIR` |
| `database_path` | `BURO_DATABASE_PATH` |
| `backup_dir` | `BURO_BACKUP_DIR` |
| `backup_retention` | `BURO_BACKUP_RETENTION` |
| `draft_path` | `BURO_DRAFT_PATH` |
| `schema_path` | `BURO_SCHEMA_PATH` |

`BURO_CONFIG` overrides the config file path itself. Backups retain the newest 20 snapshots by default.

Local mode needs no daemon. Central mode still opens SQLite directly and adds one optional `buro serve` process. Client mode stores no SQLite file and reaches the central API. Workers never copy, mount, initialize, or synchronize the central database.
