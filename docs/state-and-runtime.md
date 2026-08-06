# State And Runtime

Source, instance state, and installed runtime are separate surfaces. The source repository contains code, docs, and public presets. SQLite, backups, and the draft belong to the configured instance root. Installed package code belongs to the package-manager prefix.

The default single-host root is:

```text
~/.local/share/buro
```

Runtime configuration lives in `~/.config/buro/config.json`. Supported values are `mode`, `current_host`, `central_host`, `api_url`, `instance_root`, `state_dir`, `database_path`, `backup_dir`, `backup_retention`, `draft_path`, and `schema_path`. Corresponding `BURO_` environment variables override them.

Local mode needs no daemon. Central mode adds one optional `buro serve` process. Client mode stores no SQLite file and reaches the central API. Workers never copy, mount, initialize, or synchronize the central database.
