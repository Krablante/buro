// managed by BURO
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const marker = "## BURO Agent Contract";

export default async function buroPlugin() {
  // Cache instructions, never entity facts. A package update is picked up on restart.
  let instructions;
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (output.system.some((text) => text.includes(marker))) return;
      try {
        const command = process.platform === "win32" ? "cmd.exe" : "buro";
        const args = process.platform === "win32" ? ["/d", "/s", "/c", "buro agent"] : ["agent"];
        instructions ||= (await run(command, args, { timeout: 3000, maxBuffer: 32 * 1024 })).stdout.trim();
        if (instructions) output.system.push(instructions);
      } catch {
        // BURO being unavailable must not prevent an ordinary conversation.
      }
    },
  };
}
