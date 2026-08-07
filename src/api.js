import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { initDb, openDatabase } from "./db.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  resolveEntities,
  resolveEntity,
  resolveEntityPacket,
  resolveHealth,
  resolveSchema,
  updateEntityRecord,
} from "./resolver.js";
import { loadSchema } from "./schema.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

function sendJson(response, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  response.end(body);
}

function notFound(response, message = "route not found") {
  sendJson(response, 404, { ok: false, error: message });
}

function methodNotAllowed(response) {
  sendJson(response, 405, { ok: false, error: "method not allowed" });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requestRevision(request) {
  const value = request.headers["if-match"];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
      throw httpError("request body is too large", 413);
    }
  }
  if (body.trim() === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw httpError("request body must be a JSON object", 400);
    }
    return parsed;
  } catch (error) {
    if (error?.status) {
      throw error;
    }
    throw httpError(`invalid JSON body: ${error.message}`, 400);
  }
}

export function createApiServer(options = {}) {
  const config = { ...loadConfig(), ...options };
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const currentContext = url.searchParams.get("current_context") || config.currentContext;

    try {
      if (path === "/health") {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        sendJson(response, 200, await resolveHealth(config));
        return;
      }

      if (path === "/schema") {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        const { source: _source, hash: _hash, core_fields: _coreFields, ...schema } = await resolveSchema(config);
        sendJson(response, 200, { schema });
        return;
      }

      if (path === "/entities") {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        sendJson(response, 200, { entities: await resolveEntities(config) });
        return;
      }

      if (path.startsWith("/entities/")) {
        const entityId = decodeURIComponent(path.slice("/entities/".length));
        if (request.method === "POST") {
          const entity = await createEntityRecord(entityId, await readJsonBody(request), config);
          if (!entity) {
            sendJson(response, 409, { ok: false, error: `entity already exists: ${entityId}` });
            return;
          }
          sendJson(response, 201, entity);
          return;
        }
        if (request.method === "PUT") {
          const entity = await updateEntityRecord(entityId, await readJsonBody(request), {
            ...config,
            expectedUpdatedAt: requestRevision(request),
          });
          if (!entity) {
            notFound(response, `entity not found: ${entityId}`);
            return;
          }
          sendJson(response, 200, entity);
          return;
        }
        if (request.method === "DELETE") {
          const deleted = await deleteEntityRecord(entityId, { ...config, expectedUpdatedAt: requestRevision(request) });
          if (!deleted) {
            notFound(response, `entity not found: ${entityId}`);
            return;
          }
          response.writeHead(204);
          response.end();
          return;
        }
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        const entity = await resolveEntity(entityId, config);
        if (!entity) {
          notFound(response, `entity not found: ${entityId}`);
          return;
        }
        sendJson(response, 200, entity);
        return;
      }

      if (path.startsWith("/packet/entity/")) {
        if (request.method !== "GET") {
          methodNotAllowed(response);
          return;
        }
        const entityId = decodeURIComponent(path.slice("/packet/entity/".length));
        const packet = await resolveEntityPacket(entityId, { ...config, currentContext });
        if (!packet) {
          notFound(response, `entity not found: ${entityId}`);
          return;
        }
        sendJson(response, 200, packet);
        return;
      }

      notFound(response);
    } catch (error) {
      sendJson(response, error?.status || 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function serve(options = {}) {
  const config = loadConfig();
  const databasePath = options.databasePath || config.databasePath;
  const schema = options.schema || loadSchema(options.schemaPath || config.schemaPath);
  await initDb(databasePath, schema);
  const database = openDatabase(databasePath);
  const server = createApiServer({
    database,
    databasePath,
    schema,
    backupDir: config.backupDir,
    backupRetention: config.backupRetention,
  });
  const apiHost = options.apiHost || "127.0.0.1";
  const apiPort = Number.parseInt(options.apiPort || "8765", 10);
  server.on("close", () => {
    database.close();
  });
  server.listen(apiPort, apiHost, () => {
    console.error(`BURO API listening on http://${apiHost}:${apiPort}`);
  });
  return server;
}
