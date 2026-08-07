#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "src", "cli.js");
const starterPresetPath = path.join(repositoryRoot, "presets", "starter.yaml");
const assetsDir = path.join(repositoryRoot, "assets");
const packageVersion = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version;

const WIDTH = 1000;
const HEIGHT = 620;
const FPS = 10;
const DURATION = 25.5;

function resolveFontsDir() {
  const candidates = [
    process.env.BURO_DEMO_FONTS_DIR,
    "/usr/share/fonts/truetype/dejavu",
    "/usr/local/share/fonts/dejavu",
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  const found = candidates.find((candidate) => (
    existsSync(path.join(candidate, "DejaVuSans.ttf"))
      && existsSync(path.join(candidate, "DejaVuSansMono.ttf"))
  ));
  if (!found) {
    fail("DejaVu Sans and DejaVu Sans Mono were not found; set BURO_DEMO_FONTS_DIR to their directory");
  }
  return found;
}

const translations = {
  en: {
    name: "Workstation",
    summary: "Primary workspace for Acme projects.",
    title: "reviewed facts, one draft",
    note: "real starter CLI · generated from source",
  },
  ru: {
    name: "Рабочая станция",
    summary: "Основное рабочее пространство проектов Acme.",
    title: "проверенные факты, один черновик",
    note: "реальный starter CLI · собрано из исходников",
  },
};

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail([
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
      result.stdout?.trimEnd(),
      result.stderr?.trimEnd(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trimEnd();
}

function cleanEnvironment(workDir) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("BURO_")),
  );
  return {
    ...env,
    HOME: path.join(workDir, "home"),
    NO_COLOR: "1",
    BURO_CONFIG: path.join(workDir, "config.json"),
    BURO_CURRENT_CONTEXT: "workstation",
    BURO_MODE: "local",
    BURO_PRESET: "starter",
    BURO_ROOT: path.join(workDir, "instance"),
    BURO_SCHEMA_PATH: starterPresetPath,
  };
}

function runCli(args, env) {
  return run(process.execPath, [cliPath, ...args], { env });
}

function replaceExactlyOnce(text, pattern, replacement, label) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (matches?.length !== 1) fail(`expected one ${label} in generated draft, found ${matches?.length || 0}`);
  return text.replace(pattern, replacement);
}

function normalizePaths(text, env) {
  return String(text)
    .replaceAll(env.BURO_ROOT, "~/.local/share/buro")
    .replaceAll(env.HOME, "~");
}

function requireText(text, expected, surface) {
  if (!text.includes(expected)) fail(`${surface} no longer contains ${JSON.stringify(expected)}`);
}

function commandBlock(command, output) {
  return `$ ${command}\n${output}`.trimEnd();
}

function selectedDiff(output) {
  const lines = output.split("\n");
  const active = lines.filter((line) => /^\+ (id|name|kind|root|summary):/.test(line));
  const fromLabel = lines.find((line) => line.startsWith("--- "));
  const toLabel = lines.find((line) => line.startsWith("+++ "));
  if (active.length !== 5) fail(`draft diff exposed ${active.length} expected demo fields instead of 5`);
  if (!fromLabel || !toLabel) fail("draft diff no longer exposes its source and target labels");
  return [...lines.slice(0, 3), "", fromLabel, toLabel, "  …", ...active].join("\n");
}

function selectedCurrent(output) {
  const prefixes = [
    "## BURO Current Context",
    "context_root:",
    "current_context:",
    "BURO Entity:",
    "Name:",
    "Context:",
    "LOCATION:",
    "  root:",
    "SUMMARY:",
    "  summary:",
    "[buro current entities]",
    "No entities in the current context.",
  ];
  const lines = output.split("\n").filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));
  if (lines.length !== prefixes.length) fail(`buro current demo selection changed: expected ${prefixes.length} lines, found ${lines.length}`);
  return [
    ...lines.slice(0, 3),
    "",
    ...lines.slice(3, 6),
    "",
    ...lines.slice(6, 10),
    "",
    ...lines.slice(10),
  ].join("\n");
}

async function captureFlow(language, workDir) {
  const copy = translations[language];
  const env = cleanEnvironment(workDir);
  const instanceRoot = env.BURO_ROOT;
  const draftPath = path.join(instanceRoot, "BURO_DRAFT.yaml");

  const init = normalizePaths(runCli(["init"], env), env);
  requireText(init, "Preset: starter v1", "buro init");
  requireText(init, "Next: buro draft new workstation host", "buro init");

  const draftReady = normalizePaths(runCli(["draft", "new", "workstation", "host"], env), env);
  requireText(draftReady, "mode: new host", "buro draft new");
  requireText(draftReady, "id: workstation", "buro draft new");

  let draft = await readFile(draftPath, "utf8");
  draft = replaceExactlyOnce(draft, /^name: workstation$/m, `name: ${copy.name}`, "name field");
  draft = replaceExactlyOnce(draft, /^root:\s*$/m, "root: ~/workspace", "root field");
  draft = replaceExactlyOnce(draft, /^summary:\s*$/m, `summary: ${copy.summary}`, "summary field");
  await writeFile(draftPath, draft, { encoding: "utf8", mode: 0o600 });

  const parsedDraft = yaml.load(draft);
  const draftExcerpt = ["id", "name", "kind", "root", "summary"]
    .map((name) => `${name}: ${parsedDraft[name]}`)
    .join("\n");

  const diff = normalizePaths(runCli(["draft", "diff"], env), env);
  requireText(diff, "+ root: ~/workspace", "buro draft diff");
  requireText(diff, `+ summary: ${copy.summary}`, "buro draft diff");

  const pushed = normalizePaths(runCli(["draft", "push"], env), env);
  requireText(pushed, "action: created", "buro draft push");

  const current = normalizePaths(runCli(["current"], env), env);
  requireText(current, "BURO Entity: host:workstation", "buro current");
  requireText(current, "Context: workstation (current)", "buro current");
  requireText(current, `summary: ${copy.summary}`, "buro current");

  const listed = runCli(["list", "host"], env);
  requireText(listed, `host\tworkstation\t${copy.name} [CURRENT]`, "buro list host");

  return [
    { start: 0, end: 3.2, text: commandBlock("buro init", init) },
    { start: 3.2, end: 7, text: commandBlock("buro draft new workstation host", draftReady) },
    { start: 7, end: 11.5, text: commandBlock("$EDITOR ~/.local/share/buro/BURO_DRAFT.yaml", draftExcerpt) },
    { start: 11.5, end: 16, text: commandBlock("buro draft diff", selectedDiff(diff)) },
    { start: 16, end: 19.5, text: commandBlock("buro draft push", pushed) },
    { start: 19.5, end: DURATION, text: commandBlock("buro current", selectedCurrent(current)) },
  ];
}

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function assEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}

function styledBody(text) {
  return text.split("\n").map((line) => {
    if (line.startsWith("$ ")) {
      return `{\\c&H003E30B0&}$ {\\c&H00FCF6F0&}${assEscape(line.slice(2))}`;
    }
    if (line.startsWith("+ ")) return `{\\c&H0050B93F&}${assEscape(line)}`;
    if (line.trim() === "…") return `{\\c&H009E948B&}${assEscape(line)}`;
    return assEscape(line);
  }).join("\\N");
}

function assDocument(language, frames) {
  const copy = translations[language];
  const end = assTime(DURATION);
  const events = [
    `Dialogue: 0,0:00:00.00,${end},Header,,0,0,0,,{\\c&H003E30B0&\\b1}BURO{\\c&H009E948B&\\b0}  —  ${assEscape(copy.title)}`,
    `Dialogue: 0,0:00:00.00,${end},Chrome,,0,0,0,,{\\c&H004355F8&}■  {\\c&H0039A7FE&}■  {\\c&H0046C85A&}■`,
    `Dialogue: 0,0:00:00.00,${end},Note,,0,0,0,,${assEscape(copy.note)} · v${assEscape(packageVersion)}`,
    ...frames.map((frame) => (
      `Dialogue: 0,${assTime(frame.start)},${assTime(frame.end)},Body,,0,0,0,,${styledBody(frame.text)}`
    )),
  ];
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Header,DejaVu Sans,19,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,8,30,30,16,1
Style: Chrome,DejaVu Sans,13,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,7,19,30,20,1
Style: Body,DejaVu Sans Mono,19,&H00D9D1C9,&H00D9D1C9,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,7,38,30,78,1
Style: Note,DejaVu Sans,15,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,3,30,30,18,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

function ffmpegFilter(assPath, fontsDir) {
  const escapedAss = assPath.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
  const escapedFonts = fontsDir.replaceAll(":", "\\:").replaceAll("'", "\\'");
  return `drawbox=x=0:y=54:w=iw:h=1:color=0xb0303e:t=fill,ass=filename='${escapedAss}':fontsdir='${escapedFonts}'`;
}

async function renderGif(language, frames, workDir) {
  const assPath = path.join(workDir, `demo-${language}.ass`);
  const palettePath = path.join(workDir, `demo-${language}-palette.png`);
  const gifPath = path.join(workDir, `demo-${language}.gif`);
  await writeFile(assPath, assDocument(language, frames), "utf8");

  const source = `color=c=0x0d1117:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}`;
  const filter = ffmpegFilter(assPath, resolveFontsDir());
  run("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", source,
    "-vf", `${filter},palettegen=max_colors=64:reserve_transparent=0:stats_mode=diff`,
    "-frames:v", "1", palettePath,
  ]);
  run("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", source, "-i", palettePath,
    "-lavfi", `[0:v]${filter}[terminal];[terminal][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    "-loop", "0", gifPath,
  ]);

  const details = await stat(gifPath);
  if (details.size < 10_000) fail(`generated ${path.basename(gifPath)} is unexpectedly small (${details.size} bytes)`);
  return gifPath;
}

async function publishOrCheck(generatedPath, language, check) {
  const target = path.join(assetsDir, `demo-${language}.gif`);
  if (!check) {
    await copyFile(generatedPath, target);
    return { target, changed: true };
  }
  let current;
  try {
    current = await readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${path.relative(repositoryRoot, target)} is missing; run \`npm run demos\``);
    throw error;
  }
  const generated = await readFile(generatedPath);
  if (!current.equals(generated)) fail(`${path.relative(repositoryRoot, target)} is stale; run \`npm run demos\``);
  return { target, changed: false };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const check = args.delete("--check");
  if (args.size) fail(`unsupported option: ${[...args][0]}`);
  run("ffmpeg", ["-hide_banner", "-h", "filter=ass"]);

  const workRoot = await mkdtemp(path.join(tmpdir(), "buro-readme-demos-"));
  try {
    for (const language of Object.keys(translations)) {
      const languageRoot = path.join(workRoot, language);
      const frames = await captureFlow(language, languageRoot);
      const generated = await renderGif(language, frames, workRoot);
      const result = await publishOrCheck(generated, language, check);
      const size = (await stat(check ? generated : result.target)).size;
      console.log(`${check ? "verified" : "generated"}: ${path.relative(repositoryRoot, result.target)} (${size} bytes)`);
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`BURO demo generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
