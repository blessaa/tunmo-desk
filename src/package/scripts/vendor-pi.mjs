import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(process.argv[2] ?? resolve(projectRoot, "../pi-main"));
const destinationRoot = resolve(projectRoot, "vendor/pi-main");
const runtimePackages = ["coding-agent", "agent", "ai", "client", "protocol", "tui", "telemetry"];

const backendPackage = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const piCodingPackage = JSON.parse(
  await readFile(resolve(sourceRoot, "packages/coding-agent/package.json"), "utf8"),
);
const expectedVersion = backendPackage.dependencies?.["@earendil-works/pi-coding-agent"];

if (piCodingPackage.name !== "@earendil-works/pi-coding-agent") {
  throw new Error(`PI source directory is invalid: ${sourceRoot}`);
}
if (expectedVersion !== piCodingPackage.version) {
  throw new Error(
    `Pi version mismatch: dependency=${expectedVersion ?? "missing"}, source=${piCodingPackage.version}`,
  );
}

await rm(destinationRoot, { recursive: true, force: true });
await mkdir(destinationRoot, { recursive: true });

for (const file of ["LICENSE", "README.md", "package.json", "tsconfig.base.json"]) {
  await cp(resolve(sourceRoot, file), resolve(destinationRoot, file));
}

for (const packageName of runtimePackages) {
  const sourcePackage = resolve(sourceRoot, "packages", packageName);
  const destinationPackage = resolve(destinationRoot, "packages", packageName);
  await mkdir(destinationPackage, { recursive: true });
  await cp(resolve(sourcePackage, "src"), resolve(destinationPackage, "src"), { recursive: true });
  for (const file of ["package.json", "README.md", "tsconfig.build.json"]) {
    try {
      await cp(resolve(sourcePackage, file), resolve(destinationPackage, file));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
}

await writeFile(
  resolve(destinationRoot, "VENDORED.json"),
  `${JSON.stringify(
    {
      upstream: "https://github.com/earendil-works/pi",
      license: "MIT",
      codingAgentPackage: piCodingPackage.name,
      codingAgentVersion: piCodingPackage.version,
      runtimePackages,
    },
    null,
    2,
  )}\n`,
);

console.log(`Vendored Pi ${piCodingPackage.version} source from ${sourceRoot}`);
