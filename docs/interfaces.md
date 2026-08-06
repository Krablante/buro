# Interfaces

The CLI has one generic read model:

```text
buro <id>
buro current
buro list [kind]
buro schema
```

`buro <id>` resolves an exact entity id or a context alias declared by the active preset. `buro current` resolves the configured current context and lists entities whose context reference points to it.

The HTTP surface mirrors the resolver:

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

`GET /packet/entity/:id` returns structured packet JSON; the CLI renders that structure as text. `POST`, `PUT`, and `DELETE` are the transport used when a client-mode CLI pushes its already reviewed local draft. They accept entity JSON and do not implement a server-side draft store.

Requests have a one-megabyte body limit. Client requests have a three-second timeout and no automatic retries. Ordinary CLI errors contain one concise message without a stack trace. The built-in server provides neither authentication nor TLS; keep it on loopback or a trusted private network behind an external access boundary.
