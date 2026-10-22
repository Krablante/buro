import yaml from "js-yaml";
import { fieldDefinition } from "./schema.js";

function visibleFields(entity, schema) {
  return schema.kinds[entity.kind].fields.filter((name) => (
    entity[name] !== undefined && fieldDefinition(schema, entity.kind, name).packet !== false
      && (!Array.isArray(entity[name]) || entity[name].length > 0)
  ));
}

export function entityPacket(entity, schema) {
  const sections = [];
  const bySection = new Map();
  for (const name of visibleFields(entity, schema)) {
    const sectionName = fieldDefinition(schema, entity.kind, name).section || "facts";
    if (!bySection.has(sectionName)) {
      const guide = schema.sections?.[sectionName]?.guide;
      const section = { name: sectionName, ...(guide ? { guide } : {}), fields: [] };
      bySection.set(sectionName, section);
      sections.push(section);
    }
    const guide = fieldDefinition(schema, entity.kind, name).guide;
    bySection.get(sectionName).fields.push({ name, ...(guide ? { guide } : {}), value: entity[name] });
  }
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
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
