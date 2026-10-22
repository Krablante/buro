// managed by BURO
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const marker = "source: buro current";

export default async function buroPlugin() {
  const sessions = new Map();
  async function current() {
    try {
      const command = process.platform === "win32" ? "cmd.exe" : "buro";
      const args = process.platform === "win32" ? ["/d", "/s", "/c", "buro current"] : ["current"];
      const { stdout } = await run(command, args, { timeout: 8000, maxBuffer: 1024 * 1024 });
      if (!stdout.includes(marker)) throw new Error("current returned no device context");
      return stdout.trim();
    } catch (error) { return `## BURO Current Context\n\n${marker}\nBURO unavailable: ${(error.stderr || error.message).trim()}. Start the conversation; memory has not been loaded.`; }
  }
  return {
    event: async ({ event }) => { if (event.type === "session.deleted") sessions.delete(event.properties.info.id); },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID || output.system.some(text => text.includes(marker))) return;
      if (!sessions.has(input.sessionID)) sessions.set(input.sessionID, current());
      output.system.push(await sessions.get(input.sessionID));
    },
  };
}
