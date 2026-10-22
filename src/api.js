import { createServer } from "node:http";
import { loadConfig, hasDirectStorage } from "./config.js";
import { openDatabase, assertSchemaBinding } from "./db.js";
import { applyChange, resolveCurrentContext, resolveEntity, resolveEntityPacket, resolveEntitySummaries, resolveHealth, resolveSchema } from "./resolver.js";
import { loadSchema } from "./schema.js";

function send(response, status, value) { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(`${JSON.stringify(value)}\n`); }
async function json(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw Object.assign(new Error("request exceeds 1 MiB"), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}
export function createApiServer(options = {}) {
  const config = { ...loadConfig(), ...options };
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const route = url.pathname;
      const currentLimit = Number(url.searchParams.get("current_limit") || config.currentLimit);
      if (!Number.isInteger(currentLimit) || currentLimit < 1 || currentLimit > 10000) throw new Error("current_limit must be 1..10000");
      const context = { ...config,
        backupSettings: { current_context: config.currentContext, current_limit: config.currentLimit },
        currentContext: url.searchParams.get("current_context") || config.currentContext, currentLimit };
      if (request.method === "GET") {
        if (route === "/health") { const value = await resolveHealth(config); return send(response, value.ok ? 200 : 503, value); }
        if (route === "/definitions") { const { generation, ...schema } = await resolveSchema(config); return send(response, 200, { schema, generation }); }
        if (route === "/current") return send(response, 200, await resolveCurrentContext(context));
        if (route === "/records") {
          const limit = Number(url.searchParams.get("limit") ?? 100), offset = Number(url.searchParams.get("offset") ?? 0);
          if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error("limit must be 1..1000; offset must be nonnegative");
          return send(response, 200, await resolveEntitySummaries(url.searchParams.get("kind"), { ...context, limit, offset, query: url.searchParams.get("query"), full: url.searchParams.get("full") === "1" }));
        }
        if (route.startsWith("/records/")) {
          const id = decodeURIComponent(route.slice(9));
          const value = url.searchParams.has("packet") ? await resolveEntityPacket(id, context) : await resolveEntity(id, { ...context, exact: url.searchParams.has("exact") });
          return send(response, value ? 200 : 404, value || { error: `record not found: ${id}` });
        }
      }
      if (request.method === "POST" && ["/drafts/preview", "/drafts/push"].includes(route)) return send(response, 200, await applyChange(await json(request), { ...context, dryRun: route === "/drafts/preview" }));
      send(response, 404, { error: "route not found" });
    } catch (error) { send(response, error.status || 400, { error: error.message }); }
  });
}
export async function serve(options = {}) {
  const config = { ...loadConfig(), ...options };
  if (!hasDirectStorage(config)) throw new Error("serve requires local storage; remove api_url on the registry device");
  const port = Number(options.apiPort ?? 8765);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be 1..65535");
  const database = openDatabase(config.databasePath, { mustExist: true });
  try { assertSchemaBinding(database, loadSchema({ ...config, database }), { checkStorage: true }); }
  catch (error) { database.close(); throw error; }
  const server = createApiServer({ ...config, database });
  server.on("close", () => database.close());
  try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, options.apiHost || "127.0.0.1", resolve); }); }
  catch (error) { database.close(); throw error; }
  console.error(`BURO API listening on http://${options.apiHost || "127.0.0.1"}:${port}`);
  return server;
}
