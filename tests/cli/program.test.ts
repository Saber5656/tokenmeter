import { describe, expect, it } from "vitest";

import packageMetadata from "../../package.json" with { type: "json" };
import { CLI_VERSION, createProgram } from "../../src/cli/program.js";

describe("tokenmeter CLI scaffold", () => {
  it("exposes the expected command identity without loading config", () => {
    const program = createProgram();

    expect(program.name()).toBe("tokenmeter");
    expect(program.description()).toContain("Local-first");
    expect(program.options.some((option) => option.long === "--version")).toBe(true);
    expect(program.helpInformation()).toContain("-h, --help");
  });

  it("keeps the CLI version synchronized with package metadata", () => {
    expect(CLI_VERSION).toBe(packageMetadata.version);
  });
});
