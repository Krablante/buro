<h1 align="center">BURO</h1>

<p align="center"><strong>Know where the work lives.</strong></p>

<p align="center">A typed registry of projects, services, hosts, and the rules for working with them.<br>One command gives a person or an agent the same recorded facts, on any machine with Node.js.</p>

<p align="center"><a href="README.md"><strong>🇬🇧 English</strong></a> · <a href="README.ru.md">🇷🇺 Русский</a></p>

<p align="center"><img src="assets/stickers-en.svg" width="760" alt="BURO stickers: ask BURO, typed facts, one SQLite database, diff first"></p>

BURO replaces scattered agent context files and retrieval pipelines for facts
you can name: ownership, paths, entry documents, and operating constraints. A
preset defines the fields; SQLite stores the records; the CLI renders a packet
for the entity you ask about. On several machines, an optional HTTP server
shares the same registry without copying the database to every client.

BURO checks structure and declared references. **It cannot prove that a record
is true or still current.** Check facts at their source and correct them when
the world changes. Detailed instructions stay in the owning project's docs;
BURO points you there.

## See it work

```text
$ buro my-service
BURO Entity: service:my-service
Name: My service
Context: workstation (current)

LOCATION:
  host: workstation
  path: /workspace/services/my-service

READ_FIRST:
  read_first:
    - README.md
```

The fields and headings depend on the active preset. An agent's standing
instruction can be short: “Ask BURO for the entity in scope; read the entry
documents it names; check any conflict with the observed system.” Use
`buro current` for the configured machine and its associated entities;
`buro list [kind]` only when you need to discover an identifier.

Ordinary edits follow one review loop:

```text
buro draft pull my-service     # or: draft new <id> [kind], draft delete <id>
# Edit the YAML file printed by the command.
buro draft diff
buro draft push
```

The draft holds the starting revision. A conflicting edit is rejected, and a
successful change creates a pre-write SQLite snapshot. The GIF is captured
from the actual CLI in a disposable instance:

![BURO init, draft, diff, push, and current in a disposable starter instance](assets/demo-en.gif)

## Get started

Requires **Node.js 24.14+**. The CLI itself runs on platforms supported by
Node.js and its built-in SQLite; the Politia deployment script is for its Linux
operator setup.

```sh
git clone https://github.com/Krablante/buro.git
cd buro
npm install -g .
buro init
```

`buro init` prints the exact `buro draft new <hostname> host` command for the
current machine. Run it, open the draft file whose path the command prints,
fill the required `root` and `summary` fields, then run `buro draft diff`,
`buro draft push`, and `buro current`. For development, run `npm install` in
the checkout and invoke `node src/cli.js` without a global installation.

By default the instance lives under `~/.local/share/buro` (including SQLite,
backups, and the active draft). Configuration lives under
`~/.config/buro/config.json`; both locations can be changed. See
[operations](docs/operations.md) for the complete path and environment table.

The default [`starter` preset](presets/starter.yaml) has host, project, service,
and document records. Define another vocabulary in YAML without changing the
engine. Use `buro schema [kind]` to inspect the active model. Politia's
[`politia` preset](presets/politia.yaml) shows a larger real-world model; its
private records are not bundled.

## Where to go next

| Topic | 🇬🇧 English | 🇷🇺 Русский |
| --- | --- | --- |
| Editing and reviewing facts | [Draft workflow](docs/draft-workflow.md) | [Черновики](docs/draft-workflow.ru.md) |
| Entity model and custom presets | [Model](docs/model.md) | [Модель](docs/model.ru.md) |
| CLI, HTTP, and exports | [Interfaces](docs/interfaces.md) | [Интерфейсы](docs/interfaces.ru.md) |
| Storage and code boundaries | [Architecture](docs/architecture.md) | [Архитектура](docs/architecture.ru.md) |
| Configuration, backups, deployment | [Operations](docs/operations.md) | [Эксплуатация](docs/operations.ru.md) |

English uses unsuffixed filenames; other languages use a language suffix
(`README.ru.md`, `docs/model.ru.md`). Add another language with the same topic
names and a new suffix. Keep behavior and commands aligned across versions,
while writing naturally in each language.

## Contribute

Explain the problem, the resulting behavior, and how you checked it. Keep
private registry records out of presets, examples, and public artifacts. For
a substantial change, open an issue first.

Licensed under [MIT](LICENSE).
