import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { initializeRegistry } from "../src/migration.js";
import { loadSchema, normalizeEntity, schemaFromTypes, typeDefinition } from "../src/schema.js";
import { draftMetadata, readDraft, dump } from "../src/draft.js";
import { applyChange, resolveEntity, resolveCurrentContext } from "../src/resolver.js";
import { createApiServer } from "../src/api.js";
import { createApiClient } from "../src/api-client.js";
import { backupDatabase, indexEntity, openDatabase } from "../src/db.js";
import { exportRegistry, importRegistry, restoreRegistry } from "../src/registry.js";
import { connectAgent } from "../src/agent.js";
import { scheduledBackup } from "../src/backup.js";
import { renderCurrentContext } from "../src/cli-output.js";
import { entityPacket, renderPacket } from "../src/packet.js";

async function instance(t) {
  const root = await mkdtemp(path.join(tmpdir(), "buro-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { apiUrl: "", instanceRoot: root, stateDir: root, databasePath: path.join(root, "registry.sqlite3"), backupDir: path.join(root, "snapshots"), configPath: path.join(root, "config.json"), previousConfig: {}, currentContext: "desk", currentLimit: 2, backupRetention: 20 };
  await initializeRegistry(config);
  const change = (subject, mode, value, revision, schema = loadSchema(config), id = value?.id) => applyChange({ value, metadata: draftMetadata(schema, subject, mode, id, revision) }, config);
  return { root, config, change };
}

test("fresh definitions, independent types, false values and required fields", async t => {
  const { config, change } = await instance(t);
  assert.deepEqual(Object.keys(loadSchema(config).kinds), ["project", "service", "host"]);
  await change("type", "create", { id: "book", label: "Book", fields: { published: { type: "boolean", required: true }, rules: { type: "string-list" } } });
  await assert.rejects(change("record", "create", { id: "missing", name: "Missing", kind: "book" }), /published is required/);
  await change("record", "create", { id: "city", name: "City", kind: "book", published: false });
  assert.equal((await resolveEntity("city", config)).published, false);
  const oldCity = await resolveEntity("city", config);
  let current = loadSchema(config);
  let definition = typeDefinition(current, "book");
  definition.fields.edition = { type: "integer", default: 1 };
  await change("type", "update", definition, current.kinds.book.revision);
  const firstEdition = await resolveEntity("city", config);
  assert.equal(firstEdition.edition, 1);
  assert.notEqual(firstEdition.updated_at, oldCity.updated_at);
  current = loadSchema(config);
  definition = typeDefinition(current, "book");
  definition.fields.edition.default = 2;
  await change("type", "update", definition, current.kinds.book.revision);
  assert.equal((await resolveEntity("city", config)).edition, 1);
  await change("record", "create", { id: "new-book", name: "New book", kind: "book", published: false });
  assert.equal((await resolveEntity("new-book", config)).edition, 2);
  const schema = loadSchema(config);
  await assert.rejects(change("type", "update", { id: "book", fields: {} }, schema.kinds.book.revision), /unknown fields/);
  assert.equal((await resolveEntity("city", config)).published, false);
});

test("record revisions, type revisions and generation reject stale changes", async t => {
  const { config, change } = await instance(t);
  await change("record", "create", { id: "one", name: "One", kind: "project" });
  const entity = await resolveEntity("one", config), schema = loadSchema(config);
  await change("record", "update", { ...entity, name: "Changed" }, entity.updated_at);
  await assert.rejects(change("record", "update", { ...entity, name: "Stale" }, entity.updated_at, schema), /record changed/);
  await change("type", "create", { id: "book", fields: {} });
  const before = loadSchema(config);
  await change("type", "update", { id: "book", label: "New label", fields: {} }, before.kinds.book.revision);
  await assert.rejects(change("record", "create", { id: "book1", name: "Book", kind: "book" }, undefined, before), /type changed/);
  const exportFile = path.join(config.instanceRoot, "export.yaml");
  await exportRegistry(exportFile, config);
  const current = await resolveEntity("one", config), old = loadSchema(config);
  await importRegistry(exportFile, config);
  await assert.rejects(change("record", "update", current, current.updated_at, old), /replaced or restored/);
});

test("names can overlap; exact IDs win; deleted IDs are permanently reserved", async t => {
  const { config, change } = await instance(t);
  await change("record", "create", { id: "a", name: "Same", kind: "project" });
  await change("record", "create", { id: "b", name: "Same", kind: "project", aliases: ["a"] });
  assert.equal((await resolveEntity("a", config)).id, "a");
  await assert.rejects(resolveEntity("Same", config), /ambiguous.*a, b/);
  const entity = await resolveEntity("a", config);
  await change("record", "delete", null, entity.updated_at, loadSchema(config), "a");
  await assert.rejects(change("record", "create", { id: "a", name: "New", kind: "project" }), /deleted record/);
});

test("informational related links permit deletion, nested refs block deletion and kind change", async t => {
  const { config, change } = await instance(t);
  await change("record", "create", { id: "server", name: "Server", kind: "host" });
  await change("type", "create", { id: "site", fields: { runtime: { type: "record", fields: { host: { type: "ref", target_kind: "host" } } } } });
  await change("record", "create", { id: "site", name: "Site", kind: "site", runtime: { host: "server" } });
  const server = await resolveEntity("server", config);
  await assert.rejects(change("record", "delete", null, server.updated_at, loadSchema(config), server.id), /referenced by site/);
  await assert.rejects(change("record", "update", { ...server, kind: "project" }, server.updated_at), /referenced by site/);
  const site = await resolveEntity("site", config);
  await change("record", "update", { id: "site", name: "Site", kind: "project", related: [{ id: "server" }] }, site.updated_at);
  await change("record", "delete", null, server.updated_at, loadSchema(config), server.id);
  assert.equal((await resolveEntity("site", config)).related[0].id, "server");
});

test("locations normalize the client device and current reports actual truncation", async t => {
  const { config, change } = await instance(t);
  for (const id of ["a", "b", "c"]) await change("record", "create", { id, name: id, kind: "project", locations: [{ path: `/work/${id}` }] });
  assert.equal((await resolveEntity("a", config)).locations[0].host, "desk");
  const current = await resolveCurrentContext(config);
  assert.equal(current.packet, null);
  assert.equal(current.members.length, 2);
  assert.equal(current.truncated, true);
  assert.equal((await resolveCurrentContext({ ...config, currentLimit: 3 })).truncated, false);
  await assert.rejects(change("record", "create", { id: "relative", name: "Relative", kind: "project", locations: [{ path: "../work" }] }), /absolute/);
  await change("record", "create", { id: "desk", name: "My device", kind: "host" });
  const own = renderCurrentContext(await resolveCurrentContext(config), renderPacket);
  assert.match(own, /device: desk/);
  assert.match(own, /Name: My device/);
  assert.ok(!own.includes("current context unknown"));
  const schema = loadSchema(config), db = openDatabase(config.databasePath);
  db.exec("BEGIN");
  for (let i = 0; i < 105; i++) {
    const id = `aa-${i}`;
    db.prepare("INSERT INTO entities VALUES(?,?,?,?,?)").run(id, id, "project", JSON.stringify({ aliases: ["device-alias"] }), id);
    indexEntity(db, { id, name: id, kind: "project", aliases: ["device-alias"] }, schema);
  }
  db.exec("COMMIT"); db.close();
  await change("record", "create", { id: "zz-device", name: "Device", kind: "host", aliases: ["device-alias"] });
  const aliased = await resolveCurrentContext({ ...config, currentContext: "device-alias" });
  assert.equal(aliased.context.id, "zz-device");
});

test("backup failure cancels mutation; export/import and restore preserve types and retired IDs", async t => {
  const { config, change, root } = await instance(t);
  await change("record", "create", { id: "one", name: "One", kind: "project" });
  const blocked = path.join(root, "blocked"); await writeFile(blocked, "file");
  const value = { id: "two", name: "Two", kind: "project" };
  await assert.rejects(applyChange({ value, metadata: draftMetadata(loadSchema(config), "record", "create", "two") }, { ...config, backupDir: blocked }));
  assert.equal(await resolveEntity("two", config), null);
  const file = path.join(root, "export.yaml"); await exportRegistry(file, config);
  const snapshot = await backupDatabase(config.databasePath, config);
  const old = loadSchema(config);
  const one = await resolveEntity("one", config);
  await change("record", "delete", null, one.updated_at, old, one.id);
  const preview = await importRegistry(file, config, { dryRun: true });
  assert.equal(preview.count, 1);
  assert.equal(await resolveEntity("one", config), null);
  await assert.rejects(restoreRegistry(snapshot, { ...config, configPath: path.join(blocked, "config.json") }));
  assert.equal(await resolveEntity("one", config), null);
  assert.equal(loadSchema(config).generation, old.generation);
  await restoreRegistry(snapshot, config);
  assert.equal((await resolveEntity("one", config)).name, "One");
  assert.notEqual(loadSchema(config).generation, old.generation);
  const empty = JSON.parse(JSON.stringify((await import("js-yaml")).default.load(await readFile(file, "utf8"))));
  empty.entities = []; empty.retired_ids = ["retired"];
  await writeFile(file, dump(empty)); await importRegistry(file, config);
  await assert.rejects(change("record", "create", { id: "retired", name: "Retired", kind: "project" }), /deleted record/);
});

test("HTTP uses fresh definitions after type changes and keeps clients on remote storage", async t => {
  const { config } = await instance(t);
  const server = createApiServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = createApiClient(`http://127.0.0.1:${server.address().port}`, { currentContext: "worker", currentLimit: 2 });
  let schema = await client.schema();
  await client.change({ value: { id: "book", fields: {} }, metadata: draftMetadata(schema, "type", "create", "book") });
  schema = await client.schema();
  assert.ok(schema.kinds.book);
  await client.change({ value: { id: "book1", name: "Book", kind: "book" }, metadata: draftMetadata(schema, "record", "create", "book1") });
  assert.equal((await client.entity("book1")).kind, "book");
  assert.equal((await client.current()).context.id, "worker");
  const bulk = await fetch(`http://127.0.0.1:${server.address().port}/records?kind=book&full=1&limit=1&offset=0`).then(response => response.json());
  assert.equal(bulk.entities[0].id, "book1");
  assert.equal(typeof bulk.entities[0].updated_at, "string");
  const snapshots = (await readdir(path.join(config.backupDir, "mutation"))).sort();
  const snapshot = openDatabase(path.join(config.backupDir, "mutation", snapshots.at(-1)), { readOnly: true });
  const backup = JSON.parse(snapshot.prepare("SELECT value FROM buro_meta WHERE key='backup'").get().value);
  assert.equal(backup.settings.current_context, "desk");
  snapshot.close();
});

test("CLI creates concurrent file drafts, previews normalized facts and retains failed pushes", async t => {
  const { config, root } = await instance(t);
  const env = { ...process.env, BURO_CONFIG: config.configPath, BURO_ROOT: root, BURO_DATABASE_PATH: config.databasePath, BURO_BACKUP_DIR: config.backupDir, BURO_API_URL: "", BURO_CURRENT_CONTEXT: "desk" };
  const cli = (...args) => spawnSync(process.execPath, [new URL("../src/cli.js", import.meta.url).pathname, ...args], { encoding: "utf8", env });
  const file = output => output.stdout.match(/Draft: (.+)/)[1];
  const first = file(cli("draft", "new", "first")), second = file(cli("draft", "new", "second"));
  t.after(async () => { for (const item of [first, second]) await rm(path.dirname(item), { recursive: true, force: true }); });
  assert.notEqual(first, second);
  const parsed = await readDraft(first); parsed.value.locations = [{ path: "/work" }];
  await writeFile(first, dump({ __buro: parsed.metadata, ...parsed.value }));
  assert.match(cli("draft", "diff", first).stdout, /host: desk/);
  assert.equal(cli("draft", "push", first).status, 0);
  const bad = await readDraft(second); bad.value.unknown = true;
  await writeFile(second, dump({ __buro: bad.metadata, ...bad.value }));
  assert.equal(cli("draft", "push", second).status, 1);
  assert.ok(await readFile(second));
  assert.equal(cli("current", "--brief").status, 1);
  assert.match(cli("help").stdout, /Active definitions/);
  const previousClient = path.join(root, "v2-client.json");
  const unopened = path.join(root, "must-not-create");
  await writeFile(previousClient, JSON.stringify({ mode: "client", central_host: "registry" }));
  const { BURO_API_URL, BURO_DATABASE_PATH, ...previousEnv } = env;
  const clientInit = spawnSync(process.execPath, [new URL("../src/cli.js", import.meta.url).pathname, "init"], { encoding: "utf8", env: { ...previousEnv, BURO_CONFIG: previousClient, BURO_ROOT: unopened } });
  assert.equal(clientInit.status, 1);
  assert.match(clientInit.stderr, /needs api_url/);
  assert.equal(existsSync(unopened), false);
});

test("connections preserve unrelated hooks and instructions and never inject System instructions", async t => {
  const { root } = await instance(t);
  const codex = path.join(root, "codex");
  await connectAgent("codex", { path: codex, home: root });
  const configFile = path.join(codex, "hooks.json");
  const settings = JSON.parse(await readFile(configFile, "utf8"));
  settings.hooks.SessionStart.unshift({ hooks: [{ type: "command", command: "unrelated" }] });
  await writeFile(configFile, JSON.stringify(settings));
  await writeFile(path.join(codex, "AGENTS.md"), "User instructions\n");
  await connectAgent("codex", { path: codex, home: root });
  await connectAgent("codex", { path: codex, home: root });
  assert.equal(JSON.parse(await readFile(configFile, "utf8")).hooks.SessionStart.length, 2);
  assert.equal(await readFile(path.join(codex, "AGENTS.md"), "utf8"), "User instructions\n");
  const opencode = path.join(root, "opencode");
  await connectAgent("opencode", { path: opencode, home: root });
  const plugin = await readFile(path.join(opencode, "plugins/buro.js"), "utf8");
  assert.ok(plugin.includes('["current"]'));
  assert.ok(!plugin.includes("buro agent"));
  const prompt = await readFile(new URL("../skills/buro/system-prompt.md", import.meta.url), "utf8");
  for (const profile of [codex, opencode]) assert.equal(await readFile(path.join(profile, "skills/buro/system-prompt.md"), "utf8"), prompt);
  await connectAgent("opencode", { path: opencode, home: root });
  const instructions = path.join(root, "manual-agent.md");
  await writeFile(instructions, "Existing instructions\n");
  await connectAgent("file", { path: instructions, home: root });
  await connectAgent("file", { path: instructions, home: root });
  const manual = await readFile(instructions, "utf8");
  assert.equal(manual.split("## BURO").length, 2);
  assert.ok(manual.startsWith("Existing instructions\n"));
});

test("v2 migration keeps raw record rows and custom definitions under the same IDs", async t => {
  const { config } = await instance(t);
  const db = openDatabase(config.databasePath);
  const model = { id: "custom-v2", version: 7, default_kind: "project", fields: { important: { type: "string-list", guide: "Existing guide.", draft_optional: true }, private_code: { type: "string" } }, field_sets: { common: ["important"] }, kinds: { project: { label: "My project", field_sets: ["common"], fields: ["private_code"] } } };
  db.prepare("UPDATE buro_meta SET value=? WHERE key='model'").run(JSON.stringify(model));
  db.prepare("UPDATE buro_meta SET value=? WHERE key='schema'").run(JSON.stringify({ storage_version: 2 }));
  db.prepare("INSERT INTO entities VALUES(?,?,?,?,?)").run("old", "Old", "project", JSON.stringify({ important: ["Keep it"], private_code: "code" }), "old-revision");
  const original = db.prepare("SELECT * FROM entities").all(); db.close();
  await initializeRegistry(config, { dryRun: true });
  await initializeRegistry(config);
  const after = openDatabase(config.databasePath);
  assert.deepEqual(after.prepare("SELECT * FROM entities").all(), original); after.close();
  const type = loadSchema(config).kinds.project;
  assert.equal(type.origin, "custom");
  assert.equal(type.definitions.important.guide, "Existing guide.");
  assert.ok(type.definitions.private_code);
});

test("scheduled groups survive mutation retention and do not duplicate due snapshots", async t => {
  const { config, change } = await instance(t);
  const concurrent = await Promise.all([scheduledBackup(config), scheduledBackup(config)]);
  assert.deepEqual(concurrent.map(files => files.length), [2, 0]);
  assert.equal((await scheduledBackup(config)).length, 0);
  const retained = { ...config, backupRetention: 2 };
  for (let i = 0; i < 4; i++) await backupDatabase(config.databasePath, retained);
  assert.equal((await readdir(path.join(config.backupDir, "mutation"))).length, 2);
  assert.equal((await readdir(path.join(config.backupDir, "daily"))).length, 1);
  assert.equal((await readdir(path.join(config.backupDir, "hourly"))).length, 1);
});

test("plugin coalesces concurrent requests once per session and surfaces failures", async t => {
  const { root } = await instance(t);
  const bin = path.join(root, "bin"), counter = path.join(root, "calls");
  await mkdir(bin);
  await writeFile(path.join(bin, "buro"), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(counter)},'1');console.log('source: buro current\\ndevice: fixture');\n`);
  await chmod(path.join(bin, "buro"), 0o700);
  const originalPath = process.env.PATH; process.env.PATH = `${bin}:${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; });
  const plugin = (await import("../integrations/opencode/plugin.js")).default;
  const hooks = await plugin();
  const outputs = Array.from({ length: 3 }, () => ({ system: [] }));
  await Promise.all(outputs.map(output => hooks["experimental.chat.system.transform"]({ sessionID: "one" }, output)));
  assert.equal(await readFile(counter, "utf8"), "1");
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "one" } } } });
  await hooks["experimental.chat.system.transform"]({ sessionID: "one" }, { system: [] });
  assert.equal(await readFile(counter, "utf8"), "11");
  await writeFile(path.join(bin, "buro"), `#!${process.execPath}\nconsole.error('fixture unavailable'); process.exit(1);\n`);
  const failed = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "failed" }, failed);
  assert.match(failed.system[0], /BURO unavailable: fixture unavailable/);
  const hook = () => JSON.parse(spawnSync(process.execPath, [new URL("../integrations/session-start.cjs", import.meta.url).pathname], { encoding: "utf8" }).stdout).hookSpecificOutput.additionalContext;
  assert.match(hook(), /BURO unavailable: fixture unavailable/);
  await writeFile(path.join(bin, "buro"), `#!${process.execPath}\nconsole.log('unexpected old output');\n`);
  assert.match(hook(), /BURO unavailable: current returned no device context/);
});

test("packets filter nested fields without changing stored values", () => {
  const schema = schemaFromTypes([{ id: "book", fields: {
    details: { type: "record", fields: { title: { type: "string" }, private_note: { type: "string", packet: false } } },
    editions: { type: "record-list", fields: { year: { type: "integer" }, internal: { type: "record", packet: false, fields: { code: { type: "string" } } } } },
  } }]);
  const entity = normalizeEntity({ id: "book", name: "Book", kind: "book", details: { title: "Public", private_note: "Hidden" }, editions: [{ year: 2026, internal: { code: "Hidden" } }] }, schema);
  const packet = entityPacket(entity, schema);
  assert.deepEqual(packet.sections[0].fields.map(field => field.value), [{ title: "Public" }, [{ year: 2026 }]]);
  assert.equal(entity.details.private_note, "Hidden");
  assert.equal(entity.editions[0].internal.code, "Hidden");
});

test("record lists reject empty entries instead of accepting unreadable data", () => {
  const schema = schemaFromTypes([{ id: "book", fields: { entries: { type: "record-list", fields: { title: { type: "string" } } } } }]);
  for (const entry of [null, undefined, ""]) assert.throws(() => normalizeEntity({ id: "book", name: "Book", kind: "book", entries: [entry] }, schema), /entries\[0\].*object/);
});

test("current ignores an aliases field with a custom format", async t => {
  const { config, root } = await instance(t);
  const manifest = { format: "buro-registry", version: 3, default_kind: "host", retired_ids: [],
    types: [{ id: "host", fields: { aliases: { type: "record-list", fields: { label: { type: "string" } } } } }],
    entities: [{ id: "desk", name: "Desk", kind: "host", aliases: [{ label: "Custom data" }] }] };
  const file = path.join(root, "custom.yaml"); await writeFile(file, dump(manifest));
  await importRegistry(file, config);
  assert.equal((await resolveCurrentContext(config)).context.id, "desk");
});

test("connect respects an explicit OpenCode profile environment", async t => {
  const { root } = await instance(t);
  const prior = process.env.OPENCODE_CONFIG_DIR;
  const profile = path.join(root, "selected-profile");
  process.env.OPENCODE_CONFIG_DIR = profile;
  t.after(() => { if (prior === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = prior; });
  await connectAgent("opencodez", { home: root });
  assert.ok(existsSync(path.join(profile, "plugins/buro.js")));
  assert.equal(existsSync(path.join(root, ".config/opencodez")), false);
});

test("concurrent initialization preserves the same usable memory and failed init can retry", async t => {
  const { config, root } = await instance(t);
  const fresh = { ...config, databasePath: path.join(root, "concurrent.sqlite3") };
  const initialized = await Promise.allSettled([initializeRegistry(fresh), initializeRegistry(fresh)]);
  assert.deepEqual(initialized.map(result => result.status), ["fulfilled", "fulfilled"]);
  assert.ok(loadSchema(fresh).generation);
  const blocked = path.join(root, "blocked-config"); await writeFile(blocked, "file");
  const retry = { ...config, databasePath: path.join(root, "retry.sqlite3"), configPath: path.join(blocked, "config.json") };
  await assert.rejects(initializeRegistry(retry));
  await initializeRegistry({ ...retry, configPath: config.configPath });
  assert.ok(loadSchema(retry).generation);
});

test("separate CLI processes serialize writes and reject a racing stale draft", async t => {
  const { config, root } = await instance(t);
  const { writeDraft } = await import("../src/draft.js");
  const files = [];
  t.after(async () => { for (const file of files) await rm(path.dirname(file), { recursive: true, force: true }); });
  const env = { ...process.env, BURO_CONFIG: config.configPath, BURO_ROOT: root, BURO_DATABASE_PATH: config.databasePath, BURO_BACKUP_DIR: config.backupDir, BURO_API_URL: "", BURO_CURRENT_CONTEXT: "desk" };
  const push = file => new Promise(resolve => execFile(process.execPath, [new URL("../src/cli.js", import.meta.url).pathname, "draft", "push", file], { env }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  const schema = loadSchema(config);
  for (let i = 0; i < 4; i++) files.push(await writeDraft({ id: `parallel-${i}`, name: "Parallel", kind: "project" }, draftMetadata(schema, "record", "create", `parallel-${i}`), schema));
  const created = await Promise.all(files.map(push));
  assert.ok(created.every(result => !result.error), JSON.stringify(created));
  const entity = await resolveEntity("parallel-0", config);
  const metadata = draftMetadata(schema, "record", "update", entity.id, entity.updated_at);
  for (const name of ["First", "Second"]) files.push(await writeDraft({ ...entity, name }, metadata, schema));
  const raced = await Promise.all(files.slice(-2).map(push));
  assert.equal(raced.filter(result => !result.error).length, 1);
  assert.match(raced.find(result => result.error).stderr, /record changed/);
  assert.equal((await readdir(path.join(config.backupDir, "mutation"))).length, 5);
});
