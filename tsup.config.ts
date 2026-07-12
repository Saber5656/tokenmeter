import { readFileSync } from "node:fs";

import { defineConfig } from "tsup";

const packageMetadata = readPackageMetadata();

export default defineConfig({
  clean: true,
  define: {
    __TOKENMETER_VERSION__: JSON.stringify(packageMetadata.version),
  },
  entry: {
    cli: "src/cli.ts",
  },
  format: ["esm"],
  minify: false,
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});

function readPackageMetadata(): { version: string } {
  const metadata = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };

  if (typeof metadata.version !== "string") {
    throw new TypeError("package.json version must be a string");
  }

  return { version: metadata.version };
}
