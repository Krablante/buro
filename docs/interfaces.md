# Interfaces

The CLI has one generic read model:

```text
buro <id>
buro current
buro list [kind]
buro schema [kind]
buro --version
```

`buro <id>` resolves an exact entity id or a context alias declared by the active preset. `buro current` resolves configured `current_context`, renders that context, and lists entities whose configured member reference points to it.

Administrative portability is explicit:

```text
buro export <file>
buro import <file> [--adopt]
```

Export writes a mode-0600 deterministic YAML manifest containing preset identity, schema hash, entities, and revisions. Import validates the complete manifest and every reference before opening a write transaction, backs up a non-empty target, replaces all entities atomically, and binds the database to the active preset. `--adopt` is required when the manifest came from a different preset version or identity.

The HTTP surface mirrors ordinary resolver operations:

```text
GET    /health
GET    /schema
GET    /entities
GET    /entities/:id
POST   /entities/:id
PUT    /entities/:id
DELETE /entities/:id
GET    /packet/entity/:id?current_context=<id>
```

`GET /packet/entity/:id` returns structured packet JSON; the CLI renders it as text. Client update/delete sends the revision in `If-Match`. Requests have a one-megabyte body limit. Client requests have a three-second timeout and no automatic retries.

The built-in server provides neither authentication nor TLS. It binds to loopback by default. Expose it only on a trusted private network or behind an external access boundary.
