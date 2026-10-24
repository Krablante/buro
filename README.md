<h1 align="center"><img src="assets/buro-cover.jpg" alt="BURO" width="880"></h1>

<p align="center">
  <strong>Typed memory for AI agents.</strong><br>
  Projects, rules, and decisions you can return to in the next session.
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <strong>Start with the PDF guide</strong><br>
  The idea, the setup, and everyday use — in one readable document.
</p>

<p align="center">
  <a href="docs/guide.pdf"><img src="assets/guide-en.svg" alt="Read the full BURO guide in English — PDF" width="390"></a>
  <a href="docs/guide.ru.pdf"><img src="assets/guide-ru.svg" alt="Читать полное руководство BURO на русском — PDF" width="390"></a>
</p>

<p align="center">
  <a href="#why-buro">Why BURO</a> · <a href="#how-it-works-with-an-agent">How it works</a> · <a href="#get-started">Get started</a> · <a href="#documentation">Documentation</a>
</p>

## Why BURO

You return to a website project a week later. The agent needs to know where the
source lives, which server runs it, what you decided last time, and which changes
need your approval. BURO keeps those facts in a record the agent can open when
you name the project.

**Each work object gets its own memory.** Projects, services, devices, books,
or research can have their own records. Memory lives independently of project
folders and can be shared across devices. The agent loads the records needed
for the task and maintains useful facts as the work progresses.

## How memory is organized

A record has a **type**, and that type defines the fields, their formats, and
what belongs in them. This gives the agent a place to look for a fact and a
clear place to save a new one.

For a website project, a record might look like this:

```yaml
id: my-site
name: My website
kind: project
summary: A personal site with articles and notes.
locations:
  - host: laptop
    path: /work/my-site
important:
  - Ask me before publishing.
avoid:
  - Do not put runtime data in the source tree.
read_first:
  - README.md
```

The bundled types require only `id`, `name`, and `kind`. Start with the facts
you actually need.

<details>
<summary><strong>What can a record remember?</strong></summary>

| Field | What belongs here |
| --- | --- |
| `summary` | What the object is and why it exists. |
| `important` | Confirmed decisions, requirements, and approval conditions. |
| `avoid` | Things the agent should not do. |
| `locations` | Source, running installations, URLs, and their devices. |
| `read_first` | Documents to read before working. |
| `related` | Connected objects, documents, and useful links. |
| `notes` | Other durable facts. |
| `aliases` | Other names you use for the same object. |

Types can also define their own fields. Field guides explain how to use them.

</details>

Three types are included:

| Type | For |
| --- | --- |
| `project` | Products and independent undertakings: a site, an app, a book. |
| `service` | Technical components of a working environment. |
| `host` | Computers and servers. |

**Your memory can use your own types.** Create `book`, `research`, or `person`
with the fields you need. Definitions live in the database and are edited through
the same reviewed workflow as records. You can start with `buro types new book`;
the [type guide](docs/model.md) covers the rest.

## How it works with an agent

1. **Before work — give the agent context.** The skill explains how to read and
   maintain memory. A session connection runs `buro current` and supplies the
   current device's record, when present, and a bounded list of associated objects.
   The supplied System prompt block can keep the core rules in every request.
2. **During work — open the relevant records.** When you ask to continue a
   project, the agent calls BURO through the terminal and reads its facts,
   decisions, and constraints. It can follow related records as needed.
3. **After work — keep what will matter later.** By default, the skill tells the
   agent to save useful confirmed decisions, new facts, and corrections. Each
   change goes through a YAML draft, a diff, and a push. When there is nothing
   useful to add, there is nothing to write. You can change this policy.

BURO provides the structure, tools, and instructions. **The quality of autonomous
memory still depends on the agent:** choosing what to remember, checking facts,
and recognizing when saved knowledge is out of date.

## Get started

Requires **Node.js 24.14 or newer**.

```sh
npm install -g \
  https://github.com/Krablante/buro/releases/download/v3.1.0/buro-3.1.0.tgz
buro init
buro connect opencodez
```

Replace `opencodez` with `opencode`, `codex`, or `claude` for your harness.
Connect installs the **skill and session context connection** from the same
package.

After connecting:

- **OpenCode / OpenCodez:** restart the app to load the plugin.
- **Codex:** review and trust the SessionStart hook in `/hooks`, enable hooks
  if needed, then start a new session.
- **Claude Code:** start a new session with SessionStart hooks enabled.

For OpenCodez, using both the [skill](skills/buro/SKILL.md) and the
[System prompt block](skills/buro/system-prompt.md) is recommended: the prompt
keeps the core rules present, and the skill explains the workflow. Add the prompt
yourself in settings; **connect does not edit your System prompt**.

You can now ask the agent to use BURO for a project and keep its memory current.
To open a record yourself, run `buro my-site`; `buro help` shows the commands
and your memory's active definitions.

![A real BURO workflow: create a draft, review the diff, save and read a record](assets/demo-en.gif)

<details>
<summary><strong>A different profile, another agent, or manual editing</strong></summary>

Choose a profile explicitly:

```sh
buro connect opencodez --path /path/to/profile
```

For a harness without a supplied connection, add the instruction block to a file:

```sh
buro connect file --path /path/to/AGENTS.md
```

That file connection adds instructions; automatic session context needs its
own setup. See [agent connections](docs/agents.md).

You can also edit memory yourself:

```sh
buro draft new my-site project
# Edit the printed YAML file. Keep its __buro metadata.
buro draft diff /tmp/buro-draft-EXAMPLE/change.yaml
buro draft push /tmp/buro-draft-EXAMPLE/change.yaml
```

Use the actual printed path for diff and push. For an existing record, start with
`buro draft pull my-site`. Failed pushes keep the draft; conflicting changes
require a fresh one. See [records and types](docs/model.md).

</details>

### Updates

```sh
buro update --check
buro update
```

Update installs the latest stable GitHub release on this device, applies
compatible bundled type updates, and refreshes existing skills, plugins, and
hooks. Custom types are preserved. Restart running agents and the BURO API
afterward. Versions before 3.1 need one manual npm upgrade; older custom profiles
need connect once to register their paths. See [updating BURO](docs/operations.md#updating-buro).

## Storage and preservation

**Local use is a CLI and a SQLite file.** For shared memory, run the BURO HTTP
server on the database device and point clients to it. Clients keep no database
copies. Source code, records, and configuration have separate locations, so
updating the package preserves your memory.

Changes are checked for valid fields, formats, references, and conflicting
revisions. A successful snapshot is required before every mutation; local init
also sets up scheduled backups. BURO runs no model or background chat scanner.
You and the agent establish which facts are true.

The shared server is intended for trusted access through a private network,
VPN, tunnel, or protected HTTPS proxy. It has no built-in authentication or TLS;
storage and backups are unencrypted. See [operation and recovery](docs/operations.md).

## Documentation

The PDF guides at the top walk through the whole system. These references cover
individual tasks:

| Read about | English | Русский |
| --- | --- | --- |
| The complete guide in Markdown | [Guide](docs/guide.md) | [Руководство](docs/guide.ru.md) |
| Types, fields, record edits, v2 migration | [Memory model](docs/model.md) | [Модель памяти](docs/model.ru.md) |
| Skills, prompts, profiles, and hooks | [Agent connections](docs/agents.md) | [Подключение агентов](docs/agents.ru.md) |
| Updates, shared memory, backups, recovery | [Operations](docs/operations.md) | [Эксплуатация](docs/operations.ru.md) |
| Architecture, API, development, releases | [Development](docs/development.md) | [Разработка](docs/development.ru.md) |

Open source under [MIT](LICENSE). Ideas, questions, and improvements are welcome
in [issues](https://github.com/Krablante/buro/issues).
