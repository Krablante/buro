import { pathToFileURL } from "node:url";

import { serve } from "./api.js";

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  await serve({ apiHost: "127.0.0.1" });
}

export { createApiServer, serve } from "./api.js";
