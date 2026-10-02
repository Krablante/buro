# CLI, HTTP, and portability

[English](interfaces.md) · [Русский](interfaces.ru.md) · [README](../README.md)

`buro <id-or-name>` gets one record. `buro get <id-or-name>` also handles ids
matching CLI commands. Exact ids win over names and aliases. An ambiguous name
reports matching ids. `buro search <text>` searches ids, names, and aliases;
`buro list [kind]` lists identities. Both default to 100 results and support
`--limit 1..1000` and `--offset`. A full page prints a next-page hint.

`buro types [kind]` inspects active definitions; `schema` is a compatible alias
for inspection. `buro types copy <built-in> <file>` copies a built-in YAML.
`buro current --brief` gets optional machine rules; `buro current` also returns
up to 100 records with a location on that machine. A missing host record is a
normal result. `init --dry-run` previews adoption; `init` applies it.
`agent`, `agent --full`, and `connect` support [agent integration](agents.md).
Ordinary writes use the [draft workflow](draft-workflow.md).
`buro help` works without a configured or reachable registry. Options accept
both `--limit 100` and `--limit=100`; missing values and extra arguments fail
instead of being silently ignored.

## HTTP

`buro serve --host 127.0.0.1 --port 8765` opens the applied local model.

| Route | Meaning |
| --- | --- |
| `GET /health` | Database and applied model status; HTTP 503 if the binding differs |
| `GET /schema` | Normalized active definitions, including per-kind fields |
| `GET /entities` | All full records for explicit administration |
| `GET /entities?summary=1&kind=project&q=site&limit=100&offset=0` | Identity page; kind and query are optional |
| `GET /current?current_context=worker&brief=1` | Optional machine packet; brief skips member lookup |
| `GET /entities/:id` | One record, with names and aliases supported |
| `GET /packet/entity/:id?current_context=worker` | Structured packet |
| `POST /entities/:id?current_context=worker` | Create; missing location host is the writing client |
| `PUT /entities/:id?current_context=worker` | Replace with `If-Match` revision |
| `DELETE /entities/:id` | Delete with `If-Match` revision |

`current_context` identifies the writing/reading machine, not a mandatory host
record. Client CLI sends it on writes, so server-side defaults do not assign
worker paths to the server. HTTP request bodies are limited to 1 MiB. Clients
time out after three seconds without automatic retries. The server has no auth
or TLS; use loopback, a trusted private network, or an access-controlled proxy.

## Export and restore

`buro export <file>` creates a deterministic YAML manifest with mode 0600,
records, revisions, and the applied model. Version 2 exports contain definitions
without source-file paths. `buro import <file> [--adopt]` validates all records
and references before replacing the registry in one transaction. A nonempty
target is backed up. Version 1 exports remain supported, including recognized
legacy migrations with `--adopt`.
Finish or preserve an active draft before import; replacing a registry with an
active draft is refused.

Select definitions matching the export when restoring a custom instance; its
`model` object is also a valid full schema for `schema_path`. `--adopt` allows
a different binding, not silent removal of incompatible fields. Import and
export require local storage; worker clients do not copy the central database.
