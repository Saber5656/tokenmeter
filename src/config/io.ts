import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  ConfigValidationError,
  createDefaultConfig,
  normalizeConfig,
  type TokenmeterConfig,
} from "./schema.js";

export type ConfigErrorCode =
  | "CONFIG_PARSE_FAILED"
  | "CONFIG_READ_FAILED"
  | "CONFIG_UNSAFE_PATH"
  | "CONFIG_VALIDATION_FAILED"
  | "CONFIG_WRITE_FAILED";

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly configPath: string;
  readonly jsonPath?: string;
  readonly osCode?: string;

  constructor(options: {
    code: ConfigErrorCode;
    configPath: string;
    message: string;
    jsonPath?: string;
    osCode?: string;
  }) {
    super(options.message);
    this.name = "ConfigError";
    this.code = options.code;
    this.configPath = options.configPath;
    if (options.jsonPath !== undefined) {
      this.jsonPath = options.jsonPath;
    }
    if (options.osCode !== undefined) {
      this.osCode = options.osCode;
    }
  }
}

export interface ConfigFileSystem {
  chmod(path: string, mode: number): Promise<void>;
  lstat(path: string): Promise<Stats>;
  mkdir(path: string, options: { mode: number; recursive: true }): Promise<string | undefined>;
  open(path: string, flags: number | string, mode?: number): Promise<FileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeConfigFileSystem: ConfigFileSystem = {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
};

export interface ConfigPathOptions {
  configPath?: string;
  homeDir?: string;
}

export interface ConfigIoOptions extends ConfigPathOptions {
  fileSystem?: ConfigFileSystem;
}

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  if (options.configPath !== undefined && options.homeDir !== undefined) {
    throw new TypeError("configPath and homeDir cannot be used together");
  }

  if (options.configPath !== undefined) {
    if (!isAbsolute(options.configPath)) {
      throw new TypeError("configPath must be absolute");
    }
    return options.configPath;
  }

  const homeDirectory = options.homeDir ?? homedir();
  if (!isAbsolute(homeDirectory)) {
    throw new TypeError("homeDir must be absolute");
  }

  return join(homeDirectory, ".tokenmeter", "config.json");
}

export async function loadConfig(options: ConfigIoOptions = {}): Promise<TokenmeterConfig> {
  const configPath = resolveConfigPath(options);
  const fileSystem = options.fileSystem ?? nodeConfigFileSystem;
  const directory = dirname(configPath);

  const directoryIdentity = await inspectDirectory(directory, configPath, fileSystem, "read");
  if (directoryIdentity === undefined) {
    return createDefaultConfig();
  }

  const targetIdentity = await inspectTarget(configPath, fileSystem, "read");
  if (targetIdentity === undefined) {
    return createDefaultConfig();
  }

  let handle: FileHandle | undefined;
  try {
    handle = await fileSystem.open(
      configPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const openedStat = await handle.stat();
    assertSafeTargetMetadata(openedStat, configPath);
    assertSameIdentity(
      targetIdentity,
      openedStat,
      configPath,
      "config file changed during read",
    );
    await assertDirectoryIdentity(
      directory,
      directoryIdentity,
      configPath,
      fileSystem,
      "read",
    );

    const raw = await handle.readFile({ encoding: "utf8" });
    const parsed = parseConfig(raw, configPath);
    return validateConfig(parsed, configPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      throw unsafePath(configPath, "config file changed during read");
    }
    if (hasErrorCode(error, "ELOOP")) {
      throw unsafePath(configPath, "config path must not be a symbolic link");
    }
    throw ioError("CONFIG_READ_FAILED", configPath, "Unable to read tokenmeter config", error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeConfig(
  input: unknown,
  options: ConfigIoOptions = {},
): Promise<TokenmeterConfig> {
  const configPath = resolveConfigPath(options);
  const normalized = validateConfig(input, configPath);
  const fileSystem = options.fileSystem ?? nodeConfigFileSystem;
  const directory = dirname(configPath);
  const tempPath = join(directory, `.config.json.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  let handle: FileHandle | undefined;
  let tempCreated = false;
  try {
    const directoryIdentity = await ensureSecureDirectory(
      directory,
      configPath,
      fileSystem,
      options.configPath === undefined,
    );
    const targetIdentity = await inspectTarget(configPath, fileSystem, "write");

    handle = await fileSystem.open(tempPath, "wx", 0o600);
    tempCreated = true;
    await handle.chmod(0o600);
    await handle.writeFile(serialized, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;

    await assertDirectoryIdentity(
      directory,
      directoryIdentity,
      configPath,
      fileSystem,
      "write",
    );
    await assertTargetIdentity(configPath, targetIdentity, fileSystem);
    await fileSystem.rename(tempPath, configPath);
    tempCreated = false;
    return normalized;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw ioError("CONFIG_WRITE_FAILED", configPath, "Unable to write tokenmeter config", error);
  } finally {
    await handle?.close().catch(() => undefined);
    if (tempCreated) {
      await fileSystem.unlink(tempPath).catch(() => undefined);
    }
  }
}

function parseConfig(raw: string, configPath: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ConfigError({
      code: "CONFIG_PARSE_FAILED",
      configPath,
      message: `Unable to parse tokenmeter config at ${configPath}: expected valid JSON`,
    });
  }
}

function validateConfig(input: unknown, configPath: string): TokenmeterConfig {
  try {
    return normalizeConfig(input);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new ConfigError({
        code: "CONFIG_VALIDATION_FAILED",
        configPath,
        jsonPath: error.jsonPath,
        message: `Invalid tokenmeter config at ${configPath} (${error.jsonPath}): ${error.reason}`,
      });
    }
    throw error;
  }
}

async function inspectDirectory(
  directory: string,
  configPath: string,
  fileSystem: ConfigFileSystem,
  operation: "read" | "write",
): Promise<Stats | undefined> {
  try {
    const stat = await fileSystem.lstat(directory);
    assertSafeDirectoryMetadata(stat, configPath);
    return stat;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw ioError(
      operation === "read" ? "CONFIG_READ_FAILED" : "CONFIG_WRITE_FAILED",
      configPath,
      `Unable to inspect tokenmeter config directory for ${operation}`,
      error,
    );
  }
}

async function inspectTarget(
  configPath: string,
  fileSystem: ConfigFileSystem,
  operation: "read" | "write",
): Promise<Stats | undefined> {
  try {
    const stat = await fileSystem.lstat(configPath);
    assertSafeTargetMetadata(stat, configPath);
    return stat;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw ioError(
      operation === "read" ? "CONFIG_READ_FAILED" : "CONFIG_WRITE_FAILED",
      configPath,
      `Unable to inspect tokenmeter config for ${operation}`,
      error,
    );
  }
}

async function ensureSecureDirectory(
  directory: string,
  configPath: string,
  fileSystem: ConfigFileSystem,
  manageExistingDirectoryPermissions: boolean,
): Promise<Stats> {
  let directoryIdentity = await inspectDirectory(directory, configPath, fileSystem, "write");
  if (directoryIdentity === undefined) {
    try {
      await fileSystem.mkdir(directory, { mode: 0o700, recursive: true });
    } catch (error) {
      throw ioError(
        "CONFIG_WRITE_FAILED",
        configPath,
        "Unable to create tokenmeter config directory",
        error,
      );
    }
    directoryIdentity = await inspectDirectory(directory, configPath, fileSystem, "write");
    if (directoryIdentity === undefined) {
      throw unsafePath(configPath, "config directory disappeared after creation");
    }
  }

  if (manageExistingDirectoryPermissions) {
    try {
      await fileSystem.chmod(directory, 0o700);
    } catch (error) {
      throw ioError(
        "CONFIG_WRITE_FAILED",
        configPath,
        "Unable to secure tokenmeter config directory",
        error,
      );
    }
    const securedIdentity = await inspectDirectory(directory, configPath, fileSystem, "write");
    if (securedIdentity === undefined) {
      throw unsafePath(configPath, "config directory disappeared after permission update");
    }
    directoryIdentity = securedIdentity;
  }

  return directoryIdentity;
}

async function assertDirectoryIdentity(
  directory: string,
  expected: Stats,
  configPath: string,
  fileSystem: ConfigFileSystem,
  operation: "read" | "write",
): Promise<void> {
  const current = await inspectDirectory(directory, configPath, fileSystem, operation);
  if (current === undefined || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw unsafePath(configPath, `config directory changed during ${operation}`);
  }
}

async function assertTargetIdentity(
  configPath: string,
  expected: Stats | undefined,
  fileSystem: ConfigFileSystem,
): Promise<void> {
  const current = await inspectTarget(configPath, fileSystem, "write");
  if (expected === undefined && current === undefined) {
    return;
  }
  if (expected === undefined || current === undefined) {
    throw unsafePath(configPath, "config file changed during write");
  }
  assertSameIdentity(expected, current, configPath, "config file changed during write");
}

function assertSafeDirectoryMetadata(stat: Stats, configPath: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafePath(configPath, "config directory must be a real directory");
  }
  assertCurrentUserOwnership(stat, configPath, "config directory");
  assertNotSharedWritable(stat, configPath, "config directory");
}

function assertSafeTargetMetadata(stat: Stats, configPath: string): void {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw unsafePath(configPath, "config path must be a regular file, not a symbolic link");
  }
  assertCurrentUserOwnership(stat, configPath, "config file");
  assertNotSharedWritable(stat, configPath, "config file");
}

function assertCurrentUserOwnership(
  stat: Stats,
  configPath: string,
  subject: "config directory" | "config file",
): void {
  if (typeof process.getuid !== "function") {
    throw unsafePath(configPath, "current user identity is unavailable on this platform");
  }
  if (stat.uid !== process.getuid()) {
    throw unsafePath(configPath, `${subject} must be owned by the current user`);
  }
}

function assertNotSharedWritable(
  stat: Stats,
  configPath: string,
  subject: "config directory" | "config file",
): void {
  if ((stat.mode & (constants.S_IWGRP | constants.S_IWOTH)) !== 0) {
    throw unsafePath(configPath, `${subject} must not be writable by group or others`);
  }
}

function assertSameIdentity(
  expected: Stats,
  current: Stats,
  configPath: string,
  reason: string,
): void {
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw unsafePath(configPath, reason);
  }
}

function unsafePath(configPath: string, reason: string): ConfigError {
  return new ConfigError({
    code: "CONFIG_UNSAFE_PATH",
    configPath,
    message: `Unsafe tokenmeter config path at ${configPath}: ${reason}`,
  });
}

function ioError(
  code: ConfigErrorCode,
  configPath: string,
  message: string,
  error?: unknown,
): ConfigError {
  const osCode = getErrorCode(error);
  const diagnostic = osCode === undefined ? "" : ` [${osCode}]`;
  return new ConfigError({
    code,
    configPath,
    message: `${message}${diagnostic} at ${configPath}`,
    ...(osCode === undefined ? {} : { osCode }),
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

function getErrorCode(error: unknown): string | undefined {
  const value =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  return value;
}
