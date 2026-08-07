function fieldGuideText(schema) {
  return schema.kinds[schema.default_kind].fields
    .filter((field) => schema.fields[field].guide)
    .map((field) => `  - ${field}: ${schema.fields[field].guide}.`)
    .join("\n");
}

function kindSectionNames(schema, kind) {
  return [...new Set(schema.kinds[kind].fields.map((field) => schema.fields[field].section || "facts"))];
}

function sectionGuideLines(schema, kind, indent = "  ") {
  return kindSectionNames(schema, kind)
    .filter((name) => schema.sections?.[name]?.guide)
    .map((name) => `${indent}- ${name}: ${schema.sections[name].guide}`);
}

export function renderUsage(schema) {
  const sections = sectionGuideLines(schema, schema.default_kind);
  return [
    "BURO keeps typed, moderated agent context in one SQLite registry.",
    "",
    "Usage:",
    "  buro <id>",
    "  buro current",
    "  buro list [kind]",
    "  buro schema",
    "  buro schema <kind>",
    "  buro draft pull <id>",
    "  buro draft new <id> [kind]",
    "  buro draft delete <id>",
    "  buro draft diff",
    "  buro draft push",
    "  buro draft clear",
    "  buro export <file>",
    "  buro import <file> [--adopt]",
    "  buro --version",
    "  buro help",
    "",
    "Commands:",
    "  <id>          Render one entity.",
    "  current       Render current-context information for agent prompts.",
    "  list [kind]   List all entities, optionally filtered by kind.",
    "  schema        Show the active preset; add a kind for its section and field guide.",
    "  draft         Review and apply the one local YAML draft.",
    "  export        Write a complete portable registry manifest.",
    "  import        Validate and atomically replace from a manifest.",
    "  help          Show this usage and the default-kind section and field guide.",
    "",
    "How to edit entities:",
    `  Use draft for every write. The default kind is ${schema.default_kind}. Leave unknown facts empty instead of guessing.`,
    "",
    ...(sections.length ? [
      `${schema.default_kind} sections:`,
      ...sections,
      "",
    ] : []),
    `${schema.default_kind} fields:`,
    fieldGuideText(schema),
    "",
  ].join("\n");
}

export function renderSchemaSummary(schema) {
  return `${[
    `BURO schema: ${schema.id} v${schema.version}`,
    `source: ${schema.source}`,
    `default kind: ${schema.default_kind}`,
    `context kind: ${schema.context.kind}`,
    "kinds:",
    ...Object.keys(schema.kinds).map((kind) => `- ${kind}`),
  ].join("\n")}\n`;
}

export function renderKindSchema(schema, kind) {
  const definition = schema.kinds[kind];
  if (!definition) throw new Error(`unsupported entity kind: ${kind}`);
  const sections = sectionGuideLines(schema, kind, "");
  const lines = [
    `BURO kind: ${kind}`,
    `preset: ${schema.id} v${schema.version}`,
    ...(sections.length ? ["sections:", ...sections] : []),
    "fields:",
    "- id (string, required): stable entity id",
    "- name (string, required): human-readable name",
    "- kind (string, required): entity kind",
  ];
  for (const name of definition.fields) {
    const field = schema.fields[name];
    lines.push(`- ${name} (${field.type}${field.required ? ", required" : ""}): ${field.guide || "no guide"}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCliError(error) {
  return `BURO error: ${error instanceof Error ? error.message : String(error)}\n`;
}

export function renderEntityListLine(entity, currentContext) {
  const marker = entity.id === currentContext ? " [CURRENT]" : "";
  return `${entity.kind}\t${entity.id}\t${entity.name}${marker}`;
}

export function renderCurrentContext({ currentContext, home, contextRoot, packetText, members }) {
  const lines = [
    "## BURO Current Context",
    "",
    "source: buro current",
    `home: ${home || "-"}`,
    `context_root: ${contextRoot || "-"}`,
    `current_context: ${currentContext || "-"}`,
    "",
    "[buro current context]",
    packetText.trimEnd(),
    "",
    "[buro current entities]",
    ...(members.length ? members.map((entity) => renderEntityListLine(entity, currentContext)) : ["No entities in the current context."]),
  ];
  return `${lines.join("\n")}\n`;
}

export function renderDraftEntityReady({ filePath, id, mode, target }) {
  return `BURO draft ready\nmode: ${mode}\nid: ${id}\nfile: ${filePath}\ntarget: ${target}\n\nEdit the YAML file, then run \`buro draft diff\` and \`buro draft push\`.\n`;
}

export function renderDraftDeleteReady({ filePath, id, target }) {
  return `BURO delete draft ready\nid: ${id}\nfile: ${filePath}\ntarget: ${target}\n\nRun \`buro draft diff\` to inspect, then \`buro draft push\` to delete.\n`;
}

export function renderDraftDiffResult({ id, mode, diffText }) {
  return `BURO draft diff\nmode: ${mode}\nid: ${id}\n\n${diffText || "No changes."}\n`;
}

export function renderDraftPushResult({ action, id, filePath }) {
  return `BURO draft pushed\naction: ${action}\nid: ${id}\ncleared: ${filePath}\n`;
}

export function renderDraftClearResult({ filePath }) {
  return `BURO draft cleared\nfile: ${filePath}\n`;
}
