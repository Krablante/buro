# BURO

BURO is a small typed context registry for agents. One SQLite database stores verified entities, one YAML preset defines their kinds and fields, one resolver powers the CLI and HTTP API, and one reviewed draft controls every write.

BURO rejects RAG, distributed `AGENTS.md` authority, scanners, generated context files, and agent-infrastructure stacks. A deterministic context lookup should remain deterministic, explicit, and cheap.

The engine contains no private entities or deployment topology. `presets/politia.yaml` is a public example and the active Politia model. Instance facts remain in SQLite.

## Commands

```text
buro <id>                       render one entity
buro current                    render current-context information
buro list [kind]                list entities, optionally by kind
buro schema                     show the active preset
buro draft pull <id>            prepare an edit
buro draft new <id> [kind]      prepare a creation
buro draft delete <id>          prepare a deletion
buro draft diff                 review the draft
buro draft push                 apply the draft
buro draft clear                discard the draft
```

Administrative commands are deliberately small: `buro init`, `buro backup`, and `buro serve`.

## Storage

The default instance root is `~/.local/share/buro`. It contains the SQLite registry, online backups, and `BURO_DRAFT.yaml`. Source, installed package, and runtime state remain separate.

Every entity is stored in one strict `entities` table as `id`, `name`, `kind`, validated JSON data, and an update timestamp. Kinds and fields are finite and preset-defined; unknown fields are rejected.

## Configuration

The optional config file is `~/.config/buro/config.json`.

```json
{
  "mode": "client",
  "current_host": "worker-a",
  "central_host": "registry",
  "api_url": "http://registry:8765",
  "instance_root": "/srv/buro"
}
```

`BURO_CONFIG`, `BURO_MODE`, `BURO_CURRENT_HOST`, `BURO_CENTRAL_HOST`, `BURO_API_URL`, `BURO_ROOT`, `BURO_STATE_DIR`, `BURO_DATABASE_PATH`, `BURO_BACKUP_DIR`, `BURO_BACKUP_RETENTION`, `BURO_DRAFT_PATH`, and `BURO_SCHEMA_PATH` override file values.

## Source map

```text
presets/politia.yaml  public entity model
src/schema.js         preset loading and typed validation
src/db.js             SQLite and online backups
src/resolver.js       shared entity operations
src/draft.js          reviewed YAML writes
src/packet.js         generic entity rendering
src/api.js            optional HTTP transport
src/cli.js            command surface
```

See `docs/` for the compact architecture and operating contracts.
