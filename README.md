<h1 align="center">BURO</h1>

<p align="center"><strong>A typed knowledge store for AI agents.</strong></p>

<p align="center">Define record types and fields in YAML.<br>Replace sprawling AGENTS.md and RAG for durable agent context.</p>

<p align="center"><a href="README.md"><strong>🇬🇧 English</strong></a> · <a href="README.ru.md">🇷🇺 Русский</a></p>

BURO stores knowledge as typed records. You define your own types, fields, and
field guides in ordinary YAML files: rules, decisions, constraints, system
descriptions, and anything else your agent needs to remember between sessions.

Instead of loading an ever-growing AGENTS.md or assembling context from RAG
fragments, the agent requests the relevant record by name or id. It gets a
complete record with explicit fields and their meaning. SQLite holds the
knowledge; changes go through a YAML draft, a diff, and a revision check.

## Install and connect

Requires **Node.js 24.14+**. Install the release package:

```sh
npm install -g https://github.com/Krablante/buro/releases/download/v2.0.1/buro-2.0.1.tgz
buro init
buro connect opencodez
```

Choose `opencode`, `codex`, or `claude` instead for those clients. Restart
OpenCode/OpenCodez after installing the plugin; start a new session in the other
clients. For another terminal-capable agent, use
`buro connect file --path /path/to/AGENTS.md`. To edit a System prompt yourself,
copy the output of `buro agent`; `buro agent --full` supplies the detailed workflow.
Connections preserve unrelated instructions and back up files they change.

Then tell your agent, for example: “Remember that my website must only be
published after I approve it.” BURO supplies instructions and a skill; your
agent needs terminal access and permission to maintain records. It does not run
a model, scan your disk, or read chats in the background.

For source work, start with the [development guide](docs/development.md).

## A useful record can be small

```yaml
id: my-site
name: My website
kind: project
important:
  - Ask me before publishing.
```

The defaults include `project`, `service`, `host`, and `item`. All content fields
are optional. Names and aliases work in lookups; ambiguous names ask you to
choose an id. `buro search website` discovers records without dumping the registry.
A name and one important rule are enough for a useful record. BURO checks
structure and conflicting edits; you and your agent verify the facts.

```sh
buro draft new my-site project  # or draft pull / draft delete
# Edit the file printed by the command.
buro draft diff
buro draft push
buro my-site
buro types project
```

One record can have several `locations`, each with its own machine, path, URL,
and purpose. A path without a machine gets the client's current machine when
saved, and that addition appears in the draft diff. Source and runtime can live
on different machines. Existing folder rules belong in records, not in a
mandatory setup questionnaire.
No shared workspace root, folder convention, or host record is required.

![BURO CLI in a disposable instance](assets/demo-en.gif)

## Configure only what you want to change

Program settings live in `~/.config/buro/config.json`. Type definitions are
separate, self-contained YAML files. Defaults work without editing either.

```json
{
  "type_files": ["project", "service", "host", "item"]
}
```

Use `buro types copy project /path/to/my-project.yaml` to create your own
definition, then replace `"project"` in `type_files` with that file's path.
Custom types can use different fields with the same names. There is no hidden
merging or inheritance: one selected definition per type.

Apply changes with `buro init --dry-run`, then `buro init`. Existing data is
validated first. Removing a populated field or type is rejected without
discarding it. Known v1 `host/path` records migrate to `locations`; the old
starter `document` type becomes `item`. Backups are created before adoption.

## Details

| Topic | English | Русский |
| --- | --- | --- |
| Definitions and migration | [Model](docs/model.md) | [Модель](docs/model.ru.md) |
| Agent connections | [Agents](docs/agents.md) | [Агенты](docs/agents.ru.md) |
| Reviewed changes | [Drafts](docs/draft-workflow.md) | [Черновики](docs/draft-workflow.ru.md) |
| CLI, HTTP, portability | [Interfaces](docs/interfaces.md) | [Интерфейсы](docs/interfaces.ru.md) |
| Storage and boundaries | [Architecture](docs/architecture.md) | [Архитектура](docs/architecture.ru.md) |
| Configuration and deployment | [Operations](docs/operations.md) | [Эксплуатация](docs/operations.ru.md) |
| Development, packaging, documentation | [Development](docs/development.md) | [Разработка](docs/development.ru.md) |

An optional HTTP server shares a registry across machines. Local use requires
no server. The built-in HTTP server has no authentication or TLS; use loopback,
a trusted private network, or an access-controlled proxy.

Store durable knowledge once and request it as work calls for it. Coding
conventions, operating rules, and decisions get their own fields and types.
Use `read_first` to connect a record to detailed guides and source files.

## Contribute

Describe the problem, resulting behavior, and practical verification. Keep
private records and operator details out of public files. Licensed under [MIT](LICENSE).
