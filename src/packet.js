import yaml from "js-yaml";

function relation(target, current) {
  if (!current) return "current context unknown";
  return target.id === current.id ? "current" : `current: ${current.id}`;
}

function visibleFields(entity, schema) {
  return schema.kinds[entity.kind].fields.filter((name) => (
    entity[name] !== undefined && schema.fields[name].packet !== false
  ));
}

export function entityPacket(entity, schema, currentContext = null, contextEntity = null) {
  const context = entity.kind === schema.context.kind ? entity : contextEntity;
  const sections = [];
  const bySection = new Map();
  for (const name of visibleFields(entity, schema)) {
    const sectionName = schema.fields[name].section || "facts";
    if (!bySection.has(sectionName)) {
      const guide = schema.sections?.[sectionName]?.guide;
      const section = { name: sectionName, ...(guide ? { guide } : {}), fields: [] };
      bySection.set(sectionName, section);
      sections.push(section);
    }
    const guide = schema.fields[name].guide;
    bySection.get(sectionName).fields.push({ name, ...(guide ? { guide } : {}), value: entity[name] });
  }
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    context: context ? {
      id: context.id,
      name: context.name,
      kind: context.kind,
      relation: relation(context, currentContext),
    } : null,
    sections,
  };
}

function renderValue(name, value) {
  if (typeof value === "string" && !value.includes("\n")) return [`  ${name}: ${value}`];
  if (typeof value === "number" || typeof value === "boolean") return [`  ${name}: ${value}`];
  const dumped = yaml.dump(value, { noRefs: true, lineWidth: -1, sortKeys: false }).trimEnd();
  return [`  ${name}:`, ...dumped.split("\n").map((line) => `    ${line}`)];
}

export function renderPacket(packet) {
  const lines = [
    `BURO Entity: ${packet.kind}:${packet.id}`,
    `Name: ${packet.name}`,
  ];
  if (packet.context) lines.push(`Context: ${packet.context.id} (${packet.context.relation})`);
  for (const section of packet.sections) {
    lines.push("", `${section.name.toUpperCase()}:`);
    if (section.guide) lines.push(`  # ${section.guide}`);
    for (const field of section.fields) {
      if (field.guide) lines.push(`  # ${field.name} — ${field.guide}`);
      lines.push(...renderValue(field.name, field.value));
    }
  }
  return `${lines.join("\n")}\n`;
}
