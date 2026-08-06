<p align="center">
  <a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/buro-stamp-dark.svg">
    <img alt="BURO stamp" src="docs/assets/buro-stamp.svg" width="150">
  </picture>
</p>

<h1 align="center">BURO</h1>

<p align="center"><strong>Agent context that survives contact with reality.</strong></p>

<p align="center">No RAG. No <code>AGENTS.md</code>. No context pipeline.<br>
One SQLite file, one schema, one reviewed draft — and the same answer every time you ask.</p>

<p align="center">
  <img alt="Version 1.0.0" src="https://img.shields.io/badge/version-1.0.0-b0303e?style=flat-square">
  <img alt="MIT license" src="https://img.shields.io/github/license/Krablante/buro?color=b0303e&style=flat-square">
</p>

<p align="center">
  <a href="./docs/overview.md">Overview</a> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./docs/draft-workflow.md">Draft workflow</a> ·
  <a href="./docs/operations.md">Operations</a>
</p>

## Why this exists

Every agent needs facts: where a service runs, which command deploys it, what
you must not touch. Getting those facts into the agent is where the industry
lost its mind.

**RAG is a lottery.** You chunk, embed, retrieve, and hope. The answer wobbles
with the embedding model, the chunk size, and the phase of the moon — and it
rots silently, while somebody pays for the vectors forever.

**`AGENTS.md` is a promise nobody keeps.** A markdown file somewhere in the
repo that drifts, duplicates, gets lost, and has to be re-explained to every
new agent — and re-reminded to the old ones. It is not context. It is a rumor
with a filename.

**"Context platforms" are a second infrastructure.** Pipelines, providers,
plugins, generated context trees — they turn one lookup into a system whose
diagram needs its own diagram, and you get to operate it for the rest of your
life.

BURO is the opposite on purpose. Facts are typed, verified once, and stored in
a boring SQLite file. The agent asks; BURO answers. Same question, same
answer, every time. The world changes? You edit one draft, review one diff,
and press the stamp.

## How it works

The resolver is the only door. The CLI and the HTTP API open the same door,
obey the same rules, and cannot invent fields. A preset defines what may
exist; SQLite is the single copy of truth; every write walks through one
reviewed YAML draft.

```mermaid
flowchart LR
  CLI[CLI] --> R[resolver]
  API[HTTP API] --> R
  P[preset · schema] --> R
  R --> D[reviewed draft]
  R --> DB[(SQLite)]
  DB -. snapshot .-> B[(backups)]
```

## The 60-second tour

```console
$ buro init
BURO SQLite ready: ~/.local/share/buro/buro.sqlite3

$ buro schema
BURO schema: politia v2
default kind: project
context kind: host
kinds: project · service · external · lab · dotmd · skill · host

$ buro draft new api service
BURO draft ready
mode: new service
id: api
file: ~/.local/share/buro/BURO_DRAFT.yaml
```

Fill in the facts. Missing fields stay commented; unknown fields do not exist:

```yaml
id: api
name: API
kind: service
category: backend
summary: Public API for Acme. Owns /v1/* and the webhook receiver.
important:
  - Deploys only through the release pipeline.
  - Never restart the database from the API host.
```

```console
$ buro draft diff
BURO draft diff
mode: new entity
id: api

--- new entity
+++ draft
+ id: api
+ name: API
+ kind: service
+ category: backend
+ summary: Public API for Acme. Owns /v1/* and the webhook receiver.
+ important:
+   - Deploys only through the release pipeline.
+   - Never restart the database from the API host.

$ buro draft push
BURO draft pushed
action: created
id: api

$ buro api
BURO Entity: service:api
Name: API

IDENTITY:
  category: backend

SUMMARY:
  summary: Public API for Acme. Owns /v1/* and the webhook receiver.

IMPORTANT:
  important:
    - Deploys only through the release pipeline.
    - Never restart the database from the API host.
```

That is the whole loop: draft, diff, stamp. Every write in BURO goes through
it — including yours.

## Why not X

| The problem | The popular answer | Why it fails | BURO |
| --- | --- | --- | --- |
| Where do agent facts live? | RAG: embed everything, hope | probabilistic answers, silent drift, a permanent vector bill | a typed SQLite registry: verified once, rendered deterministically |
| How do agents learn the rules? | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | files drift and get lost; you keep reminding agents to read them | `buro current` — one command, one packet, every session |
| What if I have many machines? | a context platform: pipelines, plugins, providers | you now operate a second infrastructure forever | local / central / client — one resolver, no database copies on workers |
| Who may write? | anyone, any time | context rots into noise | one reviewed draft per write, diff before push |

## Quick start

BURO requires Node.js 24.14 or newer.

```bash
git clone https://github.com/Krablante/buro.git
cd buro
npm install
npm link

buro init
buro schema
buro list
```

`buro init` creates a local instance under `~/.local/share/buro`. Runtime
data, backups, and drafts stay outside the source tree.

## Everyday commands

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

That is the whole admin surface: `buro init`, `buro backup`, and
`buro serve`. It stays that way.

## Three operating modes

| Mode | Storage | Intended use |
| --- | --- | --- |
| `local` | Opens local SQLite directly | One machine, no service required |
| `central` | Opens SQLite and serves HTTP | Canonical registry for several hosts |
| `client` | Uses the central HTTP API | Thin workers with no database copy |

Client configuration lives in `~/.config/buro/config.json`:

```json
{
  "mode": "client",
  "current_host": "worker-a",
  "central_host": "registry",
  "api_url": "http://registry:8765"
}
```

See [state and runtime](./docs/state-and-runtime.md) for paths, environment
overrides, backup retention, and deployment boundaries.

## Entity model

Every entity has a stable `id`, human-readable `name`, preset-defined `kind`,
and only the fields allowed for that kind. BURO supports nine finite field
types, including references and nested records. Unknown fields and invalid
references fail before data changes.

The bundled [`politia`](./presets/politia.yaml) preset is both a complete
public example and the model Politia runs on. It contains no private instance
entities and no deployment topology.

## HTTP surface

```text
GET    /health
GET    /schema
GET    /entities
GET    /entities/:id
POST   /entities/:id
PUT    /entities/:id
DELETE /entities/:id
GET    /packet/entity/:id?current_host=<id>
```

The API is an optional transport, not a second implementation. Local and
multihost installations keep the same entity and draft contracts.

## What BURO is not

- not a RAG pipeline — no embeddings, no chunks, no hope
- not a filesystem scanner — no crawling, no generated context trees
- not an orchestration platform — no plugin model, no providers, no vendor
- not a documentation generator — these docs are written by humans
- not a place for secrets — presets define structure, instance facts stay in
  your own SQLite

## In production

BURO runs Politia — the multihost
environment it was built for — every day, across several machines. It is
equally at home on one laptop.

Made by one person who got tired of reminding agents to read files.

## Contributing

BURO is about reviewed, verified facts — and so is its contribution process.
Say what changed and why; that is the diff that matters. If a PR looks
generated — a wall of polish and no reasoning — expect it to be sent back. No
human should have to read AI slop to review your work.

Open an issue first for anything bigger than a bug fix.

## License

[MIT](./LICENSE)
