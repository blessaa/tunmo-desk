import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const tarballArgument = process.argv[2];
if (!tarballArgument) throw new Error("Usage: npm run smoke:package -- /absolute/path/to/package.tgz");

const tarball = resolve(tarballArgument);
const installRoot = await mkdtemp(join(tmpdir(), "tunmo-backend-package-smoke-"));

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate smoke-test port");
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  return address.port;
}

async function waitForHealth(port, child, diagnostics) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Installed backend exited early:\n${diagnostics.join("")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // The child may still be binding the socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Installed backend health check timed out:\n${diagnostics.join("")}`);
}

try {
  const install = spawnSync(
    "npm",
    ["install", "--prefix", installRoot, tarball, "--ignore-scripts", "--cache", "/tmp/tunmo-npm-cache"],
    { encoding: "utf8" },
  );
  if (install.status !== 0) throw new Error(`Tarball installation failed: ${install.stderr || install.stdout}`);

  const installedPackage = JSON.parse(
    await readFile(resolve(installRoot, "node_modules/tunmo-backend/package.json"), "utf8"),
  );
  const piEntry = resolve(
    installRoot,
    "node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js",
  );
  const piVersion = spawnSync(process.execPath, [piEntry, "--version"], { encoding: "utf8" });
  if (piVersion.status !== 0 || piVersion.stdout.trim() !== "0.84.1") {
    throw new Error(`Installed Pi RPC entry failed: ${piVersion.stderr || piVersion.stdout}`);
  }

  const port = await availablePort();
  const diagnostics = [];
  const backend = spawn(
    process.execPath,
    [resolve(installRoot, "node_modules/tunmo-backend/dist/main.js")],
    {
      cwd: installRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        LOG_LEVEL: "silent",
        PI_CWD_ROOT: installRoot,
        PI_DEFAULT_CWD: installRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  backend.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));

  try {
    const health = await waitForHealth(port, backend, diagnostics);
    if (health.status !== "ok" || health.service !== "tunmo-backend") {
      throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
    }
  } finally {
    backend.kill("SIGTERM");
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        backend.kill("SIGKILL");
        resolveExit();
      }, 2_000);
      backend.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  }

  console.log(`Installed and started ${installedPackage.name}@${installedPackage.version} with Pi ${piVersion.stdout.trim()}`);
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
