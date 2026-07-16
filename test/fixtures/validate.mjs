import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('fixture validator does not accept a root argument');

const root = path.dirname(fileURLToPath(import.meta.url));
const fixedDirectories = ['claude-code', 'codex-cli'];
const fixedFiles = [
  'README.md',
  'manifest.json',
  'validate.mjs',
  'validate-mutations.mjs',
  'validate-privacy.mjs',
  'claude-code/discriminator-matrix.jsonl',
  'claude-code/expected.json',
  'claude-code/malformed.jsonl',
  'claude-code/pending-continuation.jsonl',
  'claude-code/pending-inherited-noop.jsonl',
  'claude-code/rejected-continuation.jsonl',
  'claude-code/streaming.jsonl',
  'claude-code/streaming-invariant-matrix.jsonl',
  'claude-code/terminal-duplicate.jsonl',
  'codex-cli/cumulative.jsonl',
  'codex-cli/expected.json',
  'codex-cli/metadata-only.jsonl',
  'codex-cli/reset.jsonl',
  'codex-cli/resume-boundaries.jsonl',
  'codex-cli/resume.jsonl',
  'codex-cli/stale.jsonl',
];
const fixedDataFiles = fixedFiles.filter((relative) => relative.includes('/') && (relative.endsWith('.json') || relative.endsWith('.jsonl')));
const fixedValidators = ['validate.mjs', 'validate-mutations.mjs', 'validate-privacy.mjs'];

function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch`);
}

function assertCondition(condition, label) {
  if (!condition) throw new Error(`${label} failed`);
}

function fingerprint(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs];
}

function sameFingerprint(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertIdentity(actual, expected, message = 'fixture tree changed during pinned read') {
  if (!sameFingerprint(fingerprint(actual), fingerprint(expected))) throw new Error(message);
}

function assertPinnedFixtureFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    throw new Error('fixture file ownership boundary invalid');
  }
}

function readPinnedFixtureTree() {
  const handles = new Map();
  const opened = [];
  const directoryStats = new Map();
  const fileStats = new Map();
  const expectedRoot = [...fixedDirectories, ...fixedFiles.filter((relative) => !relative.includes('/'))].sort();
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('fixture tree inventory mismatch');

  try {
    process.chdir(root);
    assertIdentity(fs.statSync('.', { bigint: true }), rootStat, 'fixture root pinning failed');
    if (!same(fs.readdirSync('.').sort(), expectedRoot)) throw new Error('fixture tree inventory mismatch');

    for (const directory of fixedDirectories) {
      const directoryStat = fs.lstatSync(directory, { bigint: true });
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('fixture tree inventory mismatch');
      directoryStats.set(directory, directoryStat);
      process.chdir(directory);
      assertIdentity(fs.statSync('.', { bigint: true }), directoryStat, 'fixture directory pinning failed');
      const expected = fixedFiles
        .filter((relative) => path.dirname(relative) === directory)
        .map((relative) => path.basename(relative))
        .sort();
      if (!same(fs.readdirSync('.').sort(), expected)) throw new Error('fixture tree inventory mismatch');
      for (const basename of expected) {
        const relative = `${directory}/${basename}`;
        const stat = fs.lstatSync(basename, { bigint: true });
        assertPinnedFixtureFile(stat);
        const fd = fs.openSync(basename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        opened.push(fd);
        const descriptorStat = fs.fstatSync(fd, { bigint: true });
        assertPinnedFixtureFile(descriptorStat);
        assertIdentity(descriptorStat, stat, 'fixture file changed before descriptor pin');
        handles.set(relative, fd);
        fileStats.set(relative, stat);
      }
      process.chdir('..');
      assertIdentity(fs.statSync('.', { bigint: true }), rootStat);
    }

    for (const relative of fixedFiles.filter((candidate) => !candidate.includes('/'))) {
      const stat = fs.lstatSync(relative, { bigint: true });
      assertPinnedFixtureFile(stat);
      const fd = fs.openSync(relative, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      opened.push(fd);
      const descriptorStat = fs.fstatSync(fd, { bigint: true });
      assertPinnedFixtureFile(descriptorStat);
      assertIdentity(descriptorStat, stat, 'fixture file changed before descriptor pin');
      handles.set(relative, fd);
      fileStats.set(relative, stat);
    }

    // SYNTHETIC_SWAP_POINT

    const texts = new Map();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const relative of fixedFiles) {
      const fd = handles.get(relative);
      const buffer = fs.readFileSync(fd);
      const descriptorStat = fs.fstatSync(fd, { bigint: true });
      assertPinnedFixtureFile(descriptorStat);
      assertIdentity(descriptorStat, fileStats.get(relative));
      let decoded;
      try {
        decoded = decoder.decode(buffer);
      } catch {
        throw new Error('fixture tree contains invalid text encoding');
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(decoded)) {
        throw new Error('fixture tree contains binary control data');
      }
      texts.set(relative, decoded);
    }

    assertIdentity(fs.statSync('.', { bigint: true }), rootStat);
    assertIdentity(fs.lstatSync(root, { bigint: true }), rootStat);
    if (!same(fs.readdirSync('.').sort(), expectedRoot)) throw new Error('fixture tree changed during pinned read');
    for (const relative of fixedFiles.filter((candidate) => !candidate.includes('/'))) {
      const stat = fs.lstatSync(relative, { bigint: true });
      assertPinnedFixtureFile(stat);
      assertIdentity(stat, fileStats.get(relative));
    }
    for (const directory of fixedDirectories) {
      assertIdentity(fs.lstatSync(directory, { bigint: true }), directoryStats.get(directory));
      process.chdir(directory);
      assertIdentity(fs.statSync('.', { bigint: true }), directoryStats.get(directory));
      const expected = fixedFiles
        .filter((relative) => path.dirname(relative) === directory)
        .map((relative) => path.basename(relative))
        .sort();
      if (!same(fs.readdirSync('.').sort(), expected)) throw new Error('fixture tree changed during pinned read');
      for (const basename of expected) {
        const stat = fs.lstatSync(basename, { bigint: true });
        assertPinnedFixtureFile(stat);
        assertIdentity(stat, fileStats.get(`${directory}/${basename}`));
      }
      process.chdir('..');
      assertIdentity(fs.statSync('.', { bigint: true }), rootStat);
    }
    return texts;
  } finally {
    for (const fd of opened.reverse()) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

const fixtureTexts = readPinnedFixtureTree();

const canonicalProtocol = {
  jsonlTypes: ['assistant', 'future-event', 'session_meta', 'turn_context', 'event_msg'],
  payloadTypes: ['token_count', 'future_event'],
  roles: ['assistant'],
  stopReasons: ['end_turn', 'tool_use', null],
  eventAgents: ['claude-code', 'codex'],
  caseFixtures: ['streaming.jsonl', 'malformed.jsonl', 'pending-inherited-noop.jsonl', 'pending-continuation.jsonl', 'terminal-duplicate.jsonl', 'rejected-continuation.jsonl', 'discriminator-matrix.jsonl', 'streaming-invariant-matrix.jsonl', 'cumulative.jsonl', 'resume.jsonl', 'reset.jsonl', 'resume-boundaries.jsonl', 'stale.jsonl', 'metadata-only.jsonl'],
  caseKinds: ['claude-streaming', 'claude-malformed-pending', 'claude-pending-inherited-noop', 'claude-pending-continuation', 'claude-terminal-duplicate', 'claude-rejected-continuation', 'claude-discriminator-matrix', 'claude-streaming-invariant-matrix', 'codex-cumulative', 'codex-resume', 'codex-reset', 'codex-resume-boundaries', 'codex-stale', 'codex-metadata-only'],
  claudeCallDiscriminators: ['sourceKey', 'sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain'],
  transitionDecisions: [
    'first-component-delta',
    'first-zero-baseline-no-emit',
    'resumed-session-component-delta',
    'component-duplicate-no-emit',
    'component-decrease-rebase-no-emit',
    'zero-reset-rebase-no-emit',
    'component-delta',
    'component-delta-last-usage-missing',
    'component-delta-last-usage-malformed',
    'decrease-without-last-rebase-no-emit',
    'invalid-delta-baseline-unchanged',
    'invalid-snapshot-baseline-unchanged',
    'stale-snapshot-no-emit',
  ],
  unknownFieldNames: ['future_usage_detail', 'future_field'],
  coverageValues: ['complete', 'pending', 'partial'],
  diagnosticCodes: [
    'malformed-row',
    'invalid-usage',
    'claude-call-conflict',
    'pending-call',
    'codex-reset-rebase',
    'codex-last-usage-mismatch',
    'model-unavailable',
    'codex-stale-source',
    'source-discontinuity',
  ],
  intentionalInvalidJsonRow: '{this-is-intentionally-invalid-json',
  intentionalInvalidJsonLocations: ['claude-code/malformed.jsonl:1', 'codex-cli/cumulative.jsonl:5'],
  intentionalNegativeCounters: [
    { location: 'claude-code/malformed.jsonl:5:$.message.usage.input_tokens', value: -1 },
  ],
};
const canonicalSyntheticPolicy = {
  timestampPrefix: '2000-01-01T',
  sessionIds: ['session-claude-a', 'session-claude-b', 'session-codex-a', 'session-codex-b', 'session-codex-c'],
  requestIds: ['request-a', 'request-b', 'request-c', 'request-d', 'request-e', 'request-f', 'request-a:request-b', null, ''],
  messageIds: ['message-a', 'message-b', 'message-c', 'message-d', 'message-e', 'message-f', 'request-b:message-c'],
  agentIds: ['agent-a', 'agent-b'],
  models: ['claude-synthetic', 'claude-synthetic-fallback', 'gpt-synthetic-a', 'gpt-synthetic-b'],
  logicalSources: ['claude-source-a', 'claude-source-b', 'claude-source-c'],
  projectSlugs: ['synthetic-project-a', 'synthetic-project-b', 'synthetic-project-c'],
  sourceGenerations: ['source-generation-a', 'source-generation-b', 'claude-generation-a', 'claude-generation-b', 'claude-generation-c', 'codex-generation-a', 'codex-generation-b', 'codex-generation-c', 'codex-generation-d', 'codex-generation-e', 'codex-generation-f'],
  modelProvider: 'synthetic-provider',
  cliVersion: '0.0.0-synthetic',
  codexContextOffset: 200000,
  intentionalInvalidJsonRows: 2,
};

const canonicalManifestRootKeys = [
  'schemaVersion',
  'synthetic',
  'construction',
  'sourcePolicy',
  'inventory',
  'dataFiles',
  'validators',
  'jsonlObjectFields',
  'expectedObjectFields',
  'diagnosticCoverageMap',
  'syntheticSources',
  'replayPlan',
  'allowedProtocolValues',
  'syntheticValuePolicy',
  'sourceCursorContract',
  'storeRecoveryContract',
  'intentionalInvalidCases',
  'forbiddenData',
  'compactPolicy',
  'reviewPolicy',
];
const canonicalManifestSourcePolicy = 'No raw log line or masked derivative is permitted.';

const canonicalJsonlObjectFields = {
  claudeAssistantRoot: ['type', 'timestamp', 'sessionId', 'requestId', 'agentId', 'isSidechain', 'message'],
  claudeFutureRoot: ['type', 'timestamp', 'sessionId', 'future_field'],
  claudeMessageRequired: ['id', 'role', 'stop_reason', 'usage'],
  claudeMessageOptional: ['model'],
  claudeUsageRequired: ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'],
  claudeUsageOptional: ['future_usage_detail'],
  syntheticMarker: ['synthetic'],
  codexRoot: ['timestamp', 'type', 'payload'],
  codexSessionMetadata: ['id', 'cli_version', 'model_provider'],
  codexTurnContext: ['model'],
  codexTokenPayload: ['type', 'info'],
  codexFuturePayload: ['type', 'future_field'],
  codexInfoRequired: ['total_token_usage'],
  codexInfoOptional: ['last_token_usage', 'future_field'],
  codexUsageRequired: ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'],
  codexUsageOptional: ['total_tokens'],
};

const canonicalExpectedObjectFields = {
  claudeRoot: ['schemaVersion', 'synthetic', 'cases'],
  codexRoot: ['schemaVersion', 'synthetic', 'reasoningIsIncludedInOutput', 'inputExcludesCacheRead', 'cases'],
  claudeCase: ['fixture', 'events', 'eventIdentities', 'state', 'ignored', 'diagnostics', 'coverage', 'cursorEvidence'],
  codexCase: ['fixture', 'events', 'eventIdentities', 'componentDeltas', 'transitionDecisions', 'state', 'ignored', 'diagnostics', 'coverage', 'cursorEvidence'],
  event: ['ts', 'agent', 'model', 'sessionId', 'project', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'],
  eventIdentity: ['sourceGeneration', 'recordOrdinal', 'subIndex'],
  claudeState: ['sourceWasKnown', 'pendingBefore', 'pendingAfter', 'resolvedPendingGroups', 'crossSourceCollisionCount'],
  codexState: ['sessionKnownAtFirstMetadata', 'baselineAtFirstMetadata', 'modelAtFirstMetadata', 'metadataOccurrences', 'metadataPreservedState'],
  claudeIgnored: ['invalidJsonRows', 'unknownEventRows', 'invalidCounterGroups', 'conflictingStreamingGroups', 'pendingIncompleteGroups', 'streamingOrDuplicateRows', 'closedCallRows', 'unknownFieldNames'],
  codexIgnored: ['invalidJsonRows', 'invalidSnapshots', 'invalidDeltas', 'componentDuplicateSnapshots', 'unknownEventRows', 'allZeroSnapshots', 'componentDecreaseRebases', 'lastUsageMismatches', 'lastUsageMissing', 'lastUsageMalformed', 'modelUnavailableEvents', 'staleSourceRecords', 'unknownFieldNames'],
  diagnosticRequired: ['code', 'occurrences', 'coverage'],
  diagnosticOptional: ['affectedRecords'],
  coverage: ['complete', 'skippedRecords', 'pendingCalls', 'rebasedTransitions', 'sourceDiscontinuities', 'modelUnavailableEvents'],
};

const canonicalSourceCursorScenarioNames = [
  'initial-complete',
  'append-with-incomplete-tail',
  'mtime-only-no-op',
  'record-count-regression',
  'in-place-truncation',
  'replacement-generation',
];

const canonicalDiagnosticCoverageMap = {
  skippedRecords: ['malformed-row', 'invalid-usage', 'claude-call-conflict', 'codex-stale-source'],
  rebasedTransitions: ['codex-reset-rebase'],
  sourceDiscontinuities: ['source-discontinuity'],
  modelUnavailableEvents: ['model-unavailable'],
};

const canonicalStoreRecoveryContract = {
  schemaVersion: 1,
  adapterId: 'codex',
  batchId: 'batch-synthetic-a',
  baseCursorRevision: 0,
  sourceGenerations: { 'store-source-a': 'source-generation-a' },
  crashPoints: ['before-durable-begin', 'after-durable-begin', 'after-durable-ready', 'after-first-event', 'after-all-events', 'after-cursor-replace', 'after-durable-commit'],
  events: [
    {
      identity: { sourceGeneration: 'source-generation-a', recordOrdinal: 0, subIndex: 0 },
      usage: { ts: '2000-01-01T03:00:00.000Z', agent: 'codex', model: 'gpt-synthetic-a', sessionId: 'session-codex-a', inputTokens: 8, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
    },
    {
      identity: { sourceGeneration: 'source-generation-a', recordOrdinal: 1, subIndex: 0 },
      usage: { ts: '2000-01-01T03:00:00.000Z', agent: 'codex', model: 'gpt-synthetic-a', sessionId: 'session-codex-a', inputTokens: 8, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
    },
  ],
  nextCursor: {
    schemaVersion: 1,
    sources: { 'store-source-a': { generation: 'source-generation-a', mtimeMs: 6000, size: 20, offset: 20, recordOrdinal: 2 } },
    claudeCalls: {},
    codexSessions: {},
    diagnosticTotals: {},
    coverageTotals: { skippedRecords: 0, rebasedTransitions: 0, sourceDiscontinuities: 0, modelUnavailableEvents: 0 },
  },
  expected: {
    eventCount: 2,
    cursorRevision: 1,
    commitCount: 1,
    lastCommittedBatch: {
      adapterId: 'codex',
      batchId: 'batch-synthetic-a',
      baseCursorRevision: 0,
      committedCursorRevision: 1,
    },
    preRecoveryStates: {
      'before-durable-begin': { walPhase: null, durableEventCount: 0, cursorRevision: 0, lastCommittedBatch: null, commitCount: 0 },
      'after-durable-begin': { walPhase: 'begin', durableEventCount: 0, cursorRevision: 0, lastCommittedBatch: null, commitCount: 0 },
      'after-durable-ready': { walPhase: 'ready', durableEventCount: 0, cursorRevision: 0, lastCommittedBatch: null, commitCount: 0 },
      'after-first-event': { walPhase: 'ready', durableEventCount: 1, cursorRevision: 0, lastCommittedBatch: null, commitCount: 0 },
      'after-all-events': { walPhase: 'ready', durableEventCount: 2, cursorRevision: 0, lastCommittedBatch: null, commitCount: 0 },
      'after-cursor-replace': {
        walPhase: 'ready',
        durableEventCount: 2,
        cursorRevision: 1,
        lastCommittedBatch: { adapterId: 'codex', batchId: 'batch-synthetic-a', baseCursorRevision: 0, committedCursorRevision: 1 },
        commitCount: 0,
      },
      'after-durable-commit': {
        walPhase: null,
        durableEventCount: 2,
        cursorRevision: 1,
        lastCommittedBatch: { adapterId: 'codex', batchId: 'batch-synthetic-a', baseCursorRevision: 0, committedCursorRevision: 1 },
        commitCount: 1,
      },
    },
  },
};

function assertCanonicalFieldMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} invalid`);
  for (const fields of Object.values(value)) {
    if (!Array.isArray(fields)
      || fields.some((field) => typeof field !== 'string' || field.length === 0)
      || new Set(fields).size !== fields.length) {
      throw new Error(`${label} invalid`);
    }
  }
}

const manifest = JSON.parse(fixtureTexts.get('manifest.json'));
if (!manifest
  || typeof manifest !== 'object'
  || Array.isArray(manifest)
  || !same(Object.keys(manifest).sort(), [...canonicalManifestRootKeys].sort())) {
  throw new Error('manifest:root-schema');
}
if (manifest.sourcePolicy !== canonicalManifestSourcePolicy) throw new Error('manifest:source-policy');
assertEqual(manifest.allowedProtocolValues, canonicalProtocol, 'canonical protocol domain');
assertEqual(manifest.syntheticValuePolicy, canonicalSyntheticPolicy, 'canonical synthetic policy');
assertCanonicalFieldMap(canonicalJsonlObjectFields, 'canonical JSONL object field grammar');
assertCanonicalFieldMap(canonicalExpectedObjectFields, 'canonical expected object field grammar');
assertEqual(manifest.jsonlObjectFields, canonicalJsonlObjectFields, 'canonical JSONL object field grammar');
assertEqual(manifest.expectedObjectFields, canonicalExpectedObjectFields, 'canonical expected object field grammar');
assertEqual(manifest.diagnosticCoverageMap, canonicalDiagnosticCoverageMap, 'canonical diagnostic coverage map');
assertEqual(manifest.storeRecoveryContract, canonicalStoreRecoveryContract, 'canonical store recovery contract');
const protocol = canonicalProtocol;
const policy = canonicalSyntheticPolicy;
const objectFields = canonicalJsonlObjectFields;
const expectedFields = canonicalExpectedObjectFields;

function readLines(relative) {
  return fixtureTexts.get(relative).trimEnd().split('\n');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validCodexBaseline(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every(safeCounter)
    && value[1] <= value[0]
    && value[3] <= value[2];
}

function timestampIsSynthetic(value) {
  if (typeof value !== 'string' || !value.startsWith(policy.timestampPrefix)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function exactKeys(value, required, optional, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label}:schema-object`);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) errors.push(`${label}:schema-unexpected-key`);
  if (required.some((key) => !Object.hasOwn(value, key))) errors.push(`${label}:schema-missing-key`);
  return true;
}

function validateEnum(value, allowed, label, errors) {
  if (!allowed.includes(value)) errors.push(`${label}:schema-enum`);
}

function validateSyntheticMarker(value, label, errors) {
  if (!exactKeys(value, objectFields.syntheticMarker, [], label, errors)) return;
  if (value.synthetic !== true) errors.push(`${label}:schema-constant`);
}

function validateTimestamp(value, label, errors) {
  if (!timestampIsSynthetic(value)) errors.push(`${label}:schema-timestamp`);
}

function validateCounter(value, location, errors) {
  if (!Number.isSafeInteger(value)) {
    errors.push(`${location}:schema-type`);
    return;
  }
  if (value < 0) {
    const exception = protocol.intentionalNegativeCounters.find((candidate) => candidate.location === location);
    if (!exception || exception.value !== value) errors.push(`${location}:schema-range`);
  }
}

function validateClaudeRecord(value, relative, line, errors) {
  const label = `${relative}:${line}`;
  if (!isObject(value)) {
    errors.push(`${label}:schema-object`);
    return;
  }
  if (value.type === 'assistant') {
    if (!exactKeys(value, objectFields.claudeAssistantRoot, [], `${label}:$`, errors)) return;
    validateTimestamp(value.timestamp, `${label}:$.timestamp`, errors);
    validateEnum(value.sessionId, policy.sessionIds, `${label}:$.sessionId`, errors);
    validateEnum(value.requestId, policy.requestIds, `${label}:$.requestId`, errors);
    validateEnum(value.agentId, policy.agentIds, `${label}:$.agentId`, errors);
    if (typeof value.isSidechain !== 'boolean') errors.push(`${label}:$.isSidechain:schema-type`);
    if (!exactKeys(value.message, objectFields.claudeMessageRequired, objectFields.claudeMessageOptional, `${label}:$.message`, errors)) return;
    validateEnum(value.message.id, policy.messageIds, `${label}:$.message.id`, errors);
    if (Object.hasOwn(value.message, 'model')) validateEnum(value.message.model, policy.models, `${label}:$.message.model`, errors);
    validateEnum(value.message.role, protocol.roles, `${label}:$.message.role`, errors);
    validateEnum(value.message.stop_reason, protocol.stopReasons, `${label}:$.message.stop_reason`, errors);
    if (!exactKeys(value.message.usage, objectFields.claudeUsageRequired, objectFields.claudeUsageOptional, `${label}:$.message.usage`, errors)) return;
    for (const key of objectFields.claudeUsageRequired) {
      validateCounter(value.message.usage[key], `${label}:$.message.usage.${key}`, errors);
    }
    if (Object.hasOwn(value.message.usage, 'future_usage_detail')) {
      validateSyntheticMarker(value.message.usage.future_usage_detail, `${label}:$.message.usage.future_usage_detail`, errors);
    }
    return;
  }
  if (value.type === 'future-event') {
    if (!exactKeys(value, objectFields.claudeFutureRoot, [], `${label}:$`, errors)) return;
    validateTimestamp(value.timestamp, `${label}:$.timestamp`, errors);
    validateEnum(value.sessionId, policy.sessionIds, `${label}:$.sessionId`, errors);
    validateSyntheticMarker(value.future_field, `${label}:$.future_field`, errors);
    return;
  }
  errors.push(`${label}:schema-discriminator`);
}

function validateCodexUsage(value, label, errors) {
  if (!exactKeys(value, objectFields.codexUsageRequired, objectFields.codexUsageOptional, label, errors)) return;
  for (const key of objectFields.codexUsageRequired) validateCounter(value[key], `${label}.${key}`, errors);
}

function validateCodexRecord(value, relative, line, errors) {
  const label = `${relative}:${line}`;
  if (!exactKeys(value, objectFields.codexRoot, [], `${label}:$`, errors)) return;
  validateTimestamp(value.timestamp, `${label}:$.timestamp`, errors);
  if (value.type === 'session_meta') {
    if (!exactKeys(value.payload, objectFields.codexSessionMetadata, [], `${label}:$.payload`, errors)) return;
    validateEnum(value.payload.id, policy.sessionIds, `${label}:$.payload.id`, errors);
    if (value.payload.cli_version !== policy.cliVersion) errors.push(`${label}:$.payload.cli_version:schema-constant`);
    if (value.payload.model_provider !== policy.modelProvider) errors.push(`${label}:$.payload.model_provider:schema-constant`);
    return;
  }
  if (value.type === 'turn_context') {
    if (!exactKeys(value.payload, objectFields.codexTurnContext, [], `${label}:$.payload`, errors)) return;
    validateEnum(value.payload.model, policy.models, `${label}:$.payload.model`, errors);
    return;
  }
  if (value.type !== 'event_msg') {
    errors.push(`${label}:schema-discriminator`);
    return;
  }
  if (value?.payload?.type === 'token_count') {
    if (!exactKeys(value.payload, objectFields.codexTokenPayload, [], `${label}:$.payload`, errors)) return;
    if (!exactKeys(value.payload.info, objectFields.codexInfoRequired, objectFields.codexInfoOptional, `${label}:$.payload.info`, errors)) return;
    validateCodexUsage(value.payload.info.total_token_usage, `${label}:$.payload.info.total_token_usage`, errors);
    if (Object.hasOwn(value.payload.info, 'last_token_usage')) {
      validateCodexUsage(value.payload.info.last_token_usage, `${label}:$.payload.info.last_token_usage`, errors);
    }
    if (Object.hasOwn(value.payload.info, 'future_field')) {
      validateSyntheticMarker(value.payload.info.future_field, `${label}:$.payload.info.future_field`, errors);
    }
    return;
  }
  if (value?.payload?.type === 'future_event') {
    if (!exactKeys(value.payload, objectFields.codexFuturePayload, [], `${label}:$.payload`, errors)) return;
    validateSyntheticMarker(value.payload.future_field, `${label}:$.payload.future_field`, errors);
    return;
  }
  errors.push(`${label}:schema-payload-discriminator`);
}

function validateEvent(event, isClaude, label, errors) {
  const required = isClaude ? expectedFields.event : expectedFields.event.filter((key) => key !== 'project');
  if (!exactKeys(event, required, [], label, errors)) return;
  validateTimestamp(event.ts, `${label}:ts`, errors);
  validateEnum(event.agent, protocol.eventAgents, `${label}:agent`, errors);
  if (event.agent !== (isClaude ? 'claude-code' : 'codex')) errors.push(`${label}:agent:schema-constant`);
  if (event.model !== null) validateEnum(event.model, policy.models, `${label}:model`, errors);
  validateEnum(event.sessionId, policy.sessionIds, `${label}:sessionId`, errors);
  if (isClaude) validateEnum(event.project, policy.projectSlugs, `${label}:project`, errors);
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    if (!safeCounter(event[key])) errors.push(`${label}:${key}:schema-counter`);
  }
}

function validateEventIdentity(identity, label, errors) {
  if (!exactKeys(identity, expectedFields.eventIdentity, [], label, errors)) return;
  validateEnum(identity.sourceGeneration, policy.sourceGenerations, `${label}:source-generation`, errors);
  if (!safeCounter(identity.recordOrdinal)) errors.push(`${label}:record-ordinal:schema-counter`);
  if (!safeCounter(identity.subIndex)) errors.push(`${label}:sub-index:schema-counter`);
}

function validateIgnored(value, fields, label, errors) {
  if (!exactKeys(value, fields, [], label, errors)) return;
  for (const key of fields.filter((field) => field !== 'unknownFieldNames')) {
    if (!safeCounter(value[key])) errors.push(`${label}:${key}:schema-counter`);
  }
  if (!Array.isArray(value.unknownFieldNames)
    || value.unknownFieldNames.some((name) => !protocol.unknownFieldNames.includes(name))
    || !same(value.unknownFieldNames, [...new Set(value.unknownFieldNames)].sort())) {
    errors.push(`${label}:unknown-fields:schema-array`);
  }
}

function validateDiagnostics(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label}:schema-array`);
    return;
  }
  const codes = [];
  for (const [index, diagnostic] of value.entries()) {
    const itemLabel = `${label}:${index}`;
    if (!exactKeys(diagnostic, expectedFields.diagnosticRequired, expectedFields.diagnosticOptional, itemLabel, errors)) continue;
    validateEnum(diagnostic.code, protocol.diagnosticCodes, `${itemLabel}:code`, errors);
    validateEnum(diagnostic.coverage, protocol.coverageValues, `${itemLabel}:coverage`, errors);
    if (!Number.isSafeInteger(diagnostic.occurrences) || diagnostic.occurrences <= 0) errors.push(`${itemLabel}:occurrences:schema-counter`);
    if (Object.hasOwn(diagnostic, 'affectedRecords')
      && (!Number.isSafeInteger(diagnostic.affectedRecords) || diagnostic.affectedRecords <= 0)) {
      errors.push(`${itemLabel}:affected-records:schema-counter`);
    }
    codes.push(diagnostic.code);
  }
  if (new Set(codes).size !== codes.length || !same(codes, orderedDiagnostics(codes))) {
    errors.push(`${label}:order-or-duplicate`);
  }
}

function validateCoverage(value, label, errors) {
  if (!exactKeys(value, expectedFields.coverage, [], label, errors)) return;
  if (typeof value.complete !== 'boolean') errors.push(`${label}:complete:schema-type`);
  for (const key of expectedFields.coverage.filter((field) => field !== 'complete')) {
    if (!safeCounter(value[key])) errors.push(`${label}:${key}:schema-counter`);
  }
}

function validateCursorEvidence(value, isClaude, label, errors) {
  const stateKey = isClaude ? 'callStatuses' : 'sessions';
  if (!exactKeys(value, ['diagnosticTotals', 'coverageTotals', stateKey], [], label, errors)) return;
  if (!isObject(value.diagnosticTotals)
    || Object.entries(value.diagnosticTotals).some(([code, count]) => code === 'pending-call' || !protocol.diagnosticCodes.includes(code) || !safeCounter(count))) {
    errors.push(`${label}:diagnostic-totals`);
  }
  if (!exactKeys(value.coverageTotals, ['skippedRecords', 'rebasedTransitions', 'sourceDiscontinuities', 'modelUnavailableEvents'], [], `${label}:coverage-totals`, errors)) return;
  for (const count of Object.values(value.coverageTotals)) {
    if (!safeCounter(count)) errors.push(`${label}:coverage-totals:schema-counter`);
  }
  try {
    assertDiagnosticCoverageCoherence(value.diagnosticTotals, value.coverageTotals);
  } catch {
    errors.push(`${label}:diagnostic-coverage-mismatch`);
  }
  if (!isObject(value[stateKey])) {
    errors.push(`${label}:${stateKey}:schema-object`);
    return;
  }
  if (isClaude) {
    for (const [sourceKey, statuses] of Object.entries(value.callStatuses)) {
      validateEnum(sourceKey, policy.logicalSources, `${label}:source`, errors);
      if (!exactKeys(statuses, ['pending', 'emitted', 'rejected'], [], `${label}:${sourceKey}`, errors)) continue;
      for (const count of Object.values(statuses)) if (!safeCounter(count)) errors.push(`${label}:${sourceKey}:schema-counter`);
    }
    return;
  }
  for (const [sessionId, session] of Object.entries(value.sessions)) {
    validateEnum(sessionId, policy.sessionIds, `${label}:session`, errors);
    if (!exactKeys(session, ['baseline', 'latestModel', 'frontier'], [], `${label}:${sessionId}`, errors)) continue;
    if (session.baseline !== null && !validCodexBaseline(session.baseline)) {
      errors.push(`${label}:${sessionId}:baseline`);
    }
    if (session.latestModel !== null) validateEnum(session.latestModel, policy.models, `${label}:${sessionId}:model`, errors);
    if (session.frontier !== null
      && (!exactKeys(session.frontier, ['sourceOrder', 'recordOrdinal'], [], `${label}:${sessionId}:frontier`, errors)
        || !safeCounter(session.frontier?.sourceOrder)
        || !safeCounter(session.frontier?.recordOrdinal))) {
      errors.push(`${label}:${sessionId}:frontier`);
    }
  }
}

function validateClaudeState(value, label, errors) {
  if (!exactKeys(value, expectedFields.claudeState, [], label, errors)) return;
  if (typeof value.sourceWasKnown !== 'boolean') errors.push(`${label}:source-known:schema-type`);
  for (const key of ['pendingBefore', 'pendingAfter', 'resolvedPendingGroups', 'crossSourceCollisionCount']) {
    if (!safeCounter(value[key])) errors.push(`${label}:${key}:schema-counter`);
  }
}

function validateCodexState(value, label, errors) {
  if (!exactKeys(value, expectedFields.codexState, [], label, errors)) return;
  if (typeof value.sessionKnownAtFirstMetadata !== 'boolean') errors.push(`${label}:session-known:schema-type`);
  if (value.baselineAtFirstMetadata !== null && !validCodexBaseline(value.baselineAtFirstMetadata)) {
    errors.push(`${label}:baseline:schema-array`);
  }
  if (value.modelAtFirstMetadata !== null && !policy.models.includes(value.modelAtFirstMetadata)) {
    errors.push(`${label}:model:schema-enum`);
  }
  for (const key of ['metadataOccurrences', 'metadataPreservedState']) {
    if (!safeCounter(value[key])) errors.push(`${label}:${key}:schema-counter`);
  }
}

function validateExpectedDocument(value, relative, errors) {
  const isClaude = relative.startsWith('claude-code/');
  const rootFields = isClaude ? expectedFields.claudeRoot : expectedFields.codexRoot;
  if (!exactKeys(value, rootFields, [], `${relative}:root`, errors)) return;
  if (value.schemaVersion !== 3 || value.synthetic !== true || !Array.isArray(value.cases)) {
    errors.push(`${relative}:root:schema-constant`);
    return;
  }
  if (!isClaude) {
    if (typeof value.reasoningIsIncludedInOutput !== 'boolean' || typeof value.inputExcludesCacheRead !== 'boolean') {
      errors.push(`${relative}:root:schema-type`);
    }
  }
  const plan = manifest.replayPlan[isClaude ? 'claude-code' : 'codex-cli'];
  assertEqual(value.cases.map((testCase) => testCase.fixture), plan.map((entry) => entry.fixture), `${relative} replay inventory`);
  for (const testCase of value.cases) {
    const label = `${relative}:${testCase.fixture ?? 'case'}`;
    const fields = isClaude ? expectedFields.claudeCase : expectedFields.codexCase;
    if (!exactKeys(testCase, fields, [], label, errors)) continue;
    validateEnum(testCase.fixture, protocol.caseFixtures, `${label}:fixture`, errors);
    if (!Array.isArray(testCase.events)) errors.push(`${label}:events:schema-array`);
    else for (const [index, event] of testCase.events.entries()) validateEvent(event, isClaude, `${label}:event:${index}`, errors);
    if (!Array.isArray(testCase.eventIdentities)) errors.push(`${label}:event-identities:schema-array`);
    else for (const [index, identity] of testCase.eventIdentities.entries()) validateEventIdentity(identity, `${label}:event-identity:${index}`, errors);
    if (Array.isArray(testCase.events) && Array.isArray(testCase.eventIdentities) && testCase.events.length !== testCase.eventIdentities.length) {
      errors.push(`${label}:event-identity-cardinality`);
    }
    if (isClaude) {
      validateClaudeState(testCase.state, `${label}:state`, errors);
      validateIgnored(testCase.ignored, expectedFields.claudeIgnored, `${label}:ignored`, errors);
    } else {
      validateCodexState(testCase.state, `${label}:state`, errors);
      validateIgnored(testCase.ignored, expectedFields.codexIgnored, `${label}:ignored`, errors);
      if (!Array.isArray(testCase.componentDeltas)) errors.push(`${label}:component-deltas:schema-array`);
      else for (const tuple of testCase.componentDeltas) {
        if (!validCodexBaseline(tuple)) {
          errors.push(`${label}:component-deltas:schema-tuple`);
        }
      }
      if (!Array.isArray(testCase.transitionDecisions)
        || testCase.transitionDecisions.some((decision) => !protocol.transitionDecisions.includes(decision))) {
        errors.push(`${label}:transitions:schema-array`);
      }
    }
    validateDiagnostics(testCase.diagnostics, `${label}:diagnostics`, errors);
    validateCoverage(testCase.coverage, `${label}:coverage`, errors);
    validateCursorEvidence(testCase.cursorEvidence, isClaude, `${label}:cursor-evidence`, errors);
  }
}

function validateReplayPlan(errors) {
  const knownClaude = new Map();
  const sourceOrdinals = new Map();
  const sourceGenerations = new Map();
  const sourceRecordFrontiers = new Map();
  for (const entry of manifest.replayPlan['claude-code']) {
    const optional = [];
    if (entry.kind === 'claude-malformed-pending') optional.push('collisionAgainst');
    if (['claude-pending-inherited-noop', 'claude-pending-continuation', 'claude-terminal-duplicate', 'claude-rejected-continuation', 'claude-streaming-invariant-matrix'].includes(entry.kind)) optional.push('continuesFrom');
    if (entry.kind === 'claude-discriminator-matrix') optional.push('discriminatorFields');
    exactKeys(entry, ['fixture', 'kind', 'sourceKey', 'sourceGeneration', 'recordOrdinalStart', 'scanOrdinal', ...optional], [], `replay:${entry.kind}`, errors);
    validateEnum(entry.kind, protocol.caseKinds, `replay:${entry.fixture}:kind`, errors);
    validateEnum(entry.fixture, protocol.caseFixtures, `replay:${entry.fixture}:fixture`, errors);
    validateEnum(entry.sourceKey, policy.logicalSources, `replay:${entry.fixture}:source`, errors);
    validateEnum(entry.sourceGeneration, policy.sourceGenerations, `replay:${entry.fixture}:generation`, errors);
    if (!safeCounter(entry.recordOrdinalStart)) errors.push(`replay:${entry.fixture}:record-start`);
    const nextOrdinal = (sourceOrdinals.get(entry.sourceKey) ?? 0) + 1;
    if (entry.scanOrdinal !== nextOrdinal) errors.push(`replay:${entry.fixture}:scan-order`);
    sourceOrdinals.set(entry.sourceKey, nextOrdinal);
    const generation = sourceGenerations.get(entry.sourceKey);
    if (generation !== undefined && generation !== entry.sourceGeneration) errors.push(`replay:${entry.fixture}:source-generation-change`);
    sourceGenerations.set(entry.sourceKey, entry.sourceGeneration);
    const recordFrontier = sourceRecordFrontiers.get(entry.sourceKey) ?? 0;
    if (entry.recordOrdinalStart !== recordFrontier) errors.push(`replay:${entry.fixture}:record-order`);
    sourceRecordFrontiers.set(entry.sourceKey, recordFrontier + readLines(`claude-code/${entry.fixture}`).length);
    if (entry.collisionAgainst) {
      const prior = knownClaude.get(entry.collisionAgainst);
      if (!prior || prior.sourceKey === entry.sourceKey) errors.push(`replay:${entry.fixture}:collision-reference`);
    }
    if (entry.continuesFrom) {
      const prior = knownClaude.get(entry.continuesFrom);
      if (!prior || prior.sourceKey !== entry.sourceKey) errors.push(`replay:${entry.fixture}:continuation-reference`);
    }
    if (entry.discriminatorFields && !same(entry.discriminatorFields, protocol.claudeCallDiscriminators.slice(1))) {
      errors.push(`replay:${entry.fixture}:discriminator-matrix`);
    }
    knownClaude.set(entry.fixture, entry);
  }

  const knownCodex = new Set();
  const sourceOrders = new Set();
  const sourceGenerationSet = new Set();
  for (const entry of manifest.replayPlan['codex-cli']) {
    const required = ['fixture', 'kind', 'sourceGeneration', 'sourceOrder'];
    if (['codex-resume', 'codex-stale'].includes(entry.kind)) required.push('continuesSessionFrom');
    if (entry.kind === 'codex-resume-boundaries') required.push('continuesSessionsFrom');
    exactKeys(entry, required, [], `replay:${entry.kind}`, errors);
    validateEnum(entry.kind, protocol.caseKinds, `replay:${entry.fixture}:kind`, errors);
    validateEnum(entry.fixture, protocol.caseFixtures, `replay:${entry.fixture}:fixture`, errors);
    validateEnum(entry.sourceGeneration, policy.sourceGenerations, `replay:${entry.fixture}:generation`, errors);
    if (!safeCounter(entry.sourceOrder) || sourceOrders.has(entry.sourceOrder)) errors.push(`replay:${entry.fixture}:source-order`);
    if (sourceGenerationSet.has(entry.sourceGeneration)) errors.push(`replay:${entry.fixture}:source-generation-duplicate`);
    sourceOrders.add(entry.sourceOrder);
    sourceGenerationSet.add(entry.sourceGeneration);
    if (entry.continuesSessionFrom && !knownCodex.has(entry.continuesSessionFrom)) errors.push(`replay:${entry.fixture}:continuation-reference`);
    if (entry.continuesSessionsFrom
      && (!Array.isArray(entry.continuesSessionsFrom)
        || entry.continuesSessionsFrom.length !== 2
        || entry.continuesSessionsFrom.some((fixture) => !knownCodex.has(fixture)))) {
      errors.push(`replay:${entry.fixture}:continuation-reference`);
    }
    knownCodex.add(entry.fixture);
  }
}

function validateContracts() {
  const errors = [];
  if (manifest.schemaVersion !== 3 || manifest.synthetic !== true || manifest.construction !== 'allowlist-reconstruction') {
    errors.push('manifest:construction');
  }
  assertEqual([...manifest.inventory.directories].sort(), [...fixedDirectories].sort(), 'manifest directory inventory');
  assertEqual([...manifest.inventory.files].sort(), [...fixedFiles].sort(), 'manifest file inventory');
  assertEqual([...manifest.dataFiles].sort(), [...fixedDataFiles].sort(), 'manifest data inventory');
  assertEqual([...manifest.validators].sort(), [...fixedValidators].sort(), 'manifest validator inventory');
  assertEqual(Object.keys(manifest.syntheticSources).sort(), [...policy.logicalSources].sort(), 'synthetic source inventory');
  for (const source of Object.values(manifest.syntheticSources)) {
    exactKeys(source, ['kind', 'projectDirectoryName'], [], 'manifest:synthetic-source', errors);
    if (source.kind !== 'claude-project-log' || !policy.projectSlugs.includes(source.projectDirectoryName)) {
      errors.push('manifest:synthetic-source:schema-constant');
    }
  }
  validateReplayPlan(errors);

  const invalidJsonLocations = [];
  for (const relative of fixedDataFiles.filter((file) => file.endsWith('.jsonl'))) {
    for (const [index, line] of readLines(relative).entries()) {
      const lineNumber = index + 1;
      try {
        const value = JSON.parse(line);
        if (relative.startsWith('claude-code/')) validateClaudeRecord(value, relative, lineNumber, errors);
        else validateCodexRecord(value, relative, lineNumber, errors);
      } catch {
        const location = `${relative}:${lineNumber}`;
        invalidJsonLocations.push(location);
        if (line !== protocol.intentionalInvalidJsonRow) errors.push(`${location}:unexpected-invalid-json`);
      }
    }
  }
  assertEqual(invalidJsonLocations.sort(), [...protocol.intentionalInvalidJsonLocations].sort(), 'intentional invalid JSON locations');

  for (const relative of fixedDataFiles.filter((file) => file.endsWith('.json'))) {
    validateExpectedDocument(JSON.parse(fixtureTexts.get(relative)), relative, errors);
  }
  if (errors.length) throw new Error(`fixture contract validation failed: ${[...new Set(errors)].join(', ')}`);
}

function claudeTuple(usage) {
  const keys = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
  if (!usage || !keys.every((key) => safeCounter(usage[key]))) return null;
  return keys.map((key) => usage[key]);
}

function codexTuple(usage) {
  const keys = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
  if (!usage || !keys.every((key) => safeCounter(usage[key]))) return null;
  const tuple = keys.map((key) => usage[key]);
  return validCodexBaseline(tuple) ? tuple : null;
}

const CLAUDE_CALL_FIELDS = ['sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain'];

function valueAtPath(value, field) {
  return field.split('.').reduce((current, segment) => current?.[segment], value) ?? null;
}

function encodeClaudeCallTuple(tuple) {
  return JSON.stringify(tuple.map((item) => {
    if (item === null) return ['null'];
    if (typeof item === 'boolean') return ['boolean', item];
    return ['string', item];
  }));
}

function claudeCallKey(value) {
  const tuple = CLAUDE_CALL_FIELDS.map((field) => valueAtPath(value, field));
  const nullableStringsValid = [0, 1, 3].every((index) => tuple[index] === null || typeof tuple[index] === 'string');
  const valid = nullableStringsValid
    && typeof tuple[2] === 'string'
    && (tuple[4] === null || typeof tuple[4] === 'boolean');
  if (!valid) throw new Error('Claude call discriminator type invalid');
  return encodeClaudeCallTuple(tuple);
}

function collectUnknownFieldNames(value, names = new Set()) {
  if (!value || typeof value !== 'object') return names;
  if (Array.isArray(value)) {
    for (const child of value) collectUnknownFieldNames(child, names);
    return names;
  }
  for (const [key, child] of Object.entries(value)) {
    if (protocol.unknownFieldNames.includes(key)) names.add(key);
    collectUnknownFieldNames(child, names);
  }
  return names;
}

function projectForSource(sourceKey) {
  const source = manifest.syntheticSources[sourceKey];
  if (!source || source.kind !== 'claude-project-log' || !policy.projectSlugs.includes(source.projectDirectoryName)) {
    throw new Error('synthetic source metadata invalid');
  }
  return source.projectDirectoryName;
}

function normalizeClaude(value, tuple, project) {
  return {
    ts: value.timestamp,
    agent: 'claude-code',
    model: value.message.model ?? null,
    sessionId: value.sessionId,
    project,
    inputTokens: tuple[0],
    outputTokens: tuple[3],
    cacheReadTokens: tuple[2],
    cacheWriteTokens: tuple[1],
  };
}

function normalizeCodex(value, model, sessionId, tuple) {
  return {
    ts: value.timestamp,
    agent: 'codex',
    model,
    sessionId,
    inputTokens: tuple[0] - tuple[1],
    outputTokens: tuple[2],
    cacheReadTokens: tuple[1],
    cacheWriteTokens: 0,
  };
}

function claudeRevisionCompatible(existing, value, tuple) {
  return existing.sessionId === (value.sessionId ?? null)
    && existing.requestId === (value.requestId ?? null)
    && existing.messageId === value.message.id
    && existing.agentId === (value.agentId ?? null)
    && existing.isSidechain === (value.isSidechain ?? null)
    && existing.model === (value.message.model ?? null)
    && existing.inputTokens === tuple[0]
    && existing.cacheWriteTokens === tuple[1]
    && existing.cacheReadTokens === tuple[2]
    && tuple[3] >= existing.maxOutputTokens;
}

function orderedDiagnostics(codes) {
  const order = new Map(protocol.diagnosticCodes.map((code, index) => [code, index]));
  return [...new Set(codes)].sort((left, right) => order.get(left) - order.get(right));
}

function createCursor() {
  return {
    schemaVersion: 1,
    sources: {},
    claudeCalls: {},
    codexSessions: {},
    diagnosticTotals: {},
    coverageTotals: {
      skippedRecords: 0,
      rebasedTransitions: 0,
      sourceDiscontinuities: 0,
      modelUnavailableEvents: 0,
    },
  };
}

function assertExactObject(value, keys, label) {
  if (!isObject(value) || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${label} invalid`);
}

function assertNullableString(value, label) {
  if (value !== null && typeof value !== 'string') throw new Error(`${label} invalid`);
}

function decodeClaudeCallKey(key) {
  let encoded;
  try {
    encoded = JSON.parse(key);
  } catch {
    throw new Error('Claude call key invalid');
  }
  if (!Array.isArray(encoded) || encoded.length !== CLAUDE_CALL_FIELDS.length) throw new Error('Claude call key invalid');
  const decoded = encoded.map((item, index) => {
    if (!Array.isArray(item) || item.length < 1 || item.length > 2) throw new Error('Claude call key invalid');
    if (item[0] === 'null' && item.length === 1) return null;
    if (item[0] === 'string' && item.length === 2 && typeof item[1] === 'string') return item[1];
    if (item[0] === 'boolean' && item.length === 2 && typeof item[1] === 'boolean' && index === encoded.length - 1) return item[1];
    throw new Error('Claude call key invalid');
  });
  if (typeof decoded[2] !== 'string' || decoded[2].length === 0) throw new Error('Claude call key invalid');
  for (const index of [0, 1, 3]) assertNullableString(decoded[index], 'Claude call key scalar');
  if (decoded[4] !== null && typeof decoded[4] !== 'boolean') throw new Error('Claude call key invalid');
  if (encodeClaudeCallTuple(decoded) !== key) throw new Error('Claude call key is not canonical');
  return decoded;
}

function assertPublicCursor(cursor) {
  assertExactObject(cursor, ['schemaVersion', 'sources', 'claudeCalls', 'codexSessions', 'diagnosticTotals', 'coverageTotals'], 'adapter cursor root');
  if (cursor.schemaVersion !== 1) throw new Error('unsupported adapter cursor schema');
  for (const key of ['sources', 'claudeCalls', 'codexSessions', 'diagnosticTotals', 'coverageTotals']) {
    if (!isObject(cursor[key])) throw new Error('adapter cursor state invalid');
  }
  for (const [sourceKey, source] of Object.entries(cursor.sources)) {
    if (sourceKey.length === 0) throw new Error('source cursor key invalid');
    assertExactObject(source, ['generation', 'mtimeMs', 'size', 'offset', 'recordOrdinal'], 'source cursor');
    if (typeof source.generation !== 'string' || source.generation.length === 0
      || !safeCounter(source.mtimeMs)
      || !safeCounter(source.size)
      || !safeCounter(source.offset)
      || !safeCounter(source.recordOrdinal)
      || source.offset > source.size) {
      throw new Error('source cursor state invalid');
    }
  }
  for (const [sourceKey, calls] of Object.entries(cursor.claudeCalls)) {
    if (sourceKey.length === 0 || !isObject(calls)) throw new Error('Claude cursor source invalid');
    for (const [callKey, state] of Object.entries(calls)) {
      const tuple = decodeClaudeCallKey(callKey);
      if (!isObject(state) || !['pending', 'emitted', 'rejected'].includes(state.status)) throw new Error('Claude call state invalid');
      if (state.status === 'pending') {
        assertExactObject(state, ['status', 'sourceKey', 'sessionId', 'requestId', 'messageId', 'agentId', 'isSidechain', 'model', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'maxOutputTokens'], 'Claude pending call');
        if (state.sourceKey !== sourceKey
          || state.sessionId !== tuple[0]
          || state.requestId !== tuple[1]
          || state.messageId !== tuple[2]
          || state.agentId !== tuple[3]
          || state.isSidechain !== tuple[4]) throw new Error('Claude pending call identity invalid');
        assertNullableString(state.model, 'Claude pending model');
        for (const key of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'maxOutputTokens']) {
          if (!safeCounter(state[key])) throw new Error('Claude pending counter invalid');
        }
      } else {
        assertExactObject(state, ['status', 'sourceKey'], 'Claude closed call');
        if (state.sourceKey !== sourceKey) throw new Error('Claude closed call identity invalid');
      }
    }
  }
  for (const [sessionId, state] of Object.entries(cursor.codexSessions)) {
    if (sessionId.length === 0) throw new Error('Codex session key invalid');
    assertExactObject(state, ['baseline', 'latestModel', 'frontier'], 'Codex session state');
    if (state.baseline !== null && !validCodexBaseline(state.baseline)) {
      throw new Error('Codex session baseline invalid');
    }
    assertNullableString(state.latestModel, 'Codex session model');
    if (state.frontier !== null) {
      assertExactObject(state.frontier, ['sourceOrder', 'recordOrdinal'], 'Codex session frontier');
      if (!safeCounter(state.frontier.sourceOrder) || !safeCounter(state.frontier.recordOrdinal)) throw new Error('Codex session frontier invalid');
    }
  }
  for (const [code, count] of Object.entries(cursor.diagnosticTotals)) {
    if (code === 'pending-call' || !protocol.diagnosticCodes.includes(code) || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('adapter cursor diagnostic totals invalid');
    }
  }
  assertExactObject(cursor.coverageTotals, ['skippedRecords', 'rebasedTransitions', 'sourceDiscontinuities', 'modelUnavailableEvents'], 'adapter cursor coverage totals');
  for (const count of Object.values(cursor.coverageTotals)) {
    if (!safeCounter(count)) throw new Error('adapter cursor coverage totals invalid');
  }
  assertDiagnosticCoverageCoherence(cursor.diagnosticTotals, cursor.coverageTotals);
}

function roundTripCursor(cursor) {
  assertPublicCursor(cursor);
  const result = JSON.parse(JSON.stringify(cursor));
  assertPublicCursor(result);
  return result;
}

function updateSourceCursor(cursor, sourceKey, generation, relative, mtimeMs, recordOrdinal) {
  const previous = cursor.sources[sourceKey] ?? null;
  if (previous && previous.generation !== generation) throw new Error('synthetic source generation changed without discontinuity');
  const chunkSize = Buffer.byteLength(fixtureTexts.get(relative));
  const size = (previous?.size ?? 0) + chunkSize;
  cursor.sources[sourceKey] = { generation, mtimeMs, size, offset: size, recordOrdinal };
}

function diagnosticCoverage(code) {
  if (code === 'pending-call') return 'pending';
  if (code === 'codex-last-usage-mismatch') return 'complete';
  return 'partial';
}

function deriveCoverageTotals(diagnosticTotals) {
  const coverageTotals = {};
  for (const [coverageKey, codes] of Object.entries(canonicalDiagnosticCoverageMap)) {
    const count = codes.reduce((total, code) => total + (diagnosticTotals[code] ?? 0), 0);
    if (!safeCounter(count)) throw new Error('adapter cursor diagnostic coverage overflow');
    coverageTotals[coverageKey] = count;
  }
  return coverageTotals;
}

function assertDiagnosticCoverageCoherence(diagnosticTotals, coverageTotals) {
  const expected = deriveCoverageTotals(diagnosticTotals);
  if (Object.keys(expected).some((key) => expected[key] !== coverageTotals[key])) throw new Error('adapter cursor diagnostic coverage mismatch');
}

function buildDiagnostics(evidence) {
  return protocol.diagnosticCodes
    .filter((code) => (evidence[code]?.occurrences ?? 0) > 0)
    .map((code) => {
      const diagnostic = {
        code,
        occurrences: evidence[code].occurrences,
      };
      if (evidence[code].affectedRecords !== undefined) diagnostic.affectedRecords = evidence[code].affectedRecords;
      diagnostic.coverage = diagnosticCoverage(code);
      return diagnostic;
    });
}

function orderedTotals(totals) {
  return Object.fromEntries(protocol.diagnosticCodes
    .filter((code) => code !== 'pending-call' && (totals[code] ?? 0) > 0)
    .map((code) => [code, totals[code]]));
}

function finalizeScan(cursor, usageEvents, eventIdentities, diagnosticEvidence, pendingCalls) {
  if (usageEvents.length !== eventIdentities.length) throw new Error('scan event identity cardinality mismatch');
  for (const [code, evidence] of Object.entries(diagnosticEvidence)) {
    const occurrences = evidence.occurrences;
    if (code !== 'pending-call' && occurrences > 0) {
      cursor.diagnosticTotals[code] = (cursor.diagnosticTotals[code] ?? 0) + occurrences;
    }
  }
  cursor.diagnosticTotals = orderedTotals(cursor.diagnosticTotals);
  cursor.coverageTotals = deriveCoverageTotals(cursor.diagnosticTotals);
  assertPublicCursor(cursor);
  const coverage = {
    complete: pendingCalls === 0 && Object.values(cursor.coverageTotals).every((count) => count === 0),
    skippedRecords: cursor.coverageTotals.skippedRecords,
    pendingCalls,
    rebasedTransitions: cursor.coverageTotals.rebasedTransitions,
    sourceDiscontinuities: cursor.coverageTotals.sourceDiscontinuities,
    modelUnavailableEvents: cursor.coverageTotals.modelUnavailableEvents,
  };
  return {
    events: usageEvents.map((usage, index) => ({ identity: eventIdentities[index], usage })),
    cursor,
    diagnostics: buildDiagnostics(diagnosticEvidence),
    coverage,
  };
}

function countClaudeStatuses(cursor) {
  const callStatuses = {};
  for (const sourceKey of Object.keys(cursor.claudeCalls).sort()) {
    const counts = { pending: 0, emitted: 0, rejected: 0 };
    for (const call of Object.values(cursor.claudeCalls[sourceKey])) counts[call.status] += 1;
    callStatuses[sourceKey] = counts;
  }
  return {
    diagnosticTotals: orderedTotals(cursor.diagnosticTotals),
    coverageTotals: { ...cursor.coverageTotals },
    callStatuses,
  };
}

function countPendingCalls(cursor) {
  let total = 0;
  for (const calls of Object.values(cursor.claudeCalls)) {
    total += Object.values(calls).filter((state) => state.status === 'pending').length;
  }
  return total;
}

function projectCodexCursor(cursor) {
  const sessions = {};
  for (const sessionId of Object.keys(cursor.codexSessions).sort()) {
    const state = cursor.codexSessions[sessionId];
    sessions[sessionId] = {
      baseline: state.baseline === null ? null : [...state.baseline],
      latestModel: state.latestModel,
      frontier: state.frontier === null ? null : { ...state.frontier },
    };
  }
  return {
    diagnosticTotals: orderedTotals(cursor.diagnosticTotals),
    coverageTotals: { ...cursor.coverageTotals },
    sessions,
  };
}

function parseClaude(entry, cursor, crossSourceCollisionCount) {
  assertPublicCursor(cursor);
  const { fixture: relative, sourceKey, sourceGeneration, recordOrdinalStart } = entry;
  const sourceWasKnown = Object.hasOwn(cursor.claudeCalls, sourceKey);
  const calls = cursor.claudeCalls[sourceKey] ?? {};
  cursor.claudeCalls[sourceKey] = calls;
  const previouslyPending = new Set(Object.entries(calls).filter(([, state]) => state.status === 'pending').map(([key]) => key));
  const pendingBefore = previouslyPending.size;
  const events = [];
  const eventIdentities = [];
  const unknownFieldNames = new Set();
  const ignored = {
    invalidJsonRows: 0,
    unknownEventRows: 0,
    invalidCounterGroups: 0,
    conflictingStreamingGroups: 0,
    pendingIncompleteGroups: 0,
    streamingOrDuplicateRows: 0,
    closedCallRows: 0,
  };
  let resolvedPendingGroups = 0;
  const pendingRecordCounts = new Map();

  for (const [index, line] of readLines(`claude-code/${relative}`).entries()) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      ignored.invalidJsonRows += 1;
      continue;
    }
    if (value.type !== 'assistant' || !value?.message?.usage || typeof value?.message?.id !== 'string') {
      ignored.unknownEventRows += 1;
      continue;
    }
    collectUnknownFieldNames(value, unknownFieldNames);
    const callKey = claudeCallKey(value);
    const existing = calls[callKey];
    if (existing && existing.status !== 'pending') {
      ignored.closedCallRows += 1;
      continue;
    }
    const tuple = claudeTuple(value.message.usage);
    if (!tuple) {
      ignored.invalidCounterGroups += 1;
      calls[callKey] = { status: 'rejected', sourceKey };
      continue;
    }
    if (existing) {
      if (!claudeRevisionCompatible(existing, value, tuple)) {
        ignored.conflictingStreamingGroups += 1;
        calls[callKey] = { status: 'rejected', sourceKey };
        continue;
      }
      ignored.streamingOrDuplicateRows += 1;
      existing.maxOutputTokens = tuple[3];
    } else {
      calls[callKey] = {
        status: 'pending',
        sourceKey,
        sessionId: value.sessionId ?? null,
        requestId: value.requestId ?? null,
        messageId: value.message.id,
        agentId: value.agentId ?? null,
        isSidechain: value.isSidechain ?? null,
        model: value.message.model ?? null,
        inputTokens: tuple[0],
        cacheWriteTokens: tuple[1],
        cacheReadTokens: tuple[2],
        maxOutputTokens: tuple[3],
      };
    }
    if (value.message.stop_reason === null || value.message.stop_reason === undefined) {
      pendingRecordCounts.set(callKey, (pendingRecordCounts.get(callKey) ?? 0) + 1);
      continue;
    }
    if (previouslyPending.has(callKey)) resolvedPendingGroups += 1;
    calls[callKey] = { status: 'emitted', sourceKey };
    events.push(normalizeClaude(value, tuple, projectForSource(sourceKey)));
    eventIdentities.push({ sourceGeneration, recordOrdinal: recordOrdinalStart + index, subIndex: 0 });
  }

  const pendingAfter = Object.values(calls).filter((state) => state.status === 'pending').length;
  const globalPendingAfter = countPendingCalls(cursor);
  const affectedPendingRecords = [...pendingRecordCounts.entries()].reduce(
    (total, [callKey, count]) => total + (calls[callKey]?.status === 'pending' ? count : 0),
    0,
  );
  ignored.pendingIncompleteGroups = pendingAfter;
  const diagnosticEvidence = {
    'malformed-row': { occurrences: ignored.invalidJsonRows, affectedRecords: ignored.invalidJsonRows },
    'invalid-usage': { occurrences: ignored.invalidCounterGroups, affectedRecords: ignored.invalidCounterGroups },
    'claude-call-conflict': { occurrences: ignored.conflictingStreamingGroups, affectedRecords: ignored.conflictingStreamingGroups },
    'pending-call': {
      occurrences: globalPendingAfter,
      ...(affectedPendingRecords > 0 ? { affectedRecords: affectedPendingRecords } : {}),
    },
  };
  updateSourceCursor(cursor, sourceKey, sourceGeneration, `claude-code/${relative}`, entry.scanOrdinal * 1000, recordOrdinalStart + readLines(`claude-code/${relative}`).length);
  const scanResult = finalizeScan(cursor, events, eventIdentities, diagnosticEvidence, globalPendingAfter);
  return {
    scanResult,
    state: { sourceWasKnown, pendingBefore, pendingAfter, resolvedPendingGroups, crossSourceCollisionCount },
    ignored: { ...ignored, unknownFieldNames: [...unknownFieldNames].sort() },
    cursorEvidence: countClaudeStatuses(cursor),
  };
}

function comparePosition(left, right) {
  if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder;
  return left.recordOrdinal - right.recordOrdinal;
}

function validateCrossSourcePendingCoverage() {
  const malformed = manifest.replayPlan['claude-code'].find((entry) => entry.fixture === 'malformed.jsonl');
  const matrix = manifest.replayPlan['claude-code'].find((entry) => entry.fixture === 'discriminator-matrix.jsonl');
  let cursor = createCursor();
  const pending = parseClaude(malformed, cursor, 1);
  assertEqual(pending.state.pendingAfter, 1, 'cross-source pending setup');
  cursor = roundTripCursor(pending.scanResult.cursor);
  const otherSource = parseClaude(matrix, cursor, 0);
  assertEqual(otherSource.state.pendingAfter, 0, 'cross-source local pending');
  assertEqual(otherSource.scanResult.coverage.pendingCalls, 1, 'cross-source global pending coverage');
  assertEqual(otherSource.scanResult.diagnostics, [{ code: 'pending-call', occurrences: 1, coverage: 'pending' }], 'cross-source global pending diagnostic');
}

const ACCEPT_VALID_TOTAL_WITHOUT_VALID_LAST = true;

function parseCodex(entry, cursor) {
  assertPublicCursor(cursor);
  const { fixture: relative, sourceGeneration, sourceOrder } = entry;
  const events = [];
  const eventIdentities = [];
  const componentDeltas = [];
  const transitionDecisions = [];
  const unknownFieldNames = new Set();
  const ignored = {
    invalidJsonRows: 0,
    invalidSnapshots: 0,
    invalidDeltas: 0,
    componentDuplicateSnapshots: 0,
    unknownEventRows: 0,
    allZeroSnapshots: 0,
    componentDecreaseRebases: 0,
    lastUsageMismatches: 0,
    lastUsageMissing: 0,
    lastUsageMalformed: 0,
    modelUnavailableEvents: 0,
    staleSourceRecords: 0,
  };
  const sessionsKnownBeforeReplay = new Set(Object.keys(cursor.codexSessions));
  const resumedSessionPending = new Set();
  const replayState = {
    sessionKnownAtFirstMetadata: false,
    baselineAtFirstMetadata: null,
    modelAtFirstMetadata: null,
    metadataOccurrences: 0,
    metadataPreservedState: 0,
  };
  let sessionId = null;
  let state = null;

  for (const [recordOrdinal, line] of readLines(`codex-cli/${relative}`).entries()) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      ignored.invalidJsonRows += 1;
      continue;
    }
    const position = { sourceOrder, recordOrdinal };
    if (value.type === 'session_meta') {
      sessionId = typeof value?.payload?.id === 'string' ? value.payload.id : null;
      const existing = cursor.codexSessions[sessionId];
      if (replayState.metadataOccurrences === 0) {
        replayState.sessionKnownAtFirstMetadata = existing !== undefined;
        replayState.baselineAtFirstMetadata = existing?.baseline ? [...existing.baseline] : null;
        replayState.modelAtFirstMetadata = existing?.latestModel ?? null;
      }
      replayState.metadataOccurrences += 1;
      if (existing !== undefined) replayState.metadataPreservedState += 1;
      state = existing ?? { baseline: null, latestModel: null, frontier: null };
      cursor.codexSessions[sessionId] = state;
      if (state.frontier && comparePosition(position, state.frontier) <= 0) {
        ignored.staleSourceRecords += 1;
        continue;
      }
      state.frontier = position;
      if (sessionsKnownBeforeReplay.has(sessionId)) resumedSessionPending.add(sessionId);
      continue;
    }
    if (state?.frontier && comparePosition(position, state.frontier) <= 0) {
      ignored.staleSourceRecords += 1;
      if (value.type === 'event_msg' && value?.payload?.type === 'token_count') transitionDecisions.push('stale-snapshot-no-emit');
      continue;
    }
    if (value.type === 'turn_context') {
      if (state) {
        state.latestModel = typeof value?.payload?.model === 'string' ? value.payload.model : null;
        state.frontier = position;
      } else ignored.unknownEventRows += 1;
      continue;
    }
    if (value.type !== 'event_msg' || value?.payload?.type !== 'token_count') {
      ignored.unknownEventRows += 1;
      if (state) state.frontier = position;
      continue;
    }
    collectUnknownFieldNames(value, unknownFieldNames);
    if (state) state.frontier = position;
    const current = codexTuple(value?.payload?.info?.total_token_usage);
    if (!state || !current) {
      ignored.invalidSnapshots += 1;
      transitionDecisions.push('invalid-snapshot-baseline-unchanged');
      continue;
    }
    if (state.baseline && same(current, state.baseline)) {
      ignored.componentDuplicateSnapshots += 1;
      transitionDecisions.push('component-duplicate-no-emit');
      continue;
    }

    let delta;
    let transition = null;
    if (!state.baseline) {
      delta = current;
      transition = delta.every((counter) => counter === 0)
        ? 'first-zero-baseline-no-emit'
        : 'first-component-delta';
    } else {
      const candidate = current.map((counter, index) => counter - state.baseline[index]);
      if (candidate.some((counter) => counter < 0)) {
        ignored.componentDecreaseRebases += 1;
        const lastUsage = codexTuple(value?.payload?.info?.last_token_usage);
        if (current.every((counter) => counter === 0)) transitionDecisions.push('zero-reset-rebase-no-emit');
        else if (!lastUsage) transitionDecisions.push('decrease-without-last-rebase-no-emit');
        else transitionDecisions.push('component-decrease-rebase-no-emit');
        state.baseline = current;
        continue;
      }
      delta = codexTuple({
        input_tokens: candidate[0],
        cached_input_tokens: candidate[1],
        output_tokens: candidate[2],
        reasoning_output_tokens: candidate[3],
      });
      if (!delta) {
        ignored.invalidDeltas += 1;
        transitionDecisions.push('invalid-delta-baseline-unchanged');
        continue;
      }
    }

    const hasLastUsage = Object.hasOwn(value?.payload?.info ?? {}, 'last_token_usage');
    const lastUsage = hasLastUsage ? codexTuple(value.payload.info.last_token_usage) : null;
    if (!ACCEPT_VALID_TOTAL_WITHOUT_VALID_LAST && !lastUsage) {
      ignored.invalidSnapshots += 1;
      transitionDecisions.push('invalid-snapshot-baseline-unchanged');
      continue;
    }
    transition ??= 'component-delta';
    const isResumed = resumedSessionPending.has(sessionId);
    if (!hasLastUsage) ignored.lastUsageMissing += 1;
    else if (!lastUsage) ignored.lastUsageMalformed += 1;
    if (isResumed) {
      transition = 'resumed-session-component-delta';
      resumedSessionPending.delete(sessionId);
    } else if (!hasLastUsage) {
      transition = 'component-delta-last-usage-missing';
    } else if (!lastUsage) {
      transition = 'component-delta-last-usage-malformed';
    }
    if (lastUsage && !same(lastUsage, delta)) ignored.lastUsageMismatches += 1;
    const normalizedDelta = delta;
    state.baseline = current;
    transitionDecisions.push(transition);
    if (normalizedDelta.every((counter) => counter === 0)) {
      ignored.allZeroSnapshots += 1;
      continue;
    }
    if (state.latestModel === null) ignored.modelUnavailableEvents += 1;
    events.push(normalizeCodex(value, state.latestModel, sessionId, normalizedDelta));
    eventIdentities.push({ sourceGeneration, recordOrdinal, subIndex: 0 });
    componentDeltas.push(normalizedDelta);
  }

  const diagnosticEvidence = {
    'malformed-row': { occurrences: ignored.invalidJsonRows, affectedRecords: ignored.invalidJsonRows },
    'invalid-usage': { occurrences: ignored.invalidSnapshots + ignored.invalidDeltas, affectedRecords: ignored.invalidSnapshots + ignored.invalidDeltas },
    'codex-reset-rebase': { occurrences: ignored.componentDecreaseRebases, affectedRecords: ignored.componentDecreaseRebases },
    'codex-last-usage-mismatch': { occurrences: ignored.lastUsageMismatches, affectedRecords: ignored.lastUsageMismatches },
    'model-unavailable': { occurrences: ignored.modelUnavailableEvents, affectedRecords: ignored.modelUnavailableEvents },
    'codex-stale-source': { occurrences: ignored.staleSourceRecords, affectedRecords: ignored.staleSourceRecords },
  };
  updateSourceCursor(cursor, sourceGeneration, sourceGeneration, `codex-cli/${relative}`, sourceOrder * 1000, readLines(`codex-cli/${relative}`).length);
  const scanResult = finalizeScan(cursor, events, eventIdentities, diagnosticEvidence, countPendingCalls(cursor));
  return {
    scanResult,
    componentDeltas,
    transitionDecisions,
    state: replayState,
    ignored: { ...ignored, unknownFieldNames: [...unknownFieldNames].sort() },
    cursorEvidence: projectCodexCursor(cursor),
  };
}

function claudeCallIdentities(relative) {
  const identities = new Set();
  for (const line of readLines(`claude-code/${relative}`)) {
    try {
      const value = JSON.parse(line);
      if (value.type === 'assistant' && typeof value?.message?.id === 'string') identities.add(claudeCallKey(value));
    } catch {
      // Intentional malformed rows are accounted for by the schema gate.
    }
  }
  return identities;
}

function validateDiscriminatorMatrix() {
  const entry = manifest.replayPlan['claude-code'].find((candidate) => candidate.kind === 'claude-discriminator-matrix');
  const rows = readLines(`claude-code/${entry.fixture}`).map((line) => JSON.parse(line));
  assertEqual(rows.length, entry.discriminatorFields.length + 5, 'Claude discriminator matrix row count');
  const base = rows[0];
  for (const [index, field] of entry.discriminatorFields.entries()) {
    const candidate = rows[index + 1];
    const differences = CLAUDE_CALL_FIELDS.filter((name) => valueAtPath(base, name) !== valueAtPath(candidate, name));
    assertEqual(differences, [field], `Claude discriminator isolation ${field}`);
  }
  const legacyKey = (value) => CLAUDE_CALL_FIELDS.map((field) => valueAtPath(value, field)).join(':');
  const delimiterPair = rows.slice(entry.discriminatorFields.length + 1, entry.discriminatorFields.length + 3);
  const nullLikePair = rows.slice(entry.discriminatorFields.length + 3, entry.discriminatorFields.length + 5);
  assertEqual(legacyKey(delimiterPair[0]), legacyKey(delimiterPair[1]), 'Claude legacy delimiter collision evidence');
  assertEqual(legacyKey(nullLikePair[0]), legacyKey(nullLikePair[1]), 'Claude legacy null-like collision evidence');
  assertCondition(claudeCallKey(delimiterPair[0]) !== claudeCallKey(delimiterPair[1]), 'Claude delimiter collision-free key');
  assertCondition(claudeCallKey(nullLikePair[0]) !== claudeCallKey(nullLikePair[1]), 'Claude null-like collision-free key');
  assertEqual(new Set(rows.map(claudeCallKey)).size, rows.length, 'Claude canonical call key uniqueness');
}

function validateStreamingInvariantMatrix() {
  const entry = manifest.replayPlan['claude-code'].find((candidate) => candidate.kind === 'claude-streaming-invariant-matrix');
  const rows = readLines(`claude-code/${entry.fixture}`).map((line) => JSON.parse(line));
  const invariants = ['model', 'inputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'outputMonotonicity'];
  assertEqual(rows.length, invariants.length * 2, 'Claude streaming invariant matrix row count');
  const callKeys = [];
  for (const [index, invariant] of invariants.entries()) {
    const pending = rows[index * 2];
    const terminal = rows[index * 2 + 1];
    const pendingTuple = claudeTuple(pending.message.usage);
    const terminalTuple = claudeTuple(terminal.message.usage);
    assertCondition(pending.message.stop_reason === null && terminal.message.stop_reason !== null, `Claude streaming invariant phase ${invariant}`);
    assertEqual(claudeCallKey(pending), claudeCallKey(terminal), `Claude streaming invariant call identity ${invariant}`);
    callKeys.push(claudeCallKey(pending));
    const violations = [];
    if (pending.message.model !== terminal.message.model) violations.push('model');
    if (pendingTuple[0] !== terminalTuple[0]) violations.push('inputTokens');
    if (pendingTuple[1] !== terminalTuple[1]) violations.push('cacheWriteTokens');
    if (pendingTuple[2] !== terminalTuple[2]) violations.push('cacheReadTokens');
    if (terminalTuple[3] < pendingTuple[3]) violations.push('outputMonotonicity');
    assertEqual(violations, [invariant], `Claude streaming invariant isolation ${invariant}`);
    const pendingState = {
      sourceKey: entry.sourceKey,
      sessionId: pending.sessionId ?? null,
      requestId: pending.requestId ?? null,
      messageId: pending.message.id,
      agentId: pending.agentId ?? null,
      isSidechain: pending.isSidechain ?? null,
      model: pending.message.model ?? null,
      inputTokens: pendingTuple[0],
      cacheWriteTokens: pendingTuple[1],
      cacheReadTokens: pendingTuple[2],
      maxOutputTokens: pendingTuple[3],
    };
    assertCondition(!claudeRevisionCompatible(pendingState, terminal, terminalTuple), `Claude streaming invariant rejection ${invariant}`);
  }
  assertEqual(new Set(callKeys).size, invariants.length, 'Claude streaming invariant call uniqueness');
}

function dropClaudeSourceState(cursor, sourceKey) {
  delete cursor.claudeCalls[sourceKey];
}

function applySourcePlan(cursor, sourceKey, plan) {
  cursor.sources[sourceKey] = plan.next;
  if (!plan.dropSourceState) return;
  dropClaudeSourceState(cursor, sourceKey);
}

function planSourceScan(previous, observation) {
  const validObservation = policy.sourceGenerations.includes(observation.generation)
    && safeCounter(observation.mtimeMs)
    && safeCounter(observation.size)
    && safeCounter(observation.completeSize)
    && safeCounter(observation.completeRecords)
    && observation.completeSize <= observation.size;
  if (!validObservation) throw new Error('source cursor observation invalid');
  if (previous !== null) {
    const validPrevious = policy.sourceGenerations.includes(previous.generation)
      && safeCounter(previous.mtimeMs)
      && safeCounter(previous.size)
      && safeCounter(previous.offset)
      && safeCounter(previous.recordOrdinal)
      && previous.offset <= previous.size;
    if (!validPrevious) throw new Error('source cursor state invalid');
  }
  const discontinuity = previous !== null
    && (previous.generation !== observation.generation
      || observation.size < previous.offset
      || observation.completeRecords < previous.recordOrdinal);
  if (discontinuity) {
    return {
      action: 'skip',
      readStart: null,
      readEnd: null,
      next: {
        generation: observation.generation,
        mtimeMs: observation.mtimeMs,
        size: observation.size,
        offset: observation.completeSize,
        recordOrdinal: observation.completeRecords,
      },
      discontinuity: true,
      dropSourceState: true,
      diagnosticCode: 'source-discontinuity',
    };
  }
  const readStart = previous?.offset ?? 0;
  const readEnd = observation.completeSize;
  if (readEnd < readStart) throw new Error('source cursor complete boundary regressed');
  return {
    action: readEnd === readStart ? 'none' : 'read',
    readStart,
    readEnd,
    next: {
      generation: observation.generation,
      mtimeMs: observation.mtimeMs,
      size: observation.size,
      offset: readEnd,
      recordOrdinal: observation.completeRecords,
    },
    discontinuity: false,
    dropSourceState: false,
    diagnosticCode: null,
  };
}

function validateSourceCursorContract() {
  assertEqual(manifest.sourceCursorContract.fields, ['generation', 'mtimeMs', 'size', 'offset', 'recordOrdinal'], 'source cursor fields');
  assertEqual(manifest.sourceCursorContract.offsetPolicy, 'last-complete-jsonl-line-byte-boundary', 'source cursor offset policy');
  assertEqual(manifest.sourceCursorContract.discontinuityPolicy, 'skip-current-generation-and-mark-partial', 'source cursor discontinuity policy');
  assertEqual(manifest.sourceCursorContract.scenarios.map((scenario) => scenario.name), canonicalSourceCursorScenarioNames, 'source cursor scenario inventory');
  for (const scenario of manifest.sourceCursorContract.scenarios) {
    const actual = planSourceScan(scenario.previous, scenario.observation);
    assertEqual(actual, scenario.expected, `source cursor scenario ${scenario.name}`);
    assertEqual(JSON.parse(JSON.stringify(actual.next)), actual.next, `source cursor round trip ${scenario.name}`);
  }
  const recordRegression = manifest.sourceCursorContract.scenarios.find((scenario) => scenario.name === 'record-count-regression');
  assertCondition(recordRegression.previous.generation === recordRegression.observation.generation, 'record-count regression same generation');
  assertCondition(recordRegression.observation.size >= recordRegression.previous.offset, 'record-count regression nondecreasing size boundary');
  assertCondition(recordRegression.observation.completeRecords < recordRegression.previous.recordOrdinal, 'record-count regression isolated ordinal trigger');
  const cursor = createCursor();
  const pendingValue = {
    sessionId: 'session-claude-a',
    requestId: 'request-a',
    agentId: 'agent-a',
    isSidechain: false,
    message: { id: 'message-a' },
  };
  cursor.claudeCalls['claude-source-a'] = {
    [claudeCallKey(pendingValue)]: {
      status: 'pending',
      sourceKey: 'claude-source-a',
      sessionId: 'session-claude-a',
      requestId: 'request-a',
      messageId: 'message-a',
      agentId: 'agent-a',
      isSidechain: false,
      model: 'claude-synthetic',
      inputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      maxOutputTokens: 1,
    },
  };
  cursor.claudeCalls['claude-source-b'] = {
    [claudeCallKey({ ...pendingValue, sessionId: 'session-claude-b' })]: { status: 'emitted', sourceKey: 'claude-source-b' },
  };
  const discontinuity = manifest.sourceCursorContract.scenarios.find((scenario) => scenario.name === 'replacement-generation');
  applySourcePlan(cursor, 'claude-source-a', planSourceScan(discontinuity.previous, discontinuity.observation));
  assertCondition(!Object.hasOwn(cursor.claudeCalls, 'claude-source-a'), 'source discontinuity drops every Claude call status');
  assertCondition(Object.hasOwn(cursor.claudeCalls, 'claude-source-b'), 'source discontinuity preserves unrelated Claude state');
  const result = finalizeScan(cursor, [], [], {
    'source-discontinuity': { occurrences: 1 },
  }, countPendingCalls(cursor));
  assertEqual(result.events, [], 'source discontinuity public events');
  assertEqual(result.diagnostics, [{ code: 'source-discontinuity', occurrences: 1, coverage: 'partial' }], 'source discontinuity public diagnostics');
  assertEqual(result.coverage, {
    complete: false,
    skippedRecords: 0,
    pendingCalls: 0,
    rebasedTransitions: 0,
    sourceDiscontinuities: 1,
    modelUnavailableEvents: 0,
  }, 'source discontinuity public coverage');
  assertEqual(result.cursor.coverageTotals.sourceDiscontinuities, 1, 'source discontinuity lifetime coverage');
  assertEqual(result.cursor.diagnosticTotals['source-discontinuity'], 1, 'source discontinuity lifetime diagnostic');
  assertEqual(roundTripCursor(result.cursor), result.cursor, 'source discontinuity cursor round trip');
}

function expectCursorRejection(cursor, label) {
  let rejected = false;
  try {
    assertPublicCursor(cursor);
  } catch {
    rejected = true;
  }
  assertCondition(rejected, label);
}

function validatePublicCursorContract() {
  const value = {
    sessionId: 'session-claude-a',
    requestId: 'request-a',
    agentId: 'agent-a',
    isSidechain: false,
    message: { id: 'message-a' },
  };
  const key = claudeCallKey(value);
  const closedKey = claudeCallKey({ ...value, requestId: 'request-b', message: { id: 'message-b' } });
  const cursor = createCursor();
  cursor.sources['claude-source-a'] = { generation: 'source-generation-a', mtimeMs: 1, size: 2, offset: 2, recordOrdinal: 1 };
  cursor.claudeCalls['claude-source-a'] = {
    [key]: {
      status: 'pending', sourceKey: 'claude-source-a', sessionId: 'session-claude-a', requestId: 'request-a', messageId: 'message-a',
      agentId: 'agent-a', isSidechain: false, model: null, inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, maxOutputTokens: 1,
    },
    [closedKey]: { status: 'emitted', sourceKey: 'claude-source-a' },
  };
  cursor.codexSessions['session-codex-c'] = { baseline: null, latestModel: null, frontier: null };
  assertEqual(roundTripCursor(cursor), cursor, 'recursive public cursor round trip');
  const projection = projectCodexCursor(cursor);
  const errors = [];
  validateCursorEvidence(projection, false, 'nullable-codex-cursor', errors);
  assertEqual(errors, [], 'nullable Codex cursor evidence');
  assertEqual(projection.sessions['session-codex-c'], { baseline: null, latestModel: null, frontier: null }, 'nullable Codex cursor projection');

  const validBaseline = { baseline: [4, 4, 3, 3], latestModel: null, frontier: null };
  cursor.codexSessions['session-codex-b'] = validBaseline;
  assertEqual(roundTripCursor(cursor).codexSessions['session-codex-b'], validBaseline, 'valid Codex baseline projection');

  const invalid = (mutate) => {
    const clone = JSON.parse(JSON.stringify(cursor));
    mutate(clone);
    return clone;
  };
  expectCursorRejection(invalid((clone) => { clone.codexSessions['session-codex-c'].baseline = [3, 4, 2, 1]; }), 'cursor rejects cached baseline overflow');
  expectCursorRejection(invalid((clone) => { clone.codexSessions['session-codex-c'].baseline = [3, 1, 2, 3]; }), 'cursor rejects reasoning baseline overflow');
  expectCursorRejection(invalid((clone) => { clone.hidden = {}; }), 'cursor rejects hidden root state');
  expectCursorRejection(invalid((clone) => { clone.sources['claude-source-a'].hidden = 1; }), 'cursor rejects hidden source state');
  expectCursorRejection(invalid((clone) => { delete clone.sources['claude-source-a'].offset; }), 'cursor rejects missing source state');
  expectCursorRejection(invalid((clone) => { clone.sources['claude-source-a'].offset = 3; }), 'cursor rejects invalid source boundary');
  expectCursorRejection(invalid((clone) => { clone.claudeCalls['claude-source-a'][key].hidden = 1; }), 'cursor rejects hidden Claude state');
  expectCursorRejection(invalid((clone) => { delete clone.claudeCalls['claude-source-a'][key].messageId; }), 'cursor rejects missing Claude pending state');
  expectCursorRejection(invalid((clone) => { clone.claudeCalls['claude-source-a'][closedKey].inputTokens = 1; }), 'cursor rejects pending data on closed tombstone');
  expectCursorRejection(invalid((clone) => { clone.claudeCalls['claude-source-a'][closedKey].status = 'unknown'; }), 'cursor rejects unknown Claude status');
  expectCursorRejection(invalid((clone) => {
    const state = clone.claudeCalls['claude-source-a'][key];
    delete clone.claudeCalls['claude-source-a'][key];
    clone.claudeCalls['claude-source-a'][JSON.stringify(JSON.parse(key), null, 1)] = state;
  }), 'cursor rejects non-canonical Claude call key');
  expectCursorRejection(invalid((clone) => { clone.codexSessions['session-codex-c'].hidden = 1; }), 'cursor rejects hidden Codex state');
  expectCursorRejection(invalid((clone) => { clone.codexSessions['session-codex-c'].frontier = { sourceOrder: 1, recordOrdinal: 1, hidden: 1 }; }), 'cursor rejects hidden frontier state');
  expectCursorRejection(invalid((clone) => { clone.coverageTotals.hidden = 1; }), 'cursor rejects hidden coverage state');
  expectCursorRejection(invalid((clone) => { delete clone.coverageTotals.skippedRecords; }), 'cursor rejects missing coverage state');
  expectCursorRejection(invalid((clone) => { clone.diagnosticTotals.hidden = 1; }), 'cursor rejects unknown diagnostic state');
  expectCursorRejection(invalid((clone) => { clone.diagnosticTotals['pending-call'] = 1; }), 'cursor rejects persisted pending diagnostic');
  expectCursorRejection(invalid((clone) => { clone.diagnosticTotals['malformed-row'] = 1; }), 'cursor rejects diagnostic without coverage');
  expectCursorRejection(invalid((clone) => { clone.coverageTotals.skippedRecords = 1; }), 'cursor rejects coverage without diagnostic');
  const completeEvidenceCursor = createCursor();
  completeEvidenceCursor.diagnosticTotals['codex-last-usage-mismatch'] = 1;
  assertPublicCursor(completeEvidenceCursor);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function eventStorageKey(adapterId, event) {
  return JSON.stringify([adapterId, event.identity.sourceGeneration, event.identity.recordOrdinal, event.identity.subIndex]);
}

function createStoreRecoveryState() {
  return {
    wal: null,
    events: {},
    cursorEnvelope: { revision: 0, lastCommittedBatch: null, cursor: createCursor() },
    commitCount: 0,
  };
}

function committedBatchMarker(batch) {
  if (!safeCounter(batch.baseCursorRevision) || batch.baseCursorRevision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('store batch cursor revision invalid');
  }
  return {
    adapterId: batch.adapterId,
    batchId: batch.batchId,
    baseCursorRevision: batch.baseCursorRevision,
    committedCursorRevision: batch.baseCursorRevision + 1,
  };
}

function beginWal(contract) {
  return {
    phase: 'begin',
    schemaVersion: contract.schemaVersion,
    adapterId: contract.adapterId,
    batchId: contract.batchId,
    baseCursorRevision: contract.baseCursorRevision,
    sourceGenerations: cloneJson(contract.sourceGenerations),
  };
}

function readyWal(contract) {
  return {
    ...beginWal(contract),
    phase: 'ready',
    events: cloneJson(contract.events),
    nextCursor: cloneJson(contract.nextCursor),
  };
}

function sourceGenerationReservations(cursor) {
  return Object.fromEntries(Object.keys(cursor.sources).sort().map((sourceKey) => [sourceKey, cursor.sources[sourceKey].generation]));
}

function sameScalarObject(left, right) {
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return same(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key]);
}

function sameJsonStructure(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonStructure(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return same(leftKeys, rightKeys)
    && leftKeys.every((key) => sameJsonStructure(left[key], right[key]));
}

function reverseJsonObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseJsonObjectKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(
    ([key, child]) => [key, reverseJsonObjectKeys(child)],
  ));
}

function assertSourceGenerationReservations(sourceGenerations) {
  if (!isObject(sourceGenerations)) throw new Error('store source generation reservation invalid');
  const reservedEntries = Object.entries(sourceGenerations);
  if (reservedEntries.some(([sourceKey, generation]) => sourceKey.length === 0
    || typeof generation !== 'string'
    || generation.length === 0
    || !policy.sourceGenerations.includes(generation))) {
    throw new Error('store source generation reservation invalid');
  }
  if (new Set(reservedEntries.map(([, generation]) => generation)).size !== reservedEntries.length) {
    throw new Error('store source generation reservation is not unique');
  }
  return reservedEntries;
}

function assertBeginWalRecoverable(batch) {
  assertExactObject(batch, ['phase', 'schemaVersion', 'adapterId', 'batchId', 'baseCursorRevision', 'sourceGenerations'], 'store begin WAL');
  if (batch.phase !== 'begin'
    || batch.schemaVersion !== canonicalStoreRecoveryContract.schemaVersion
    || !protocol.eventAgents.includes(batch.adapterId)
    || typeof batch.batchId !== 'string'
    || batch.batchId.length === 0
    || !safeCounter(batch.baseCursorRevision)
    || batch.baseCursorRevision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('store begin WAL invalid');
  }
  assertSourceGenerationReservations(batch.sourceGenerations);
}

function assertCommittedMarkerAtRevision(marker, revision, adapterId) {
  if (revision === 0) {
    if (marker !== null) throw new Error('store zero revision marker invalid');
    return;
  }
  assertExactObject(marker, ['adapterId', 'batchId', 'baseCursorRevision', 'committedCursorRevision'], 'store committed batch marker');
  if (marker.adapterId !== adapterId
    || typeof marker.batchId !== 'string'
    || marker.batchId.length === 0
    || !safeCounter(marker.baseCursorRevision)
    || marker.baseCursorRevision >= Number.MAX_SAFE_INTEGER
    || marker.committedCursorRevision !== marker.baseCursorRevision + 1
    || marker.committedCursorRevision !== revision) {
    throw new Error('store committed batch marker invalid');
  }
}

function assertLoadedStoreState(state, adapterId) {
  assertExactObject(state, ['wal', 'events', 'cursorEnvelope', 'commitCount'], 'store recovery state');
  if (!protocol.eventAgents.includes(adapterId) || !isObject(state.events) || !safeCounter(state.commitCount)) {
    throw new Error('store recovery state invalid');
  }
  assertExactObject(state.cursorEnvelope, ['revision', 'lastCommittedBatch', 'cursor'], 'store cursor envelope');
  if (!safeCounter(state.cursorEnvelope.revision)) throw new Error('store cursor envelope invalid');
  assertPublicCursor(state.cursorEnvelope.cursor);
  assertCommittedMarkerAtRevision(state.cursorEnvelope.lastCommittedBatch, state.cursorEnvelope.revision, adapterId);

  for (const [key, stored] of Object.entries(state.events)) {
    assertExactObject(stored, ['identity', 'usage'], 'store durable event');
    const errors = [];
    validateEventIdentity(stored.identity, `store-durable-event:${key}:identity`, errors);
    validateEvent(stored.usage, adapterId === 'claude-code', `store-durable-event:${key}:usage`, errors);
    if (errors.length > 0) throw new Error('store durable event invalid');
    if (eventStorageKey(adapterId, stored) !== key) throw new Error('store durable event storage key mismatch');
  }
}

function assertReadyWalRecoverable(state, batch) {
  assertExactObject(batch, ['phase', 'schemaVersion', 'adapterId', 'batchId', 'baseCursorRevision', 'sourceGenerations', 'events', 'nextCursor'], 'store ready WAL');
  if (batch.phase !== 'ready'
    || batch.schemaVersion !== canonicalStoreRecoveryContract.schemaVersion
    || !protocol.eventAgents.includes(batch.adapterId)
    || typeof batch.batchId !== 'string'
    || batch.batchId.length === 0
    || !safeCounter(batch.baseCursorRevision)
    || batch.baseCursorRevision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(batch.events)) {
    throw new Error('store ready WAL invalid');
  }
  assertLoadedStoreState(state, batch.adapterId);
  assertPublicCursor(batch.nextCursor);

  const applied = preparedBatchApplied(state, batch);
  if (!applied && state.cursorEnvelope.revision !== batch.baseCursorRevision) {
    throw new Error('store ready batch cursor revision invalid');
  }

  const reservedEntries = assertSourceGenerationReservations(batch.sourceGenerations);
  if (JSON.stringify(reservedEntries.sort())
    !== JSON.stringify(Object.entries(sourceGenerationReservations(batch.nextCursor)).sort())) {
    throw new Error('store source generation reservation does not match next cursor');
  }
  for (const sourceKey of Object.keys(state.cursorEnvelope.cursor.sources)) {
    if (!Object.hasOwn(batch.nextCursor.sources, sourceKey)) throw new Error('store source deletion is unsupported');
  }

  const reserved = new Set(Object.values(batch.sourceGenerations));
  const eventKeys = new Set();
  for (const [index, event] of batch.events.entries()) {
    assertExactObject(event, ['identity', 'usage'], 'store ready WAL event');
    const errors = [];
    validateEventIdentity(event.identity, `store-ready-event:${index}:identity`, errors);
    validateEvent(event.usage, batch.adapterId === 'claude-code', `store-ready-event:${index}:usage`, errors);
    if (errors.length > 0) throw new Error('store ready WAL event invalid');
    if (!reserved.has(event.identity.sourceGeneration)) throw new Error('store event generation was not durably reserved');
    const key = eventStorageKey(batch.adapterId, event);
    if (eventKeys.has(key)) throw new Error('store ready WAL event identity duplicated');
    eventKeys.add(key);
    const hasStored = Object.hasOwn(state.events, key);
    if (hasStored && (!sameScalarObject(state.events[key].identity, event.identity)
      || !sameScalarObject(state.events[key].usage, event.usage))) {
      throw new Error('store event identity conflict');
    }
    if (applied && !hasStored) throw new Error('store applied batch is missing a durable event');
  }
}

function preparedBatchApplied(state, batch) {
  const expectedMarker = committedBatchMarker(batch);
  if (!sameScalarObject(state.cursorEnvelope.lastCommittedBatch, expectedMarker)) return false;
  if (state.cursorEnvelope.revision !== expectedMarker.committedCursorRevision
    || !sameJsonStructure(state.cursorEnvelope.cursor, batch.nextCursor)) {
    throw new Error('store applied batch marker does not match cursor');
  }
  return true;
}

function assertStoreCursorDoesNotLead(state, contract) {
  if (state.cursorEnvelope.revision === contract.baseCursorRevision) return;
  for (const event of contract.events) {
    const key = eventStorageKey(contract.adapterId, event);
    if (!Object.hasOwn(state.events, key) || !sameScalarObject(state.events[key].usage, event.usage)) {
      throw new Error('store cursor advanced before durable events');
    }
  }
}

function durableBeginBatch(state, contract) {
  const batch = beginWal(contract);
  assertBeginWalRecoverable(batch);
  assertLoadedStoreState(state, batch.adapterId);
  committedBatchMarker(contract);
  if (state.wal !== null || state.cursorEnvelope.revision !== contract.baseCursorRevision) throw new Error('store batch begin state invalid');
  state.wal = batch;
}

function durableReadyBatch(state, contract) {
  assertBeginWalRecoverable(state.wal);
  const expectedBegin = beginWal(contract);
  assertBeginWalRecoverable(expectedBegin);
  if (!sameJsonStructure(state.wal, expectedBegin)) {
    throw new Error('store batch reservation changed during recovery');
  }
  const batch = readyWal(contract);
  assertReadyWalRecoverable(state, batch);
  state.wal = batch;
}

function appendPreparedEvents(state, limit = Number.POSITIVE_INFINITY) {
  if (state.wal?.phase !== 'ready') throw new Error('store batch is not ready');
  for (const event of state.wal.events.slice(0, limit)) {
    const key = eventStorageKey(state.wal.adapterId, event);
    const hasStored = Object.hasOwn(state.events, key);
    if (hasStored && !sameScalarObject(state.events[key].usage, event.usage)) throw new Error('store event identity conflict');
    if (!hasStored) state.events[key] = cloneJson(event);
  }
}

function replacePreparedCursor(state) {
  if (state.wal?.phase !== 'ready') throw new Error('store batch is not ready');
  for (const event of state.wal.events) {
    const key = eventStorageKey(state.wal.adapterId, event);
    if (!Object.hasOwn(state.events, key) || !sameScalarObject(state.events[key].usage, event.usage)) {
      throw new Error('store cursor advanced before durable events');
    }
  }
  if (preparedBatchApplied(state, state.wal)) return;
  if (state.cursorEnvelope.revision !== state.wal.baseCursorRevision) throw new Error('store cursor revision conflict');
  state.cursorEnvelope = {
    revision: state.wal.baseCursorRevision + 1,
    lastCommittedBatch: committedBatchMarker(state.wal),
    cursor: cloneJson(state.wal.nextCursor),
  };
  assertPublicCursor(state.cursorEnvelope.cursor);
}

function durableCommitBatch(state) {
  if (state.wal?.phase !== 'ready' || !preparedBatchApplied(state, state.wal)) throw new Error('store batch commit state invalid');
  state.wal = null;
  state.commitCount += 1;
}

function recoverPreparedBatch(state, contract) {
  if (state.wal === null) {
    const batch = readyWal(contract);
    assertBeginWalRecoverable(beginWal(contract));
    assertReadyWalRecoverable(state, batch);
    if (preparedBatchApplied(state, batch)) return;
    durableBeginBatch(state, contract);
  }
  if (state.wal.phase === 'begin') durableReadyBatch(state, contract);
  assertReadyWalRecoverable(state, state.wal);
  appendPreparedEvents(state);
  replacePreparedCursor(state);
  durableCommitBatch(state);
}

function expectRecoveryRejectionWithoutMutation(state, contract, expectedMessage, label) {
  const before = cloneJson(state);
  let rejected = false;
  try {
    recoverPreparedBatch(state, contract);
  } catch (error) {
    rejected = error.message === expectedMessage;
  }
  assertCondition(rejected, label);
  assertEqual(state, before, `${label} preserves state`);
}

function expectReadyRecoveryRejectionWithoutMutation(state, expectedMessage, label) {
  expectRecoveryRejectionWithoutMutation(state, undefined, expectedMessage, label);
}

function expectReadyRecoverySuccess(state, label) {
  let succeeded = true;
  try {
    recoverPreparedBatch(state);
  } catch {
    succeeded = false;
  }
  assertCondition(succeeded, label);
}

function injectStoreCrashPoint(state, contract, crashPoint) {
  if (!contract.crashPoints.includes(crashPoint)) throw new Error('store crash point invalid');
  if (crashPoint === 'before-durable-begin') return;
  durableBeginBatch(state, contract);
  if (crashPoint === 'after-durable-begin') return;
  durableReadyBatch(state, contract);
  if (crashPoint === 'after-durable-ready') return;
  appendPreparedEvents(state, crashPoint === 'after-first-event' ? 1 : Number.POSITIVE_INFINITY);
  if (crashPoint === 'after-first-event') return;
  if (crashPoint === 'after-all-events') return;
  replacePreparedCursor(state);
  if (crashPoint === 'after-cursor-replace') return;
  if (crashPoint !== 'after-durable-commit') throw new Error('store crash point invalid');
  durableCommitBatch(state);
}

function expectedPreRecoveryState(contract, crashPoint) {
  const summary = contract.expected.preRecoveryStates[crashPoint];
  const expected = createStoreRecoveryState();
  if (summary.walPhase === 'begin') expected.wal = beginWal(contract);
  else if (summary.walPhase === 'ready') expected.wal = readyWal(contract);
  else if (summary.walPhase !== null) throw new Error('store pre-recovery WAL phase invalid');
  for (const event of contract.events.slice(0, summary.durableEventCount)) {
    expected.events[eventStorageKey(contract.adapterId, event)] = cloneJson(event);
  }
  expected.cursorEnvelope.revision = summary.cursorRevision;
  expected.cursorEnvelope.lastCommittedBatch = cloneJson(summary.lastCommittedBatch);
  if (summary.cursorRevision === contract.baseCursorRevision + 1) expected.cursorEnvelope.cursor = cloneJson(contract.nextCursor);
  else if (summary.cursorRevision !== contract.baseCursorRevision) throw new Error('store pre-recovery cursor revision invalid');
  expected.commitCount = summary.commitCount;
  return expected;
}

function validateStoreRecoveryContract() {
  const contract = canonicalStoreRecoveryContract;
  assertCondition(JSON.stringify(contract.events[0].usage) === JSON.stringify(contract.events[1].usage), 'store equal-payload evidence');
  assertCondition(eventStorageKey(contract.adapterId, contract.events[0]) !== eventStorageKey(contract.adapterId, contract.events[1]), 'store identity-key evidence');
  assertEqual(Object.keys(contract.expected.preRecoveryStates), contract.crashPoints, 'store crash point state inventory');
  assertEqual(contract.expected.lastCommittedBatch, committedBatchMarker(contract), 'store committed batch marker contract');

  const premature = createStoreRecoveryState();
  durableBeginBatch(premature, contract);
  durableReadyBatch(premature, contract);
  let prematureRejected = false;
  try {
    replacePreparedCursor(premature);
  } catch (error) {
    prematureRejected = error.message === 'store cursor advanced before durable events';
  }
  assertCondition(prematureRejected, 'store cursor waits for every durable event');

  const directReadyEventfulState = createStoreRecoveryState();
  directReadyEventfulState.wal = readyWal(contract);
  recoverPreparedBatch(directReadyEventfulState);
  assertEqual(Object.keys(directReadyEventfulState.events).length, contract.events.length, 'store direct-ready eventful event count');
  assertEqual(directReadyEventfulState.cursorEnvelope.cursor, contract.nextCursor, 'store direct-ready eventful cursor');
  assertEqual(directReadyEventfulState.cursorEnvelope.lastCommittedBatch, committedBatchMarker(contract), 'store direct-ready eventful marker');
  assertEqual(directReadyEventfulState.commitCount, 1, 'store direct-ready eventful commit');

  for (const crashPoint of contract.crashPoints) {
    let state = createStoreRecoveryState();
    injectStoreCrashPoint(state, contract, crashPoint);
    assertEqual(state, expectedPreRecoveryState(contract, crashPoint), `store pre-recovery state ${crashPoint}`);
    assertStoreCursorDoesNotLead(state, contract);
    state = cloneJson(state);
    recoverPreparedBatch(state, contract);
    assertStoreCursorDoesNotLead(state, contract);
    assertEqual(Object.keys(state.events).length, contract.expected.eventCount, `store recovery event count ${crashPoint}`);
    assertEqual(state.cursorEnvelope.revision, contract.expected.cursorRevision, `store recovery cursor revision ${crashPoint}`);
    assertEqual(state.cursorEnvelope.lastCommittedBatch, contract.expected.lastCommittedBatch, `store recovery batch identity ${crashPoint}`);
    assertEqual(state.commitCount, contract.expected.commitCount, `store recovery commit count ${crashPoint}`);
    assertEqual(state.cursorEnvelope.cursor, contract.nextCursor, `store recovery cursor ${crashPoint}`);
  }

  const conflict = createStoreRecoveryState();
  durableBeginBatch(conflict, contract);
  durableReadyBatch(conflict, contract);
  const conflicting = cloneJson(contract.events[0]);
  conflicting.usage.inputTokens += 1;
  conflict.events[eventStorageKey(contract.adapterId, conflicting)] = conflicting;
  let rejected = false;
  try {
    recoverPreparedBatch(conflict, contract);
  } catch (error) {
    rejected = error.message === 'store event identity conflict';
  }
  assertCondition(rejected, 'store rejects same identity with different usage');

  const zeroEvent = cloneJson(contract);
  zeroEvent.batchId = 'batch-synthetic-zero-event';
  zeroEvent.events = [];
  const zeroEventState = createStoreRecoveryState();
  recoverPreparedBatch(zeroEventState, zeroEvent);
  assertEqual(Object.keys(zeroEventState.events), [], 'store zero-event batch has no durable events');
  assertEqual(zeroEventState.cursorEnvelope.revision, 1, 'store zero-event batch advances cursor');
  assertEqual(zeroEventState.cursorEnvelope.lastCommittedBatch, committedBatchMarker(zeroEvent), 'store zero-event batch marker');

  const directReadyZeroEventState = createStoreRecoveryState();
  directReadyZeroEventState.wal = readyWal(zeroEvent);
  recoverPreparedBatch(directReadyZeroEventState);
  assertEqual(Object.keys(directReadyZeroEventState.events), [], 'store direct-ready zero-event has no durable events');
  assertEqual(directReadyZeroEventState.cursorEnvelope.cursor, zeroEvent.nextCursor, 'store direct-ready zero-event cursor');
  assertEqual(directReadyZeroEventState.cursorEnvelope.lastCommittedBatch, committedBatchMarker(zeroEvent), 'store direct-ready zero-event marker');
  assertEqual(directReadyZeroEventState.commitCount, 1, 'store direct-ready zero-event commit');

  const reorderedAppliedState = createStoreRecoveryState();
  injectStoreCrashPoint(reorderedAppliedState, contract, 'after-cursor-replace');
  const appliedMarker = reorderedAppliedState.cursorEnvelope.lastCommittedBatch;
  reorderedAppliedState.cursorEnvelope.lastCommittedBatch = {
    committedCursorRevision: appliedMarker.committedCursorRevision,
    baseCursorRevision: appliedMarker.baseCursorRevision,
    batchId: appliedMarker.batchId,
    adapterId: appliedMarker.adapterId,
  };
  expectReadyRecoverySuccess(reorderedAppliedState, 'store reordered applied marker is order-independent');
  assertEqual(reorderedAppliedState.commitCount, 1, 'store reordered applied marker commits');

  const reorderedAppliedCursorState = createStoreRecoveryState();
  injectStoreCrashPoint(reorderedAppliedCursorState, contract, 'after-cursor-replace');
  reorderedAppliedCursorState.cursorEnvelope.cursor = reverseJsonObjectKeys(
    reorderedAppliedCursorState.cursorEnvelope.cursor,
  );
  assertCondition(
    JSON.stringify(reorderedAppliedCursorState.cursorEnvelope.cursor) !== JSON.stringify(contract.nextCursor)
      && sameJsonStructure(reorderedAppliedCursorState.cursorEnvelope.cursor, contract.nextCursor),
    'store reordered eventful cursor evidence',
  );
  expectReadyRecoverySuccess(reorderedAppliedCursorState, 'store reordered eventful applied cursor is order-independent');
  assertEqual(reorderedAppliedCursorState.commitCount, 1, 'store reordered eventful applied cursor commits');

  const reorderedZeroEventCursorState = createStoreRecoveryState();
  injectStoreCrashPoint(reorderedZeroEventCursorState, zeroEvent, 'after-cursor-replace');
  reorderedZeroEventCursorState.cursorEnvelope.cursor = reverseJsonObjectKeys(
    reorderedZeroEventCursorState.cursorEnvelope.cursor,
  );
  assertCondition(
    JSON.stringify(reorderedZeroEventCursorState.cursorEnvelope.cursor) !== JSON.stringify(zeroEvent.nextCursor)
      && sameJsonStructure(reorderedZeroEventCursorState.cursorEnvelope.cursor, zeroEvent.nextCursor),
    'store reordered zero-event cursor evidence',
  );
  expectReadyRecoverySuccess(reorderedZeroEventCursorState, 'store reordered zero-event applied cursor is order-independent');
  assertEqual(reorderedZeroEventCursorState.commitCount, 1, 'store reordered zero-event applied cursor commits');

  const multiSourceContract = cloneJson(zeroEvent);
  multiSourceContract.batchId = 'batch-synthetic-multi-source';
  multiSourceContract.sourceGenerations['store-source-b'] = 'source-generation-b';
  multiSourceContract.nextCursor.sources['store-source-b'] = {
    generation: 'source-generation-b', mtimeMs: 6000, size: 0, offset: 0, recordOrdinal: 0,
  };
  const multiSourceState = createStoreRecoveryState();
  durableBeginBatch(multiSourceState, multiSourceContract);
  const reorderedMultiSourceContract = cloneJson(multiSourceContract);
  reorderedMultiSourceContract.sourceGenerations = Object.fromEntries(
    Object.entries(reorderedMultiSourceContract.sourceGenerations).reverse(),
  );
  assertCondition(
    JSON.stringify(multiSourceState.wal.sourceGenerations) !== JSON.stringify(reorderedMultiSourceContract.sourceGenerations)
      && sameJsonStructure(multiSourceState.wal.sourceGenerations, reorderedMultiSourceContract.sourceGenerations),
    'store reordered multi-source reservation evidence',
  );
  durableReadyBatch(multiSourceState, reorderedMultiSourceContract);
  recoverPreparedBatch(multiSourceState, reorderedMultiSourceContract);
  assertEqual(multiSourceState.commitCount, 1, 'store reordered multi-source reservation commits');

  const nextZeroEvent = cloneJson(zeroEvent);
  nextZeroEvent.batchId = 'batch-synthetic-next-zero';
  nextZeroEvent.baseCursorRevision = 1;
  nextZeroEvent.nextCursor.sources['store-source-a'] = {
    generation: 'source-generation-a', mtimeMs: 7000, size: 30, offset: 30, recordOrdinal: 3,
  };
  const stateWithPriorMarker = () => {
    const state = createStoreRecoveryState();
    recoverPreparedBatch(state, contract);
    state.wal = readyWal(nextZeroEvent);
    return state;
  };
  const reorderedPriorState = stateWithPriorMarker();
  const priorMarker = reorderedPriorState.cursorEnvelope.lastCommittedBatch;
  reorderedPriorState.cursorEnvelope.lastCommittedBatch = {
    committedCursorRevision: priorMarker.committedCursorRevision,
    baseCursorRevision: priorMarker.baseCursorRevision,
    batchId: priorMarker.batchId,
    adapterId: priorMarker.adapterId,
  };
  expectReadyRecoverySuccess(reorderedPriorState, 'store reordered prior marker is order-independent');
  assertEqual(reorderedPriorState.cursorEnvelope.revision, 2, 'store reordered prior marker permits next batch');
  assertEqual(reorderedPriorState.commitCount, 2, 'store reordered prior marker next commit count');

  const initialMarkerState = createStoreRecoveryState();
  initialMarkerState.wal = readyWal(contract);
  initialMarkerState.cursorEnvelope.lastCommittedBatch = {
    adapterId: 'codex', batchId: 'batch-synthetic-impossible', baseCursorRevision: 0, committedCursorRevision: 1,
  };
  expectReadyRecoveryRejectionWithoutMutation(initialMarkerState, 'store zero revision marker invalid', 'store eventful ready rejects marker at revision zero');

  const hiddenPriorMarkerState = stateWithPriorMarker();
  hiddenPriorMarkerState.cursorEnvelope.lastCommittedBatch.hidden = true;
  expectReadyRecoveryRejectionWithoutMutation(hiddenPriorMarkerState, 'store committed batch marker invalid', 'store zero-event ready rejects hidden prior marker');

  const nullPriorMarkerState = stateWithPriorMarker();
  nullPriorMarkerState.cursorEnvelope.lastCommittedBatch = null;
  expectReadyRecoveryRejectionWithoutMutation(nullPriorMarkerState, 'store committed batch marker invalid', 'store zero-event ready rejects missing prior marker');

  const baseMismatchPriorMarkerState = stateWithPriorMarker();
  baseMismatchPriorMarkerState.cursorEnvelope.lastCommittedBatch.baseCursorRevision = 1;
  expectReadyRecoveryRejectionWithoutMutation(baseMismatchPriorMarkerState, 'store committed batch marker invalid', 'store zero-event ready rejects prior marker base mismatch');

  const revisionMismatchPriorMarkerState = stateWithPriorMarker();
  revisionMismatchPriorMarkerState.cursorEnvelope.lastCommittedBatch.baseCursorRevision = 1;
  revisionMismatchPriorMarkerState.cursorEnvelope.lastCommittedBatch.committedCursorRevision = 2;
  expectReadyRecoveryRejectionWithoutMutation(revisionMismatchPriorMarkerState, 'store committed batch marker invalid', 'store zero-event ready rejects prior marker revision mismatch');

  const adapterMismatchPriorMarkerState = stateWithPriorMarker();
  adapterMismatchPriorMarkerState.cursorEnvelope.lastCommittedBatch.adapterId = 'claude-code';
  expectReadyRecoveryRejectionWithoutMutation(adapterMismatchPriorMarkerState, 'store committed batch marker invalid', 'store zero-event ready rejects prior marker adapter mismatch');

  const hiddenBeginState = createStoreRecoveryState();
  durableBeginBatch(hiddenBeginState, contract);
  hiddenBeginState.wal.hidden = true;
  expectRecoveryRejectionWithoutMutation(hiddenBeginState, contract, 'store begin WAL invalid', 'store rejects hidden begin WAL state');

  const missingBeginState = createStoreRecoveryState();
  durableBeginBatch(missingBeginState, contract);
  delete missingBeginState.wal.schemaVersion;
  expectRecoveryRejectionWithoutMutation(missingBeginState, contract, 'store begin WAL invalid', 'store rejects missing begin WAL state');

  const invalidFreshBatchId = cloneJson(contract);
  invalidFreshBatchId.batchId = '';
  expectRecoveryRejectionWithoutMutation(createStoreRecoveryState(), invalidFreshBatchId, 'store begin WAL invalid', 'store rejects invalid fresh begin before write');

  const invalidFreshCursor = cloneJson(contract);
  invalidFreshCursor.nextCursor.sources['store-source-a'].offset += 1;
  expectRecoveryRejectionWithoutMutation(createStoreRecoveryState(), invalidFreshCursor, 'source cursor state invalid', 'store preflights fresh ready contract before begin write');

  const hiddenReadyState = createStoreRecoveryState();
  hiddenReadyState.wal = readyWal(contract);
  hiddenReadyState.wal.hidden = true;
  expectReadyRecoveryRejectionWithoutMutation(hiddenReadyState, 'store ready WAL invalid', 'store direct-ready rejects hidden WAL state');

  const hiddenReadyEventState = createStoreRecoveryState();
  hiddenReadyEventState.wal = readyWal(contract);
  hiddenReadyEventState.wal.events[0].hidden = true;
  expectReadyRecoveryRejectionWithoutMutation(hiddenReadyEventState, 'store ready WAL event invalid', 'store direct-ready rejects hidden event state');

  const storedEventKey = eventStorageKey(contract.adapterId, contract.events[0]);
  const storedEventState = (stored) => {
    const state = createStoreRecoveryState();
    state.wal = readyWal(contract);
    state.events[storedEventKey] = stored;
    return state;
  };
  const hiddenStoredEvent = cloneJson(contract.events[0]);
  hiddenStoredEvent.hidden = true;
  expectReadyRecoveryRejectionWithoutMutation(storedEventState(hiddenStoredEvent), 'store durable event invalid', 'store rejects hidden durable event envelope');
  expectReadyRecoveryRejectionWithoutMutation(storedEventState({ usage: cloneJson(contract.events[0].usage) }), 'store durable event invalid', 'store rejects durable event without identity');
  const invalidStoredSchema = cloneJson(contract.events[0]);
  invalidStoredSchema.identity.recordOrdinal = -1;
  const invalidStoredSchemaState = createStoreRecoveryState();
  invalidStoredSchemaState.wal = readyWal(contract);
  invalidStoredSchemaState.events[eventStorageKey(contract.adapterId, invalidStoredSchema)] = invalidStoredSchema;
  expectReadyRecoveryRejectionWithoutMutation(invalidStoredSchemaState, 'store durable event invalid', 'store rejects invalid durable event schema');
  expectReadyRecoveryRejectionWithoutMutation(storedEventState(null), 'store durable event invalid', 'store rejects null durable event');
  const mismatchedStoredIdentity = cloneJson(contract.events[0]);
  mismatchedStoredIdentity.identity.recordOrdinal = 9;
  expectReadyRecoveryRejectionWithoutMutation(storedEventState(mismatchedStoredIdentity), 'store durable event storage key mismatch', 'store rejects durable event key mismatch');

  const lateConflictReadyState = createStoreRecoveryState();
  lateConflictReadyState.wal = readyWal(contract);
  const lateConflictingEvent = cloneJson(contract.events[1]);
  lateConflictingEvent.usage.inputTokens += 1;
  lateConflictReadyState.events[eventStorageKey(contract.adapterId, lateConflictingEvent)] = lateConflictingEvent;
  expectReadyRecoveryRejectionWithoutMutation(lateConflictReadyState, 'store event identity conflict', 'store direct-ready preflights every event');

  const invalidReadyCursorState = createStoreRecoveryState();
  invalidReadyCursorState.wal = readyWal(contract);
  invalidReadyCursorState.wal.nextCursor.sources['store-source-a'].offset = 21;
  expectReadyRecoveryRejectionWithoutMutation(invalidReadyCursorState, 'source cursor state invalid', 'store direct-ready rejects invalid next cursor');

  const readyRevisionConflictState = createStoreRecoveryState();
  readyRevisionConflictState.wal = readyWal(contract);
  readyRevisionConflictState.cursorEnvelope.revision = 1;
  readyRevisionConflictState.cursorEnvelope.lastCommittedBatch = {
    adapterId: 'codex', batchId: 'batch-synthetic-prior', baseCursorRevision: 0, committedCursorRevision: 1,
  };
  expectReadyRecoveryRejectionWithoutMutation(readyRevisionConflictState, 'store ready batch cursor revision invalid', 'store direct-ready rejects cursor revision conflict');

  const readySourceDeletionState = createStoreRecoveryState();
  readySourceDeletionState.cursorEnvelope.cursor.sources['store-source-old'] = {
    generation: 'source-generation-b', mtimeMs: 5000, size: 10, offset: 10, recordOrdinal: 1,
  };
  readySourceDeletionState.wal = readyWal(contract);
  expectReadyRecoveryRejectionWithoutMutation(readySourceDeletionState, 'store source deletion is unsupported', 'store direct-ready rejects source deletion');

  const readyEventReservationState = createStoreRecoveryState();
  readyEventReservationState.wal = readyWal(contract);
  readyEventReservationState.wal.events[0].identity.sourceGeneration = 'source-generation-b';
  expectReadyRecoveryRejectionWithoutMutation(readyEventReservationState, 'store event generation was not durably reserved', 'store direct-ready rejects unreserved event');

  const readyZeroReservationState = createStoreRecoveryState();
  readyZeroReservationState.wal = readyWal(zeroEvent);
  readyZeroReservationState.wal.sourceGenerations['store-source-a'] = 'source-generation-b';
  expectReadyRecoveryRejectionWithoutMutation(readyZeroReservationState, 'store source generation reservation does not match next cursor', 'store direct-ready rejects zero-event reservation mismatch');

  const readyDuplicateReservationState = createStoreRecoveryState();
  readyDuplicateReservationState.wal = readyWal(zeroEvent);
  readyDuplicateReservationState.wal.sourceGenerations['store-source-b'] = 'source-generation-a';
  readyDuplicateReservationState.wal.nextCursor.sources['store-source-b'] = {
    generation: 'source-generation-a', mtimeMs: 6000, size: 0, offset: 0, recordOrdinal: 0,
  };
  expectReadyRecoveryRejectionWithoutMutation(readyDuplicateReservationState, 'store source generation reservation is not unique', 'store direct-ready rejects duplicate reservation');

  const mismatchedSource = cloneJson(zeroEvent);
  mismatchedSource.nextCursor.sources['store-source-a'].generation = 'source-generation-b';
  const mismatchedSourceState = createStoreRecoveryState();
  durableBeginBatch(mismatchedSourceState, mismatchedSource);
  let sourceMismatchRejected = false;
  try {
    durableReadyBatch(mismatchedSourceState, mismatchedSource);
  } catch (error) {
    sourceMismatchRejected = error.message === 'store source generation reservation does not match next cursor';
  }
  assertCondition(sourceMismatchRejected, 'store binds source reservation to next cursor');

  const unreservedEvent = cloneJson(contract);
  unreservedEvent.events[0].identity.sourceGeneration = 'source-generation-b';
  const unreservedEventState = createStoreRecoveryState();
  durableBeginBatch(unreservedEventState, unreservedEvent);
  let unreservedEventRejected = false;
  try {
    durableReadyBatch(unreservedEventState, unreservedEvent);
  } catch (error) {
    unreservedEventRejected = error.message === 'store event generation was not durably reserved';
  }
  assertCondition(unreservedEventRejected, 'store rejects unreserved event generation');

  const duplicateGeneration = cloneJson(zeroEvent);
  duplicateGeneration.sourceGenerations['store-source-b'] = 'source-generation-a';
  duplicateGeneration.nextCursor.sources['store-source-b'] = { generation: 'source-generation-a', mtimeMs: 6000, size: 0, offset: 0, recordOrdinal: 0 };
  const duplicateGenerationState = createStoreRecoveryState();
  const duplicateGenerationBefore = cloneJson(duplicateGenerationState);
  let duplicateGenerationRejected = false;
  try {
    durableBeginBatch(duplicateGenerationState, duplicateGeneration);
  } catch (error) {
    duplicateGenerationRejected = error.message === 'store source generation reservation is not unique';
  }
  assertCondition(duplicateGenerationRejected, 'store rejects duplicate source generation reservations');
  assertEqual(duplicateGenerationState, duplicateGenerationBefore, 'store rejects duplicate source generation reservations before write');

  const reusedState = createStoreRecoveryState();
  recoverPreparedBatch(reusedState, contract);
  const reusedBatchId = cloneJson(zeroEvent);
  reusedBatchId.batchId = contract.batchId;
  reusedBatchId.baseCursorRevision = 1;
  reusedBatchId.nextCursor.sources['store-source-a'] = { generation: 'source-generation-a', mtimeMs: 7000, size: 30, offset: 30, recordOrdinal: 3 };
  recoverPreparedBatch(reusedState, reusedBatchId);
  assertEqual(reusedState.cursorEnvelope.revision, 2, 'store repeated batch id advances a new revision');
  assertEqual(reusedState.cursorEnvelope.lastCommittedBatch, committedBatchMarker(reusedBatchId), 'store repeated batch id uses revision-bound marker');
  assertEqual(reusedState.commitCount, 2, 'store repeated batch id commits a second transaction');

  const corruptAppliedState = createStoreRecoveryState();
  recoverPreparedBatch(corruptAppliedState, contract);
  corruptAppliedState.cursorEnvelope.cursor.sources['store-source-a'].offset -= 1;
  const corruptAppliedBefore = cloneJson(corruptAppliedState);
  let corruptAppliedRejected = false;
  try {
    recoverPreparedBatch(corruptAppliedState, contract);
  } catch (error) {
    corruptAppliedRejected = error.message === 'store applied batch marker does not match cursor';
  }
  assertCondition(corruptAppliedRejected, 'store rejects applied marker with different cursor');
  assertEqual(corruptAppliedState, corruptAppliedBefore, 'store rejects applied marker with different cursor before write');

  const arrayOrderContract = cloneJson(contract);
  arrayOrderContract.batchId = 'batch-synthetic-array-order';
  arrayOrderContract.nextCursor.codexSessions['session-codex-a'] = {
    baseline: [11, 3, 7, 2],
    latestModel: 'gpt-synthetic-a',
    frontier: { sourceOrder: 0, recordOrdinal: 2 },
  };
  const arrayOrderState = createStoreRecoveryState();
  injectStoreCrashPoint(arrayOrderState, arrayOrderContract, 'after-cursor-replace');
  const swappedBaseline = arrayOrderState.cursorEnvelope.cursor.codexSessions['session-codex-a'].baseline;
  [swappedBaseline[0], swappedBaseline[2]] = [swappedBaseline[2], swappedBaseline[0]];
  expectReadyRecoveryRejectionWithoutMutation(
    arrayOrderState,
    'store applied batch marker does not match cursor',
    'store rejects applied cursor with reordered Codex baseline tuple',
  );
}

validateContracts();
validateDiscriminatorMatrix();
validateStreamingInvariantMatrix();
validateSourceCursorContract();
validatePublicCursorContract();
validateStoreRecoveryContract();
validateCrossSourcePendingCoverage();

const claudeExpected = JSON.parse(fixtureTexts.get('claude-code/expected.json'));
const codexExpected = JSON.parse(fixtureTexts.get('codex-cli/expected.json'));
const claudeExpectedByFixture = new Map(claudeExpected.cases.map((testCase) => [testCase.fixture, testCase]));
const codexExpectedByFixture = new Map(codexExpected.cases.map((testCase) => [testCase.fixture, testCase]));
let eventCount = 0;

function expectedScannedEvents(expected) {
  return expected.events.map((usage, index) => ({ identity: expected.eventIdentities[index], usage }));
}

let claudeCursor = createCursor();
const claudeReplayEntries = new Map();
const allEventIdentities = new Set();
for (const entry of manifest.replayPlan['claude-code']) {
  const expected = claudeExpectedByFixture.get(entry.fixture);
  let crossSourceCollisionCount = 0;
  if (entry.collisionAgainst) {
    const prior = claudeReplayEntries.get(entry.collisionAgainst);
    assertCondition(prior !== undefined && prior.sourceKey !== entry.sourceKey, `Claude ${entry.fixture} collision source`);
    const priorIdentities = claudeCallIdentities(entry.collisionAgainst);
    const currentIdentities = claudeCallIdentities(entry.fixture);
    crossSourceCollisionCount = [...currentIdentities].filter((identity) => priorIdentities.has(identity)).length;
    assertCondition(crossSourceCollisionCount > 0, `Claude ${entry.fixture} full tuple collision`);
  }
  const actual = parseClaude(entry, claudeCursor, crossSourceCollisionCount);
  assertEqual(actual.scanResult.events, expectedScannedEvents(expected), `Claude ${entry.fixture} scanned events`);
  assertEqual(actual.state, expected.state, `Claude ${entry.fixture} state`);
  assertEqual(actual.ignored, expected.ignored, `Claude ${entry.fixture} ignored`);
  assertEqual(actual.scanResult.diagnostics, expected.diagnostics, `Claude ${entry.fixture} diagnostics`);
  assertEqual(actual.scanResult.coverage, expected.coverage, `Claude ${entry.fixture} coverage`);
  assertEqual(actual.cursorEvidence, expected.cursorEvidence, `Claude ${entry.fixture} cursor evidence`);
  for (const event of actual.scanResult.events) {
    const identity = JSON.stringify(event.identity);
    assertCondition(!allEventIdentities.has(identity), `Claude ${entry.fixture} unique event identity`);
    allEventIdentities.add(identity);
  }
  claudeReplayEntries.set(entry.fixture, entry);
  eventCount += actual.scanResult.events.length;
  claudeCursor = roundTripCursor(actual.scanResult.cursor);
}

const matrixEvents = claudeExpectedByFixture.get('discriminator-matrix.jsonl');
assertCondition(new Set(matrixEvents.events.map((event) => JSON.stringify(event))).size < matrixEvents.events.length, 'Claude equal-value event evidence');
assertEqual(new Set(matrixEvents.eventIdentities.map((identity) => JSON.stringify(identity))).size, matrixEvents.eventIdentities.length, 'Claude distinct storage identities');

let codexCursor = createCursor();
let positiveCacheEvidence = false;
let positiveReasoningEvidence = false;
let derivedInputExcludesCacheRead = true;
let derivedReasoningIsIncludedInOutput = true;
const completedCodexFixtures = new Set();
for (const entry of manifest.replayPlan['codex-cli']) {
  if (entry.continuesSessionFrom) {
    assertCondition(completedCodexFixtures.has(entry.continuesSessionFrom), `Codex ${entry.fixture} continuation order`);
    const hasLocalModelRefresh = readLines(`codex-cli/${entry.fixture}`).some((line) => {
      try { return JSON.parse(line).type === 'turn_context'; } catch { return false; }
    });
    if (entry.kind === 'codex-resume') assertCondition(!hasLocalModelRefresh, `Codex ${entry.fixture} model persistence`);
    if (entry.kind === 'codex-stale') assertCondition(hasLocalModelRefresh, `Codex ${entry.fixture} stale model guard`);
  }
  if (entry.continuesSessionsFrom) {
    assertCondition(entry.continuesSessionsFrom.every((fixture) => completedCodexFixtures.has(fixture)), `Codex ${entry.fixture} continuation order`);
  }
  const expected = codexExpectedByFixture.get(entry.fixture);
  const actual = parseCodex(entry, codexCursor);
  assertEqual(actual.scanResult.events, expectedScannedEvents(expected), `Codex ${entry.fixture} scanned events`);
  assertEqual(actual.componentDeltas, expected.componentDeltas, `Codex ${entry.fixture} component deltas`);
  assertEqual(actual.transitionDecisions, expected.transitionDecisions, `Codex ${entry.fixture} transitions`);
  assertEqual(actual.state, expected.state, `Codex ${entry.fixture} state`);
  assertEqual(actual.ignored, expected.ignored, `Codex ${entry.fixture} ignored`);
  assertEqual(actual.scanResult.diagnostics, expected.diagnostics, `Codex ${entry.fixture} diagnostics`);
  assertEqual(actual.scanResult.coverage, expected.coverage, `Codex ${entry.fixture} coverage`);
  assertEqual(actual.cursorEvidence, expected.cursorEvidence, `Codex ${entry.fixture} cursor evidence`);
  for (const event of actual.scanResult.events) {
    const identity = JSON.stringify(event.identity);
    assertCondition(!allEventIdentities.has(identity), `Codex ${entry.fixture} unique event identity`);
    allEventIdentities.add(identity);
  }
  for (const [index, delta] of actual.componentDeltas.entries()) {
    const event = actual.scanResult.events[index].usage;
    positiveCacheEvidence ||= delta[1] > 0;
    positiveReasoningEvidence ||= delta[3] > 0;
    derivedInputExcludesCacheRead &&= event.inputTokens === delta[0] - delta[1] && event.cacheReadTokens === delta[1];
    derivedReasoningIsIncludedInOutput &&= event.outputTokens === delta[2] && delta[3] <= event.outputTokens;
  }
  eventCount += actual.scanResult.events.length;
  completedCodexFixtures.add(entry.fixture);
  codexCursor = roundTripCursor(actual.scanResult.cursor);
}

assertCondition(positiveCacheEvidence, 'Codex positive cache evidence');
assertCondition(positiveReasoningEvidence, 'Codex positive reasoning evidence');
assertEqual(derivedInputExcludesCacheRead, codexExpected.inputExcludesCacheRead, 'Codex input cache root contract');
assertEqual(derivedReasoningIsIncludedInOutput, codexExpected.reasoningIsIncludedInOutput, 'Codex reasoning root contract');

console.log(JSON.stringify({
  status: 'pass',
  artifacts: manifest.dataFiles.length,
  cases: claudeExpected.cases.length + codexExpected.cases.length,
  events: eventCount,
  cursorScenarios: manifest.sourceCursorContract.scenarios.length,
  recoveryScenarios: manifest.storeRecoveryContract.crashPoints.length,
}));
