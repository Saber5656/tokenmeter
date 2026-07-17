/** A normalized usage observation shared by adapters, storage, and pricing. */
export interface UsageEvent {
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
}

/** Stable scan identity used for storage idempotency, separate from usage values. */
export interface EventIdentity {
  sourceGeneration: string;
  recordOrdinal: number;
  subIndex: number;
}

/** A usage value paired with its adapter-scoped storage identity. */
export interface ScannedUsageEvent {
  identity: EventIdentity;
  usage: UsageEvent;
}
