const API_TIMEOUT_MS = 3000;

function endpoint(baseUrl, path) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

async function getJson(baseUrl, path) {
  return requestJson(baseUrl, path);
}

async function requestJson(baseUrl, path, { method = "GET", body } = {}) {
  const url = endpoint(baseUrl, path);
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
    throw new Error(`BURO API ${response.status}: ${payload?.error || response.statusText || "request failed"}`);
  }
  return payload;
}

function currentHostQuery(currentHost) {
  return currentHost === undefined || currentHost === null || currentHost === ""
    ? ""
    : `?current_host=${encodeURIComponent(currentHost)}`;
}

export function createApiClient(baseUrl) {
  return {
    schema: async () => (await getJson(baseUrl, "/schema")).schema,
    entities: async () => (await getJson(baseUrl, "/entities")).entities,
    entity: (id) => getJson(baseUrl, `/entities/${encodeURIComponent(id)}`),
    createEntity: (id, entity = {}) =>
      requestJson(baseUrl, `/entities/${encodeURIComponent(id)}`, { method: "POST", body: entity }),
    updateEntity: (id, entity) =>
      requestJson(baseUrl, `/entities/${encodeURIComponent(id)}`, { method: "PUT", body: entity }),
    deleteEntity: (id) => requestJson(baseUrl, `/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
    entityPacket: (id, currentHost) =>
      getJson(baseUrl, `/packet/entity/${encodeURIComponent(id)}${currentHostQuery(currentHost)}`),
  };
}
