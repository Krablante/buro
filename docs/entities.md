# Entities

An entity has a stable `id`, human `name`, preset-defined `kind`, one internal `updated_at` revision, and only fields allowed for that kind.

```text
buro list
buro list service
buro schema service
buro local-context
buro draft pull local-context
buro draft new new-service service
```

Fields have one of nine finite types: string, text, boolean, integer, number, reference, string list, record, or record list. Top-level references may target a declared kind and are checked by the resolver. Records have finite nested fields and recursive shape validation.

The active preset determines draft order and packet sections. Fields marked `packet: false` remain available through entity JSON but stay out of rendered packets. Fields marked `draft_optional: false` appear in a draft only when they already contain data.

Context ids and aliases are matched case-insensitively but otherwise literally: dots and colons are not discarded. The engine rejects ambiguous context ids or aliases instead of choosing one silently.
