# Usage log fixtures

These fixtures reproduce only the structural fields needed to define token usage semantics. They are synthetic: no raw log line, prompt, message content, tool payload, local path, account name, real session identifier, or original timestamp is included.

## Evidence boundary

The public contract and every automated check in this directory use repository-owned synthetic data only. The validators cannot accept an alternate root and do not inspect provider logs or private sources. They pin the fixture root as the current directory, require every fixture file to remain a single-link regular file, compare exact file fingerprints, open with `O_NOFOLLOW`, read only those open descriptors, and reject hard links, parent/file replacement, or identity changes before any accepted read.

The synthetic replay contract models repeated Claude Code snapshots and cumulative Codex component totals. `total_tokens` is non-authoritative in this contract, cached input is an input subset, and reasoning output is an output subset. Runtime compatibility with provider files remains an adapter responsibility.

These fixtures were rebuilt from an explicit field/value allowlist; they were not produced by masking or regex-rewriting raw logs. Security-relevant scalar domains and JSONL/expected object-field grammars are fixed independently in both validators, so changing a fixture and its manifest allowlist together cannot authorize a new field or value. The privacy validator scans decoded JSON keys/strings and JavaScript comment, regex, string, template-static, recursively parsed template-expression, direct object-property, and bare-sensitive-identifier surfaces. A bounded lexical state distinguishes statement, expression, and after-value goals; control heads and grouping/calls; binary and postfix operators; declarations and function/class/arrow expressions; `else`/`do`, restricted ASI, the `async` LineTerminator boundary, optional `catch`, and `for await`; `export default` declaration/value forms; and object/block braces. Regex bodies retain their flags and use a single-pass, backslash-parity-preserving decoder for active dot escapes, mode-dependent Unicode code-point or legacy-octal dots, and exact `[.]` classes; double-escaped atoms are not reinterpreted. Direct properties cover quoted or escaped identifier names, colon and shorthand properties, methods/accessors, async/generator methods, expression-prefix objects, and static object-binding property names. Ordinary division, labels, suffix keys, computed/rest bindings, binding target names, and class members are not treated as direct payload evidence. Private-payload keys use case/separator-normalized exact matching. Generic high-entropy detection starts at 32 characters and does not depend on character-class count.

Claude Code compact structure is unverified. This task does not invoke a provider or inspect a private source, so the v1 contract does not invent a compact fixture or infer compaction from free text or token changes. Compact/eviction detection remains unsupported and must degrade to context-limit reporting.

## Canonical rules

### Claude Code

1. Group usage rows in physical file order using the source-file cursor generation plus `sessionId`, `requestId`, `message.id`, `agentId`, and `isSidechain` as call-boundary candidates. Encode the row-side tuple as canonical typed JSON; delimiter joining and implicit string coercion are forbidden. The source path itself is never emitted.
2. Coalesce streaming revisions. Input/cache/model/request identity must remain stable, and `output_tokens` must be non-decreasing.
3. Emit one event from the terminal snapshot (`stop_reason != null`). Repeated terminal rows are duplicates.
4. Keep a non-terminal group pending across incremental scans; do not emit provisional usage.
5. Reject a conflicting group or invalid counter without affecting later groups. A model/cache change inside one boundary is a fallback/retry exception and must not be silently collapsed.
6. Use `message.model` exactly as observed; use `null` when it is absent.
7. Carry pending, emitted, and rejected call states in the public cursor across scans of the same logical source. Emitted and rejected tombstones prevent a later scan from re-emitting or reviving the call. An otherwise identical row-side tuple in another logical source is a separate call.
8. Derive `project` from source metadata as a slug and discard the path. The expected events use only allowlisted synthetic project slugs.
9. Report `coverage.pendingCalls` and the current `pending-call` diagnostic across every Claude source in the cursor. Same-source and cross-source inherited pending calls remain visible, but `affectedRecords` counts only records read in the current scan that belong to calls still pending at scan end.

Claude replay inputs live separately from expected outputs. The source B sequence creates a pending call, performs an unrelated same-source scan without inventing record attribution, finalizes the call, repeats its terminal row, and then continues a previously rejected call. The latter two scans emit nothing. `discriminator-matrix.jsonl` changes each row-side discriminator in isolation and includes delimiter/null-like pairs that collide under `join(':')` but remain distinct under typed encoding. `streaming-invariant-matrix.jsonl` violates model, input, cache-write, cache-read, and output-monotonicity one at a time. A separate replay keeps source B pending while source C is scanned. Together these cases cover global pending state, every tuple member, every streaming invariant, and all three persisted call states.

### Codex

1. Validate only `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens` as non-negative safe integers, with cached input within input and reasoning within output.
2. Ignore `total_tokens` when comparing, validating, or differencing snapshots.
3. For the first component snapshot in a session, diff from zero. An all-zero normalized delta emits no event.
4. Component-identical snapshots emit no event, even if `total_tokens` or `last_token_usage` differs.
5. For non-decreasing components, emit the component-wise delta.
6. On any component decrease, rebase to the current snapshot and emit nothing for that row. Never replay current cumulative values or emit `last_token_usage` for a reset row.
7. A malformed snapshot never advances the baseline.
8. Use the latest observed `turn_context.payload.model` in the same session; persist it across scan/file boundaries and use `null` when unavailable. `session_meta.payload.model_provider` is not a model name.
9. Key both the component baseline and latest model by stable session ID, not by rollout filename. Continue them across a resumed session and initialize from zero/null only for a previously unseen session ID.
10. Persist a session frontier consisting of deterministic source order and record ordinal. A position at or behind that frontier is stale: it cannot change the model, baseline, or frontier and cannot emit usage. Duplicate or ambiguous source order fails closed.

`codex-cli/resume.jsonl` follows `codex-cli/cumulative.jsonl` and deliberately contains no `turn_context` before its assertions. Its events use the retained model and component baseline. `codex-cli/resume-boundaries.jsonl` resumes two persisted sessions whose first accepted changed snapshots respectively omit and semantically malform last usage; resume classification must not suppress either evidence counter. `codex-cli/stale.jsonl` is discovered later but has an older source order, and `codex-cli/metadata-only.jsonl` preserves a legal null baseline in public cursor evidence.

`last_token_usage` is validation evidence only:

- First valid snapshot: derive from zero; compare valid last usage to the current components.
- Normal changed snapshot: derive from cumulative components; compare valid last usage to that delta.
- Duplicate snapshot: derived delta is zero and no event is emitted, regardless of retained last usage.
- Component decrease/reset: rebase to current and emit no event; never substitute last usage.
- Missing, malformed, or mismatching last usage never replaces a valid cumulative result. A changed mismatch emits the cumulative delta and a diagnostic.

`invalidSnapshots` means the cumulative snapshot itself violates a component invariant. `invalidDeltas` means both snapshots are valid but their derived delta violates an invariant. Neither case advances the baseline.

Both agents normalize token categories so they do not overlap:

```text
inputTokens      = non-cached input
cacheReadTokens  = cached input
cacheWriteTokens = cache creation (Claude Code only)
outputTokens     = all output, including reasoning output
```

For lens allocation, the measured prompt-side total is `inputTokens + cacheReadTokens + cacheWriteTokens`; cached context must not disappear from the breakdown.

Malformed rows/groups, invalid deltas, pending calls, reset/rebase transitions, missing models, stale sources, and last-usage mismatches produce aggregate diagnostics. Each public diagnostic contains a code, occurrence count, optional affected-record count, and coverage effect. `source-discontinuity` has no record attribution and is counted once through the public finalization path. Public coverage contains lifetime skipped, rebased, discontinuity, and model-unavailable counters plus the current cursor-wide pending count. Persisted coverage is derived exactly from persisted diagnostics: skipped records are malformed/invalid/conflicting/stale totals, rebases are reset totals, discontinuities are source-discontinuity totals, and unavailable models are model-unavailable totals. An incoherent cursor fails closed. Diagnostics contain no path, row content, or source/session identifier.

`UsageEvent` is a value object. Scan output wraps it with an opaque identity made from source generation, record ordinal, and sub-index. Equal usage values at different identities are distinct billable observations; payload equality is never a deduplication key. The fixed Issue #5 contract durably reserves the complete next-cursor source-generation map, persists ready events and next cursor in a WAL, advances the cursor only after every event is durable, and stores a committed marker containing adapter, batch ID, base revision, and committed revision. Applied recovery requires both the marker and exact next cursor to match, so reusing a batch ID at a different revision cannot be mistaken for an already-applied transaction. Fresh and loaded begin WALs require an exact six-field preflight before any write or replacement, and a complete recovery candidate is preflighted before the first begin write. Loaded durable events must be exact `{identity, usage}` envelopes whose identities reproduce their adapter-namespaced storage keys; the cursor marker must be null at revision zero or an exact adapter/revision-coherent prior marker above zero. A legal prior marker remains valid for the next base revision and is distinguished from the current applied marker. Marker, source-reservation, and full-cursor comparisons ignore object key insertion order while retaining exact key sets and array order. Every persisted `ready` WAL is revalidated as a complete self-contained envelope before event append/dedupe or cursor replacement; malformed loaded state and invalid eventful or zero-event contracts fail without changing WAL, events, cursor, or commit count. The pure state-machine harness exact-checks the WAL, durable events, cursor marker, and commit count immediately before all seven fixed crash points, then proves convergence; it also covers direct-ready replay, zero-event cursor advancement, source-reservation mismatches, reordered valid markers/cursors/multi-source maps, a schema-valid reordered non-null Codex baseline tuple that must reject with whole-state preservation, and malformed loaded envelopes. The real filesystem WAL, fsync, and atomic replacement remain Issue #5 work.

## Cursor contract

A source cursor contains an opaque `generation`, `mtimeMs`, `size`, `offset`, and `recordOrdinal`. The offset is the byte boundary after the last complete JSONL line, and the ordinal is the number assigned to the next complete record. Persisting both keeps event identity stable after restart without rereading prior content. `mtimeMs` is a non-negative safe integer used as consistency metadata, not file identity.

The public cursor is an exact recursive v1 schema. Extra or missing root/source/call/session/frontier/diagnostic/coverage fields and invalid tagged unions fail closed. Legal null Codex baseline/frontier values survive JSON serialization and projection unchanged.

- The same generation with a larger complete boundary reads only `[offset, completeSize)`.
- An unchanged complete boundary is a no-op even if `mtimeMs` changes.
- A same-generation record-count regression is a discontinuity even when `size >= offset`; this trigger has an isolated scenario.
- A generation change or `size < offset` is a source discontinuity. v1 skips the already-present bytes of that generation, drops every source-scoped Claude call state, records `source-discontinuity`, and keeps lifetime coverage partial instead of risking duplicate billing.
- A read whose pre/post metadata is unstable must be discarded and retried with a bounded policy; events and cursor always come from one stable snapshot.

Filesystem persistence, atomic cursor storage, and any stronger discontinuity recovery/deduplication strategy belong to Issue #5. Adapter-specific pending/session behavior belongs to Issues #6 and #7.

## Files

| File | Purpose |
|---|---|
| `claude-code/streaming.jsonl` | Repeated interim/final snapshots and response-local, non-cumulative usage |
| `claude-code/malformed.jsonl` | Missing model, malformed JSON, invalid counters, conflicting revisions, and incomplete response |
| `claude-code/pending-inherited-noop.jsonl` | Same-source unrelated scan that preserves inherited pending without record attribution |
| `claude-code/pending-continuation.jsonl` | A later scan chunk for the same logical source that finalizes the pending response |
| `claude-code/terminal-duplicate.jsonl` | A following scan that repeats an emitted terminal without re-emitting it |
| `claude-code/rejected-continuation.jsonl` | A following scan that cannot revive a rejected call |
| `claude-code/discriminator-matrix.jsonl` | One isolated variant for every Claude row-side call discriminator |
| `claude-code/streaming-invariant-matrix.jsonl` | One isolated violation for every fixed streaming invariant |
| `claude-code/expected.json` | Canonical events and ignored-case metadata |
| `codex-cli/cumulative.jsonl` | First, delta, duplicate, and model-change handling plus a `total_tokens` anomaly |
| `codex-cli/resume.jsonl` | Same-session continuation plus missing and malformed last-usage evidence |
| `codex-cli/reset.jsonl` | Zero baseline, rebase-only decreases, malformed baseline protection, and missing model |
| `codex-cli/resume-boundaries.jsonl` | Resume-first missing/malformed evidence for two persisted sessions |
| `codex-cli/stale.jsonl` | Older source order rejected by the persisted session frontier |
| `codex-cli/metadata-only.jsonl` | Session/model metadata with a legal null component baseline |
| `codex-cli/expected.json` | Canonical events and component-delta metadata |
| `manifest.json` | Exact inventory, canonical schema mirrors, replay inputs, cursor/recovery scenarios, and forbidden-data contract |
| `validate.mjs` | Deterministic recursive-cursor, typed identity, diagnostics, recovery, frontier, and semantic replay harness |
| `validate-privacy.mjs` | Pinned-descriptor decoded-JSON/code-surface privacy scanner that cannot target another root |
| `validate-mutations.mjs` | Synthetic-only mutations proving schema, replay, WAL ordering, swap, encoding, and privacy guards fail closed |

Every timestamp uses the documented synthetic `2000-01-01` range. IDs are short descriptive strings, not UUIDs.

Run the package-independent harness from the repository root:

```sh
node test/fixtures/validate.mjs
node test/fixtures/validate-privacy.mjs
node test/fixtures/validate-mutations.mjs
```
