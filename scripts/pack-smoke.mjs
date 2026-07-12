import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "tokenmeter-pack-smoke-"));
const packageDirectory = join(workspace, "package");
const isolatedHome = join(workspace, "isolated-home");
const npmUserConfig = join(isolatedHome, ".npmrc");
const npmGlobalConfig = join(isolatedHome, "global.npmrc");
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
if (packageMetadata.name !== "@saber5656/tokenmeter") {
  throw new Error("package.json must use the approved @saber5656/tokenmeter identity");
}
if (typeof packageMetadata.version !== "string") {
  throw new Error("package.json version must be a string");
}
const npmEnvironment = { ...process.env };
for (const key of Object.keys(npmEnvironment)) {
  if (/^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG_.*)$/i.test(key)) {
    delete npmEnvironment[key];
  }
}
Object.assign(npmEnvironment, {
  HOME: isolatedHome,
  NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
  NPM_CONFIG_USERCONFIG: npmUserConfig,
  USERPROFILE: isolatedHome,
  npm_config_cache: join(workspace, "npm-cache"),
  npm_config_globalconfig: npmGlobalConfig,
  npm_config_registry: "https://registry.npmjs.org/",
  npm_config_userconfig: npmUserConfig,
});

try {
  await mkdir(isolatedHome, { mode: 0o700, recursive: true });
  await writeFile(npmUserConfig, "", { mode: 0o600 });
  await writeFile(npmGlobalConfig, "", { mode: 0o600 });
  const fakeConfigDirectory = join(isolatedHome, ".tokenmeter");
  await mkdir(fakeConfigDirectory, { mode: 0o700, recursive: true });
  await writeFile(join(fakeConfigDirectory, "config.json"), "{malformed", { mode: 0o600 });

  execFileSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    env: npmEnvironment,
    stdio: "inherit",
  });
  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace],
    {
      encoding: "utf8",
      env: npmEnvironment,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const packResults = JSON.parse(packOutput);
  if (!Array.isArray(packResults) || packResults.length !== 1) {
    throw new Error("npm pack must produce exactly one tarball");
  }
  const [packResult] = packResults;
  const { filename, files } = packResult ?? {};
  if (typeof filename !== "string" || !Array.isArray(files)) {
    throw new Error("npm pack did not return a tarball filename");
  }

  const packedFiles = files.map(({ path }) => path).sort();
  const expectedFiles = ["README.md", "dist/cli.js", "package.json"];
  const unexpectedFiles = packedFiles.filter((path) => !expectedFiles.includes(path));
  const missingFiles = expectedFiles.filter((path) => !packedFiles.includes(path));
  if (unexpectedFiles.length > 0) {
    throw new Error(`npm pack included unexpected files: ${unexpectedFiles.join(", ")}`);
  }
  if (missingFiles.length > 0) {
    throw new Error(`npm pack omitted required files: ${missingFiles.join(", ")}`);
  }

  await mkdir(packageDirectory);
  execFileSync("npm", ["init", "--yes"], {
    cwd: packageDirectory,
    env: npmEnvironment,
    stdio: "ignore",
  });
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(workspace, filename)],
    { cwd: packageDirectory, env: npmEnvironment, stdio: "inherit" },
  );

  const smokeEnvironment = {
    ...npmEnvironment,
  };

  const binary = join(packageDirectory, "node_modules", ".bin", "tokenmeter");
  const help = execFileSync(binary, ["--help"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: smokeEnvironment,
  });
  if (!help.includes("Usage: tokenmeter")) {
    throw new Error("packed tokenmeter binary did not render the expected help output");
  }
  const version = execFileSync(binary, ["--version"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: smokeEnvironment,
  }).trim();
  if (version !== packageMetadata.version) {
    throw new Error(`packed tokenmeter version mismatch: expected ${packageMetadata.version}`);
  }

  const offlineNpxEnvironment = {
    ...smokeEnvironment,
    npm_config_cache: join(packageDirectory, "fresh-npm-cache"),
    npm_config_offline: "true",
    npm_config_yes: "false",
  };
  const packageSpecHelp = execFileSync(
    "npx",
    ["--no-install", packageMetadata.name, "--help"],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: offlineNpxEnvironment,
    },
  );
  if (!packageSpecHelp.includes("Usage: tokenmeter")) {
    throw new Error("offline npx did not resolve the installed scoped package spec");
  }
  const packageSpecVersion = execFileSync(
    "npx",
    ["--no-install", packageMetadata.name, "--version"],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: offlineNpxEnvironment,
    },
  ).trim();
  if (packageSpecVersion !== packageMetadata.version) {
    throw new Error("offline npx scoped package version does not match package.json");
  }

  process.stdout.write("Packed tokenmeter CLI smoke test passed.\n");
} finally {
  await rm(workspace, { force: true, recursive: true });
}
