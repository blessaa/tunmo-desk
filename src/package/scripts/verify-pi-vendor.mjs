import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendPackage = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const vendorMetadata = JSON.parse(
  await readFile(resolve(projectRoot, "vendor/pi-main/VENDORED.json"), "utf8"),
);
const dependencyVersion = backendPackage.dependencies?.["@earendil-works/pi-coding-agent"];

if (dependencyVersion !== vendorMetadata.codingAgentVersion) {
  throw new Error(
    `Pi vendor version mismatch: dependency=${dependencyVersion ?? "missing"}, source=${vendorMetadata.codingAgentVersion}`,
  );
}

for (const packageName of vendorMetadata.runtimePackages) {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "vendor/pi-main/packages", packageName, "package.json"), "utf8"),
  );
  if (packageJson.version !== dependencyVersion) {
    throw new Error(`${packageJson.name} source version ${packageJson.version} does not match ${dependencyVersion}`);
  }
}

const rpcEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
const smoke = spawnSync(process.execPath, [rpcEntry, "--version"], { encoding: "utf8" });
if (smoke.status !== 0 || smoke.stdout.trim() !== dependencyVersion) {
  throw new Error(`Packaged Pi RPC entry smoke test failed: ${smoke.stderr || smoke.stdout}`);
}

console.log(`Verified vendored Pi source and packaged RPC entry ${dependencyVersion}`);
