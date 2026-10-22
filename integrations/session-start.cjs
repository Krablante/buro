// managed by BURO
const { execFile } = require("node:child_process");
const command = process.platform === "win32" ? "cmd.exe" : "buro";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "buro current"] : ["current"];
execFile(command, args, { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
  const context = error ? `BURO unavailable: ${(stderr || error.message).trim()}. Memory has not been loaded; the conversation can continue.` : stdout.trim();
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }) + "\n");
});
