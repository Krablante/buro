const API_TIMEOUT_MS = 3000;

function endpoint(baseUrl, path) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

async function getJson(baseUrl, path) {
  return requestJson(baseUrl, path);
}

async function requestJson(baseUrl, path, { method = "GET", body, revision } = {}) {
  const url = endpoint(baseUrl, path);
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision ? { "If-Match": `"${revision}"` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`BURO API timeout after 3 seconds: ${url}`);
    }
    const code = error?.cause?.code ? ` (${error.cause.code})` : "";
    throw new Error(`BURO API unavailable: ${url}${code}`);
  }
  if (response.status === 204) {
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) {
      throw new Error(`BURO API timeout after 3 seconds: ${url}`);
    }
    throw new Error(`BURO API returned invalid JSON (HTTP ${response.status}): ${url}`);
  }
  if (!response.ok) {
    const error = new Error(`BURO API ${response.status}: ${payload?.error || response.statusText || "request failed"}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function currentContextQuery(currentContext) {
  return currentContext === undefined || currentContext === null || currentContext === ""
    ? ""
    : `?current_context=${encodeURIComponent(currentContext)}`;
}

export function createApiClient(baseUrl) {
  return {
    schema: async () => (await getJson(baseUrl, "/schema")).schema,
    entities: async () => (await getJson(baseUrl, "/entities")).entities,
    entitySummaries: (kind, currentContext, options = {}) => getJson(baseUrl,
      `/entities?summary=1${kind ? `&kind=${encodeURIComponent(kind)}` : ""}${currentContext ? `&current_context=${encodeURIComponent(currentContext)}` : ""}&limit=${options.limit ?? 100}&offset=${options.offset ?? 0}${options.query ? `&q=${encodeURIComponent(options.query)}` : ""}`),
    current: (currentContext, brief = false) => {
      const query = new URLSearchParams();
      if (currentContext) query.set("current_context", currentContext);
      if (brief) query.set("brief", "1");
      return getJson(baseUrl, `/current${query.size ? `?${query}` : ""}`);
    },
    entity: (id) => getJson(baseUrl, `/entities/${encodeURIComponent(id)}`),
    createEntity: (id, entity = {}, currentContext) =>
      requestJson(baseUrl, `/entities/${encodeURIComponent(id)}${currentContextQuery(currentContext)}`, { method: "POST", body: entity }),
    updateEntity: (id, entity, revision, currentContext) =>
      requestJson(baseUrl, `/entities/${encodeURIComponent(id)}${currentContextQuery(currentContext)}`, { method: "PUT", body: entity, revision }),
    deleteEntity: (id, revision) => requestJson(baseUrl, `/entities/${encodeURIComponent(id)}`, { method: "DELETE", revision }),
    entityPacket: (id, currentContext) =>
      getJson(baseUrl, `/packet/entity/${encodeURIComponent(id)}${currentContextQuery(currentContext)}`),
  };
}
