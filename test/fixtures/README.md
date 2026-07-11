# Usage log fixtures

These fixtures reproduce only the structural fields needed to define token usage semantics. They are synthetic: no raw log line, prompt, message content, tool payload, local path, account name, real session identifier, or original timestamp is included.

## Observation summary

The fixture contract was derived from aggregate-only structural and arithmetic checks across multiple local files and sessions. Raw content, source paths, identifiers, timestamps, and corpus counts remain private evidence in the task record and are not copied into repository artifacts.

Claude Code can repeat and progressively revise the usage snapshot for one call. Codex component totals are cumulative within a stable session, while `total_tokens` can contain a context-window-sized offset unrelated to billable deltas. Cached input is an input subset, and reasoning output is an output subset.

These fixtures were rebuilt from an explicit field/value allowlist in `manifest.json`; they were not produced by masking or regex-rewriting raw logs.

No structural Claude Code compact marker was observed in the parsed project-log corpus. The v1 contract therefore does not invent a compact fixture or infer compaction from free text or token changes. Until a structural sample is available, compact/eviction detection remains unconfirmed and must degrade to context-limit reporting.

## Canonical rules

### Claude Code

1. Group usage rows in physical file order using the source-file cursor identity plus `sessionId`, `requestId`, `message.id`, `agentId`, and `isSidechain` as call-boundary candidates. The source path itself is never emitted.
2. Coalesce streaming revisions. Input/cache/model/request identity must remain stable, and `output_tokens` must be non-decreasing.
3. Emit one event from the terminal snapshot (`stop_reason != null`). Repeated terminal rows are duplicates.
4. Keep a non-terminal group pending across incremental scans; do not emit provisional usage.
5. Reject a conflicting group or invalid counter without affecting later groups. A model/cache change inside one boundary is a fallback/retry exception and must not be silently collapsed.
6. Use `message.model` exactly as observed; use `null` when it is absent.

### Codex

1. Validate only `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens` as non-negative safe integers, with cached input within input and reasoning within output.
2. Ignore `total_tokens` when comparing, validating, or differencing snapshots.
3. For the first component snapshot in a session, diff from zero. An all-zero normalized delta emits no event.
4. Component-identical snapshots emit no event, even if `total_tokens` or `last_token_usage` differs.
5. For non-decreasing components, emit the component-wise delta.
6. On any component decrease, rebase to the current snapshot and emit nothing for that row. Never replay current cumulative values or emit `last_token_usage` for a reset row.
7. A malformed snapshot never advances the baseline.
8. Use the latest preceding `turn_context.payload.model` in the same session; use `null` when unavailable. `session_meta.payload.model_provider` is not a model name.
9. Key the baseline by stable session ID, not by rollout filename. Continue it across a resumed session and initialize from zero only for a previously unseen session ID.

`last_token_usage` is validation and initial-baseline assistance only. It is never the normal changed-snapshot source and never overrides the rebase-only reset rule.

Both agents normalize token categories so they do not overlap:

```text
inputTokens      = non-cached input
cacheReadTokens  = cached input
cacheWriteTokens = cache creation (Claude Code only)
outputTokens     = all output, including reasoning output
```

## Files

| File | Purpose |
|---|---|
| `claude-code/streaming.jsonl` | Repeated interim/final snapshots and response-local, non-cumulative usage |
| `claude-code/malformed.jsonl` | Missing model, malformed JSON, invalid counters, conflicting revisions, and incomplete response |
| `claude-code/pending-continuation.jsonl` | A later scan chunk for the same logical source that finalizes the pending response |
| `claude-code/expected.json` | Canonical events and ignored-case metadata |
| `codex-cli/cumulative.jsonl` | First/delta/duplicate/model-change handling and a `total_tokens` anomaly |
| `codex-cli/resume.jsonl` | Same-session baseline continuation across a different rollout file |
| `codex-cli/reset.jsonl` | Zero baseline, rebase-only decreases, malformed baseline protection, and missing model |
| `codex-cli/expected.json` | Canonical events and component-delta metadata |
| `manifest.json` | Machine-readable construction allowlist and forbidden-data contract |

Every timestamp uses the documented synthetic `2000-01-01` range. IDs are short descriptive strings, not UUIDs.
