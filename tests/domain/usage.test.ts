import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EventIdentity,
  ScannedUsageEvent,
  UsageEvent,
} from "../../src/domain/index.js";

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type DocumentedUsageEvent = {
  ts: string;
  agent: string;
  model: string | null;
  sessionId: string;
  project?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
};

type DocumentedEventIdentity = {
  sourceGeneration: string;
  recordOrdinal: number;
  subIndex: number;
};

type DocumentedScannedUsageEvent = {
  identity: EventIdentity;
  usage: Omit<UsageEvent, "costUsd"> & { costUsd?: never };
};

type _UsageEventIsExact = Assert<Equal<UsageEvent, DocumentedUsageEvent>>;
type _EventIdentityIsExact = Assert<Equal<EventIdentity, DocumentedEventIdentity>>;
type _ScannedUsageEventIsExact = Assert<
  Equal<ScannedUsageEvent, DocumentedScannedUsageEvent>
>;

describe("usage domain contract", () => {
  it("preserves the documented required usage fields and open agent string", () => {
    const usage = {
      ts: "2026-07-16T00:00:00.000Z",
      agent: "future-compatible-agent",
      model: null,
      sessionId: "synthetic-session",
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    } satisfies UsageEvent;

    expect(Object.keys(usage).sort()).toEqual([
      "agent",
      "cacheReadTokens",
      "cacheWriteTokens",
      "inputTokens",
      "model",
      "outputTokens",
      "sessionId",
      "ts",
    ]);
    expectTypeOf(usage.agent).toEqualTypeOf<string>();
  });

  it("allows only the documented optional usage fields", () => {
    const usage = {
      ts: "2026-07-16T00:00:00.000Z",
      agent: "claude-code",
      model: "synthetic-model",
      sessionId: "synthetic-session",
      project: "synthetic-project",
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      costUsd: 0.000_123,
    } satisfies UsageEvent;

    expect(Object.keys(usage).sort()).toEqual([
      "agent",
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
      "inputTokens",
      "model",
      "outputTokens",
      "project",
      "sessionId",
      "ts",
    ]);
  });

  it("keeps storage identity separate from usage values", () => {
    const scanned = {
      identity: {
        sourceGeneration: "synthetic-generation",
        recordOrdinal: 7,
        subIndex: 0,
      },
      usage: {
        ts: "2026-07-16T00:00:00.000Z",
        agent: "codex",
        model: "synthetic-model",
        sessionId: "synthetic-session",
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
      },
    } satisfies ScannedUsageEvent;

    expect(Object.keys(scanned).sort()).toEqual(["identity", "usage"]);
    expect(Object.keys(scanned.identity).sort()).toEqual([
      "recordOrdinal",
      "sourceGeneration",
      "subIndex",
    ]);
  });
});

const incompleteUsage = {
  ts: "2026-07-16T00:00:00.000Z",
  agent: "codex",
  model: null,
  sessionId: "synthetic-session",
  inputTokens: 10,
  cacheReadTokens: 3,
  cacheWriteTokens: 0,
};

// @ts-expect-error outputTokens is required by the canonical contract.
const _missingRequiredField: UsageEvent = incompleteUsage;

const _unknownField = {
  ts: "2026-07-16T00:00:00.000Z",
  agent: "codex",
  model: null,
  sessionId: "synthetic-session",
  inputTokens: 10,
  outputTokens: 4,
  cacheReadTokens: 3,
  cacheWriteTokens: 0,
  // @ts-expect-error normalizedModel is deliberately absent from UsageEvent.
  normalizedModel: "normalized-model",
} satisfies UsageEvent;

const pricedUsage: UsageEvent = {
  ts: "2026-07-16T00:00:00.000Z",
  agent: "codex",
  model: "synthetic-model",
  sessionId: "synthetic-session",
  inputTokens: 10,
  outputTokens: 4,
  cacheReadTokens: 3,
  cacheWriteTokens: 0,
  costUsd: 0.000_123,
};

const _pricedScannedEvent = {
  identity: {
    sourceGeneration: "synthetic-generation",
    recordOrdinal: 8,
    subIndex: 0,
  },
  // @ts-expect-error pricing is derived after persistence, never scanned or stored.
  usage: pricedUsage,
} satisfies ScannedUsageEvent;

void _missingRequiredField;
void _unknownField;
void _pricedScannedEvent;
void (null as unknown as _UsageEventIsExact);
void (null as unknown as _EventIdentityIsExact);
void (null as unknown as _ScannedUsageEventIsExact);
