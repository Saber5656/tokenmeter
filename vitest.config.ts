import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";

const packageMetadata = readPackageMetadata();

export default defineConfig({
  define: {
    __TOKENMETER_VERSION__: JSON.stringify(packageMetadata.version),
  },
  test: {
    coverage: {
      enabled: false,
    },
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
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
