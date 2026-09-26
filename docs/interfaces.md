# Interfaces

[English](interfaces.md) · [Русский](interfaces.ru.md) · [README](../README.md)

The everyday CLI reads are `buro <id>`, `buro current`, `buro list [kind]`,
and `buro schema [kind]`. An exact id wins over an alias. `current` resolves
the configured context and lists records whose member reference points to it;
it is a scoped view, not the whole registry. `buro --version` reports the
installed package version. [Draft commands](draft-workflow.md) handle ordinary
writes.

## HTTP for clients

Run `buro serve --host 127.0.0.1 --port 8765` on a central instance. The
server uses the same resolver and database as the local CLI.

| Route | Meaning |
| --- | --- |
| `GET /health` | Database and active preset status |
| `GET /schema` | Active preset for client-side draft validation |
| `GET /entities` | All full entity JSON (export or administration) |
| `GET /entities?summary=1&kind=host&current_context=worker` | Compact list and current-context id; `kind` is optional |
| `GET /current?current_context=worker` | Context id/root, packet, and compact member list |
| `GET /entities/:id` | One entity, resolving context aliases |
| `POST /entities/:id` | Create an entity |
| `PUT /entities/:id` | Update an entity with `If-Match` revision |
| `DELETE /entities/:id` | Delete an entity with `If-Match` revision |
| `GET /packet/entity/:id?current_context=worker` | Structured packet with guides |

The client CLI renders packets locally from the structured response. Draft-only
guidance does not appear in packets. An update or delete sends the revision
from the starting entity in `If-Match`; stale revisions are rejected. Requests
have a 1 MiB body limit. Client requests time out after three seconds without
automatic retries. The built-in server has neither authentication nor TLS:
bind to loopback or limit access to a trusted private network.

## Whole-registry portability

`buro export <file>` writes a deterministic YAML manifest, mode `0600`, with
the preset identity, model hash, records, and revisions. `buro import <file>
[--adopt]` validates the full manifest and every declared reference, takes a
backup of a nonempty target, and replaces the registry in one transaction.
`--adopt` is needed when the manifest's preset identity or version differs.
These commands require direct storage. Exports contain private instance
facts; keep them in private state. Import is the deliberate path for recovery
and model migration, not ordinary entity editing.
