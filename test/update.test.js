import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { updateBuro, finishUpdate, installationPrefix } from "../src/update.js";
import { connectAgent, refreshConnections } from "../src/agent.js";
import { initializeRegistry } from "../src/migration.js";
import { loadSchema, schemaFromTypes, schemaTypes } from "../src/schema.js";
import { openDatabase, writeSchemaBinding } from "../src/db.js";

async function fixture(t, current = "3.0.2") {
  const home = await mkdtemp(path.join(tmpdir(), "buro-update-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const prefix = path.join(home, "prefix");
  const packageRoot = process.platform === "win32" ? path.join(prefix, "node_modules/buro") : path.join(prefix, "lib/node_modules/buro");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(path.join(prefix, "bin"));
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "buro", version: current }));
  const messages = [], calls = [];
  return { home, prefix, packageRoot, messages, calls, log: text => messages.push(text), run: async (...args) => { calls.push(args); return "3.1.0"; } };
}

function archive(manifest) {
  const contents = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write("package/package.json");
  header.write(contents.length.toString(8).padStart(11, "0") + "\0", 124);
  return gzipSync(Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512 + 1024)]));
}

function releaseFetch({ version = "3.1.0", manifest = { name: "buro", version, engines: { node: ">=24.14" } }, digest, missing = false, status = 200 } = {}) {
  const bytes = archive(manifest);
  const asset = { name: `buro-${version}.tgz`, digest: digest || `sha256:${createHash("sha256").update(bytes).digest("hex")}`, browser_download_url: `https://github.com/Krablante/buro/releases/download/v${version}/buro-${version}.tgz` };
  return async url => url.endsWith("/latest") ? Response.json({ tag_name: `v${version}`, draft: false, prerelease: false, assets: missing ? [] : [asset] }, { status }) : new Response(bytes);
}

test("update checks need no memory and never install, including an older latest release", async t => {
  const f = await fixture(t);
  const result = await updateBuro({ ...f, check: true, fetchImpl: releaseFetch() });
  assert.equal(result.latest, "3.1.0");
  assert.equal(f.calls.length, 0);
  assert.match(f.messages.join("\n"), /Update available/);
  await updateBuro({ ...f, check: true, fetchImpl: releaseFetch({ version: "3.0.1" }) });
  assert.match(f.messages.join("\n"), /no downgrade/);
  assert.equal(f.calls.length, 0);
});

test("update verifies the archive, keeps the actual prefix and finishes with fresh code", async t => {
  const f = await fixture(t);
  const result = await updateBuro({ ...f, fetchImpl: releaseFetch() });
  assert.equal(result.updated, true);
  const install = f.calls[0];
  assert.equal(install[0], process.execPath);
  assert.ok(install[1].includes("--engine-strict"));
  assert.equal(install[1][install[1].indexOf("--prefix") + 1], f.prefix);
  const downloaded = install[1].find(value => value.endsWith(".tgz"));
  assert.equal(existsSync(path.dirname(downloaded)), false);
  assert.deepEqual(f.calls[1][1], [path.join(f.packageRoot, "src/cli.js"), "--version"]);
  assert.deepEqual(f.calls[2][1], [path.join(f.packageRoot, "src/update.js")]);
});

test("bad release metadata, checksum, manifest, engines and HTTP errors stop before installation", async t => {
  const f = await fixture(t);
  for (const [options, error] of [
    [{ missing: true }, /missing its BURO package/],
    [{ digest: `sha256:${"0".repeat(64)}` }, /SHA-256 mismatch/],
    [{ manifest: { name: "other", version: "3.1.0" } }, /name\/version/],
    [{ manifest: { name: "buro", version: "3.1.0", engines: { node: ">=999" } } }, /Update Node.js first/],
    [{ status: 403 }, /rate limit/],
  ]) await assert.rejects(updateBuro({ ...f, fetchImpl: releaseFetch(options) }), error);
  assert.equal(f.calls.length, 0);
});

test("an existing or newer version refreshes integrations without reinstalling; failed install never finalizes", async t => {
  const f = await fixture(t, "3.1.0");
  await updateBuro({ ...f, fetchImpl: releaseFetch() });
  assert.deepEqual(f.calls.map(call => call[1]), [[path.join(f.packageRoot, "src/update.js")]]);
  f.calls.length = 0;
  await updateBuro({ ...f, fetchImpl: releaseFetch({ version: "3.0.2" }) });
  assert.equal(f.calls.length, 1);
  await writeFile(path.join(f.packageRoot, "package.json"), JSON.stringify({ version: "3.0.2" }));
  let attempts = 0;
  await assert.rejects(updateBuro({ ...f, fetchImpl: releaseFetch(), run: async () => { attempts++; throw new Error("npm failed"); } }), /npm failed/);
  assert.equal(attempts, 1);
  assert.throws(() => installationPrefix(path.join(f.home, "checkout")), /global npm installation/);
});

test("refresh remembers custom profiles, discovers older default connections and respects removals", async t => {
  const f = await fixture(t);
  const custom = path.join(f.home, "custom-profile"), defaultRoot = path.join(f.home, ".config/opencodez");
  await connectAgent("opencode", { path: custom, home: f.home });
  await connectAgent("opencodez", { path: defaultRoot, home: f.home, register: false });
  await connectAgent("codex", { home: f.home });
  const manual = path.join(f.home, "AGENTS.md");
  await writeFile(manual, "User instructions\n");
  await connectAgent("file", { path: manual, home: f.home });
  for (const root of [custom, defaultRoot]) await writeFile(path.join(root, "skills/buro/SKILL.md"), "<!-- managed by BURO -->\nOld skill\n");
  const refreshed = await refreshConnections({ home: f.home });
  assert.equal(refreshed.length, 4);
  const skill = await readFile(new URL("../skills/buro/SKILL.md", import.meta.url), "utf8");
  for (const root of [custom, defaultRoot]) assert.equal(await readFile(path.join(root, "skills/buro/SKILL.md"), "utf8"), skill);
  assert.equal(await readFile(path.join(f.home, ".agents/skills/buro/SKILL.md"), "utf8"), skill);
  assert.equal(existsSync(path.join(f.home, ".codex/skills")), false);
  assert.match(await readFile(manual, "utf8"), /^User instructions/);
  const config = path.join(f.home, ".codex/hooks.json");
  await writeFile(config, JSON.stringify({ hooks: { SessionStart: [] } }));
  await rm(path.join(custom, "plugins/buro.js"));
  await writeFile(manual, "Only user instructions\n");
  assert.equal((await refreshConnections({ home: f.home })).length, 1);
  assert.equal(existsSync(path.join(custom, "plugins/buro.js")), false);
  assert.equal(await readFile(manual, "utf8"), "Only user instructions\n");
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")).hooks.SessionStart, []);
  await writeFile(path.join(defaultRoot, "skills/buro/SKILL.md"), "User-owned skill\n");
  await assert.rejects(refreshConnections({ home: f.home }), /existing user file/);
  assert.equal(await readFile(path.join(defaultRoot, "skills/buro/SKILL.md"), "utf8"), "User-owned skill\n");
});

test("finishing adopts bundled definitions with a snapshot, preserves custom types, and skips client storage", async t => {
  const f = await fixture(t);
  const config = { apiUrl: "", instanceRoot: f.home, stateDir: f.home, databasePath: path.join(f.home, "memory.sqlite3"), backupDir: path.join(f.home, "snapshots"), configPath: path.join(f.home, "config.json"), previousConfig: {}, currentContext: "test", backupRetention: 20 };
  await initializeRegistry(config);
  const types = schemaTypes(loadSchema(config));
  types.find(type => type.id === "project").fields.summary.guide = "Previous bundled guide";
  types.push({ id: "book", label: "My book", origin: "custom", fields: { author: { type: "string" } } });
  const db = openDatabase(config.databasePath);
  writeSchemaBinding(db, schemaFromTypes(types, "project"));
  db.close();
  await finishUpdate({ config, home: f.home, log: f.log });
  const updated = loadSchema(config);
  assert.notEqual(updated.kinds.project.definitions.summary.guide, "Previous bundled guide");
  assert.equal(updated.kinds.book.origin, "custom");
  assert.equal(updated.kinds.book.definitions.author.type, "string");
  assert.equal((await readdir(path.join(config.backupDir, "mutation"))).length, 1);
  await finishUpdate({ config: { ...config, apiUrl: "http://unavailable.invalid", databasePath: path.join(f.home, "never-create.sqlite3") }, home: f.home, log: f.log });
  assert.equal(existsSync(path.join(f.home, "never-create.sqlite3")), false);
  const incompatible = schemaTypes(updated);
  incompatible.find(type => type.id === "project").fields.legacy = { type: "string" };
  const oldSchema = schemaFromTypes(incompatible, "project"), oldDb = openDatabase(config.databasePath);
  writeSchemaBinding(oldDb, oldSchema);
  oldDb.prepare("INSERT INTO entities VALUES(?,?,?,?,?)").run("kept", "Kept", "project", JSON.stringify({ legacy: "Preserve this" }), "original");
  oldDb.close();
  await assert.rejects(finishUpdate({ config, home: f.home, log: f.log }), /unknown fields/);
  assert.equal(loadSchema(config).hash, oldSchema.hash);
  const kept = openDatabase(config.databasePath, { readOnly: true });
  assert.equal(JSON.parse(kept.prepare("SELECT data FROM entities WHERE id='kept'").get().data).legacy, "Preserve this");
  kept.close();
});

test("system updates elevate only npm and keep post-install work under the calling user", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async t => {
  const f = await fixture(t), modules = path.dirname(f.packageRoot);
  await chmod(modules, 0o555);
  try {
    await updateBuro({ ...f, fetchImpl: releaseFetch() });
    assert.equal(f.calls[0][0], "sudo");
    assert.deepEqual(f.calls[0][1].slice(0, 2), ["--", process.execPath]);
    assert.ok(f.calls.slice(1).every(call => call[0] === process.execPath));
  } finally { await chmod(modules, 0o755); }
});
