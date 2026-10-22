import { normalizeSchema } from "./schema.js";

export function createApiClient(baseUrl, { timeoutMs = 5000, currentContext, currentLimit } = {}) {
  async function request(route, method = "GET", body) {
    const url = new URL(`${baseUrl}${route}`);
    if (currentContext) url.searchParams.set("current_context", currentContext);
    if (currentLimit) url.searchParams.set("current_limit", currentLimit);
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try { response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal }); }
    catch (cause) { throw new Error(`BURO API unavailable: ${baseUrl}; ${signal.aborted ? `timeout after ${timeoutMs} ms` : cause.cause?.code || cause.message}${method === "POST" ? ". A timed out write may have completed; read the record before retrying." : ""}`); }
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(signal.aborted ? `BURO API timeout after ${timeoutMs} ms; a write may have completed` : `BURO API returned invalid JSON (HTTP ${response.status}): ${baseUrl}`); }
    if (!response.ok) { const error = new Error(payload.error || `BURO API HTTP ${response.status}`); error.status = response.status; throw error; }
    return payload;
  }
  return {
    schema: async () => { const value = await request("/definitions"); return { ...normalizeSchema(value.schema), generation: value.generation }; },
    entity: (id, exact = false) => request(`/records/${encodeURIComponent(id)}${exact ? "?exact=1" : ""}`),
    packet: id => request(`/records/${encodeURIComponent(id)}?packet=1`),
    entitySummaries: (kind, page) => request(`/records?${new URLSearchParams({ ...(kind ? { kind } : {}), ...page })}`),
    current: () => request("/current"),
    change: (change, dryRun) => request(dryRun ? "/drafts/preview" : "/drafts/push", "POST", change),
  };
}
