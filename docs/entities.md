# Entities

An entity has a stable `id`, human `name`, preset-defined `kind`, and only fields allowed for that kind.

```text
buro list
buro list service
buro local-context
buro draft pull local-context
buro draft new new-service service
```

Fields have one of nine finite types: string, text, boolean, integer, number, reference, string list, record, or record list. Top-level references may target a declared kind and are checked by the resolver. Records have their own finite nested fields and recursive shape validation.

The active preset determines draft order and output sections. Fields marked `packet: false` remain queryable through entity JSON but stay out of the rendered packet. Fields marked `draft_optional: false` appear in a draft only when they already contain data.
