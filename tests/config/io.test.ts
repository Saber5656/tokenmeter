import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadConfig,
  nodeConfigFileSystem,
  resolveConfigPath,
  writeConfig,
  type ConfigFileSystem,
} from "../../src/config/io.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("config I/O", () => {
  it("resolves the default path from an injected home directory", () => {
    expect(resolveConfigPath({ homeDir: "/tmp/example-home" })).toBe(
      "/tmp/example-home/.tokenmeter/config.json",
    );
  });

  it("requires an injected config path to be absolute", () => {
    expect(() => resolveConfigPath({ configPath: "relative/config.json" })).toThrow(TypeError);
    expect(() => resolveConfigPath({ homeDir: "relative-home" })).toThrow(TypeError);
    expect(() =>
      resolveConfigPath({ configPath: "/tmp/config.json", homeDir: "/tmp/home" }),
    ).toThrow(TypeError);
  });

  it("returns defaults for a missing file without creating the directory", async () => {
    const homeDir = await createTemporaryDirectory();
    const configDirectory = join(homeDir, ".tokenmeter");

    await expect(loadConfig({ homeDir })).resolves.toEqual({
      budgets: {},
      warnAt: 0.8,
      currency: "USD",
    });
    await expect(lstat(configDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads and normalizes a partial config", async () => {
    const configPath = await createConfigFile('{"budgets":{"daily":7}}');

    await expect(loadConfig({ configPath })).resolves.toEqual({
      budgets: { daily: 7 },
      warnAt: 0.8,
      currency: "USD",
    });
  });

  it.each(["", "{", '{"warnAt":0.8,}'])(
    "redacts malformed config contents",
    async (raw) => {
      const configPath = await createConfigFile(raw);

      await expect(loadConfig({ configPath })).rejects.toMatchObject({
        code: "CONFIG_PARSE_FAILED",
      });
      try {
        await loadConfig({ configPath });
      } catch (error) {
        if (raw.length > 0) {
          expect(String(error)).not.toContain(raw);
        }
      }
    },
  );

  it("reports validation paths without exposing values", async () => {
    const secretValue = "not-a-valid-secret-value";
    const configPath = await createConfigFile(JSON.stringify({ currency: secretValue }));

    try {
      await loadConfig({ configPath });
      throw new Error("expected loadConfig to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONFIG_VALIDATION_FAILED",
        jsonPath: "$.currency",
      });
      expect(String(error)).toContain('must be exactly "USD"');
      expect(String(error)).not.toContain(secretValue);
    }
  });

  it("writes canonical JSON with restrictive permissions and round-trips", async () => {
    const homeDir = await createTemporaryDirectory();
    const configPath = resolveConfigPath({ homeDir });

    await expect(writeConfig({ budgets: { weekly: 42 } }, { configPath })).resolves.toEqual({
      budgets: { weekly: 42 },
      warnAt: 0.8,
      currency: "USD",
    });

    expect(await readFile(configPath, "utf8")).toBe(
      '{\n  "budgets": {\n    "weekly": 42\n  },\n  "warnAt": 0.8,\n  "currency": "USD"\n}\n',
    );
    expect((await lstat(dirname(configPath))).mode & 0o777).toBe(0o700);
    expect((await lstat(configPath)).mode & 0o777).toBe(0o600);
    await expect(loadConfig({ configPath })).resolves.toMatchObject({
      budgets: { weekly: 42 },
    });
  });

  it("replaces a permissive target with a mode-0600 file", async () => {
    const configPath = await createConfigFile("{}");
    await chmod(configPath, 0o644);

    await writeConfig({ warnAt: 0.5 }, { configPath });

    expect((await lstat(configPath)).mode & 0o777).toBe(0o600);
  });

  it("does not chmod the parent of an explicit configPath override", async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, "config.json");
    await chmod(directory, 0o755);

    await writeConfig({}, { configPath });

    expect((await lstat(directory)).mode & 0o777).toBe(0o755);
    expect((await lstat(configPath)).mode & 0o777).toBe(0o600);
  });

  it("secures an existing default config directory", async () => {
    const homeDir = await createTemporaryDirectory();
    const configDirectory = join(homeDir, ".tokenmeter");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(configDirectory, { mode: 0o755 });

    await writeConfig({}, { homeDir });

    expect((await lstat(configDirectory)).mode & 0o777).toBe(0o700);
  });

  it("validates before creating files", async () => {
    const homeDir = await createTemporaryDirectory();
    const configPath = resolveConfigPath({ homeDir });

    await expect(writeConfig({ warnAt: 0 }, { configPath })).rejects.toMatchObject({
      code: "CONFIG_VALIDATION_FAILED",
    });
    await expect(lstat(dirname(configPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the old target and cleans the temp file when rename fails", async () => {
    const configPath = await createConfigFile('{"warnAt":0.5}');
    const failingFileSystem: ConfigFileSystem = {
      ...nodeConfigFileSystem,
      rename: async () => {
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      },
    };

    await expect(
      writeConfig({ warnAt: 0.9 }, { configPath, fileSystem: failingFileSystem }),
    ).rejects.toMatchObject({ code: "CONFIG_WRITE_FAILED" });
    expect(await readFile(configPath, "utf8")).toBe('{"warnAt":0.5}');
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(dirname(configPath))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("produces one complete config under concurrent writes", async () => {
    const homeDir = await createTemporaryDirectory();
    const configPath = resolveConfigPath({ homeDir });

    await Promise.all([
      writeConfig({ budgets: { daily: 1 } }, { configPath }),
      writeConfig({ budgets: { daily: 2 } }, { configPath }),
    ]);

    const config = await loadConfig({ configPath });
    expect([1, 2]).toContain(config.budgets.daily);
  });

  it("rejects config file symlinks", async () => {
    const configPath = await createConfigFile("{}");
    const targetPath = `${configPath}.target`;
    await writeFile(targetPath, "{}", { mode: 0o600 });
    const { unlink } = await import("node:fs/promises");
    await unlink(configPath);
    await symlink(targetPath, configPath);

    await expect(loadConfig({ configPath })).rejects.toMatchObject({
      code: "CONFIG_UNSAFE_PATH",
    });
    await expect(writeConfig({}, { configPath })).rejects.toMatchObject({
      code: "CONFIG_UNSAFE_PATH",
    });
  });

  it("rejects config directory symlinks", async () => {
    const homeDir = await createTemporaryDirectory();
    const realDirectory = await createTemporaryDirectory();
    const linkedDirectory = join(homeDir, ".tokenmeter");
    await symlink(realDirectory, linkedDirectory);
    const configPath = join(linkedDirectory, "config.json");

    await expect(loadConfig({ configPath })).rejects.toMatchObject({
      code: "CONFIG_UNSAFE_PATH",
    });
    await expect(writeConfig({}, { configPath })).rejects.toMatchObject({
      code: "CONFIG_UNSAFE_PATH",
    });
  });

  it("does not silently replace non-ENOENT read failures with defaults", async () => {
    const configPath = await createConfigFile("{}");
    const failingFileSystem: ConfigFileSystem = {
      ...nodeConfigFileSystem,
      open: async () => {
        throw Object.assign(new Error("injected permission failure"), { code: "EACCES" });
      },
    };

    await expect(loadConfig({ configPath, fileSystem: failingFileSystem })).rejects.toMatchObject({
      code: "CONFIG_READ_FAILED",
      osCode: "EACCES",
    });
  });

  it("rejects a config directory identity change during read", async () => {
    const configPath = await createConfigFile("{}");
    const configDirectory = dirname(configPath);
    let directoryChecks = 0;
    const unstableFileSystem: ConfigFileSystem = {
      ...nodeConfigFileSystem,
      lstat: async (path) => {
        const stat = await nodeConfigFileSystem.lstat(path);
        if (path !== configDirectory || ++directoryChecks === 1) {
          return stat;
        }

        return new Proxy(stat, {
          get(target, property) {
            if (property === "ino") {
              return target.ino + 1;
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };

    await expect(loadConfig({ configPath, fileSystem: unstableFileSystem })).rejects.toMatchObject({
      code: "CONFIG_UNSAFE_PATH",
    });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "tokenmeter-config-test-"));
  temporaryDirectories.push(path);
  return path;
}

async function createConfigFile(contents: string): Promise<string> {
  const directory = await createTemporaryDirectory();
  const configPath = join(directory, "config.json");
  await writeFile(configPath, contents, { mode: constants.S_IRUSR | constants.S_IWUSR });
  return configPath;
}
