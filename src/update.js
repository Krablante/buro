import { constants, createWriteStream, existsSync, realpathSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import semver from "semver";
import { loadConfig } from "./config.js";
import { initializeRegistry } from "./migration.js";
import { refreshConnections } from "./agent.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RELEASES = "https://api.github.com/repos/Krablante/buro/releases/latest";

export function installationPrefix(root, platform = process.platform) {
  if (path.basename(root) !== "buro" || path.basename(path.dirname(root)) !== "node_modules") throw new Error("buro update requires a global npm installation; a source checkout or linked package must be updated through its own development workflow");
  const parent = path.dirname(path.dirname(root));
  if (platform === "win32") return parent;
  if (path.basename(parent) !== "lib") throw new Error("cannot determine this installation's npm prefix; reinstall BURO globally with npm");
  return path.dirname(parent);
}

function npmCli() {
  const bin = path.dirname(process.execPath);
  const candidates = [path.join(bin, "node_modules/npm/bin/npm-cli.js"), path.resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js"), ...(process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, "npm"))];
  for (const candidate of candidates) {
    try { const file = realpathSync(candidate); if (path.basename(file) === "npm-cli.js") return file; } catch {}
  }
  throw new Error("npm was not found; install npm for the current Node.js before updating BURO");
}

function runCommand(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
    let output = "";
    if (capture) child.stdout.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 ? resolve(output.trim()) : reject(new Error(`${path.basename(command)} failed (${signal || code})`)));
  });
}

async function request(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`could not fetch ${url}: HTTP ${response.status}${response.status === 403 || response.status === 429 ? " (GitHub rate limit or access denied; retry later)" : ""}`);
  return response;
}

function packageManifest(bytes) {
  const archive = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    if (!name) break;
    const size = Number.parseInt(header.toString("ascii", 124, 136).replace(/\0/g, "").trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) break;
    if (name === "package/package.json") return JSON.parse(archive.toString("utf8", offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("release archive has no valid package/package.json");
}

export async function finishUpdate({ config = loadConfig(), home, log = console.log } = {}) {
  const failures = [];
  try {
    if (config.apiUrl) log("Shared memory: update its database device to adopt new bundled types.");
    else if (existsSync(config.databasePath)) {
      const result = await initializeRegistry(config);
      log(`Memory ready: ${result.count} records; custom types preserved.${result.backupPath ? ` Snapshot: ${result.backupPath}` : ""}`);
    } else log("No local memory to upgrade. Use buro init when ready.");
  } catch (error) { failures.push(`Memory upgrade failed: ${error.message}`); }
  try {
    const connections = await refreshConnections({ home });
    log(`Agent connections refreshed: ${connections.length}.`);
    if (connections.length) log("Restart connected agents to load the updated skill and session connection. System prompts remain manually configured.");
  } catch (error) { failures.push(error.message); }
  log("If buro serve is running on this device, restart it to load the installed version.");
  if (failures.length) throw new Error(`${failures.join("\n")}\nThe package is installed. Correct the issue and run buro update again.`);
}

export async function updateBuro({ check = false, packageRoot = ROOT, fetchImpl = fetch, run = runCommand, log = console.log } = {}) {
  const root = realpathSync(packageRoot);
  const current = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
  const prefix = check ? null : installationPrefix(root);
  const release = await (await request(fetchImpl, RELEASES)).json();
  const version = semver.valid(release.tag_name);
  if (!version || release.draft || release.prerelease || semver.prerelease(version)) throw new Error("GitHub did not return a stable BURO release");
  if (!semver.valid(current)) throw new Error(`invalid installed BURO version: ${current}`);
  log(`Installed: ${current}. Latest stable: ${version}.`);
  if (!semver.gt(version, current)) {
    log(semver.eq(version, current) ? "BURO is up to date." : "The installed version is newer; no downgrade.");
    if (!check) await run(process.execPath, [path.join(root, "src/update.js")]);
    return { current, latest: version, updated: false };
  }
  if (check) { log("Update available. Run buro update to install it."); return { current, latest: version, updated: false }; }
  const asset = release.assets?.find(item => item.name === `buro-${version}.tgz`);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "") || !asset.browser_download_url?.startsWith("https://github.com/Krablante/buro/releases/download/")) throw new Error("latest release is missing its BURO package or SHA-256 digest; retry after the release is complete");
  const npm = npmCli();
  const temporary = await mkdtemp(path.join(tmpdir(), "buro-update-"));
  try {
    const archive = path.join(temporary, asset.name), hash = createHash("sha256");
    log(`Downloading BURO ${version}…`);
    const response = await request(fetchImpl, asset.browser_download_url);
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } }), createWriteStream(archive, { mode: 0o600, flags: "wx" }));
    if (`sha256:${hash.digest("hex")}` !== asset.digest) throw new Error("release package SHA-256 mismatch; installation cancelled");
    const manifest = packageManifest(await readFile(archive));
    if (manifest.name !== "buro" || manifest.version !== version) throw new Error("release package name/version does not match its release");
    if (!manifest.engines?.node || !semver.satisfies(process.versions.node, manifest.engines.node)) throw new Error(`BURO ${version} requires Node.js ${manifest.engines?.node || "with a declared supported version"}; current: ${process.versions.node}. Update Node.js first.`);
    const args = [npm, "install", "--global", archive, "--prefix", prefix, "--engine-strict", "--no-audit", "--no-fund"];
    let elevated = false;
    try { await access(path.dirname(root), constants.W_OK); await access(process.platform === "win32" ? prefix : path.join(prefix, "bin"), constants.W_OK); }
    catch (error) { if (!["EACCES", "EPERM"].includes(error.code)) throw error; elevated = true; }
    log(`Installing BURO ${version}…`);
    if (elevated) {
      if (process.platform === "win32") throw new Error("this installation requires administrator rights; run buro update from an elevated terminal");
      log("System installation: sudo is used only to replace the npm package; memory and agent settings stay under your user.");
      await run("sudo", ["--", process.execPath, ...args]);
    } else await run(process.execPath, args);
    const installed = await run(process.execPath, [path.join(root, "src/cli.js"), "--version"], { capture: true });
    if (installed !== version) throw new Error(`installed version verification failed: expected ${version}, got ${installed}`);
    log(`BURO ${version} installed.`);
    await run(process.execPath, [path.join(root, "src/update.js")]);
    return { current, latest: version, updated: true };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

// Finish in a fresh process so migrations and connections use the newly installed code.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await finishUpdate(); } catch (error) { process.stderr.write(`BURO update: ${error.message}\n`); process.exitCode = 1; }
}
