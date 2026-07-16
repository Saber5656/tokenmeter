import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('privacy validator does not accept a root argument');

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

function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(decoded)) throw new Error('fixture tree contains binary control data');
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

const texts = readPinnedFixtureTree();

const canonicalProtocol = {
  jsonlTypes: ['assistant', 'future-event', 'session_meta', 'turn_context', 'event_msg'],
  payloadTypes: ['token_count', 'future_event'],
  roles: ['assistant'],
  stopReasons: ['end_turn', 'tool_use', null],
  eventAgents: ['claude-code', 'codex'],
  caseFixtures: ['streaming.jsonl', 'malformed.jsonl', 'pending-inherited-noop.jsonl', 'pending-continuation.jsonl', 'terminal-duplicate.jsonl', 'rejected-continuation.jsonl', 'discriminator-matrix.jsonl', 'streaming-invariant-matrix.jsonl', 'cumulative.jsonl', 'resume.jsonl', 'reset.jsonl', 'resume-boundaries.jsonl', 'stale.jsonl', 'metadata-only.jsonl'],
  caseKinds: ['claude-streaming', 'claude-malformed-pending', 'claude-pending-inherited-noop', 'claude-pending-continuation', 'claude-terminal-duplicate', 'claude-rejected-continuation', 'claude-discriminator-matrix', 'claude-streaming-invariant-matrix', 'codex-cumulative', 'codex-resume', 'codex-reset', 'codex-resume-boundaries', 'codex-stale', 'codex-metadata-only'],
  claudeCallDiscriminators: ['sourceKey', 'sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain'],
  transitionDecisions: ['first-component-delta', 'first-zero-baseline-no-emit', 'resumed-session-component-delta', 'component-duplicate-no-emit', 'component-decrease-rebase-no-emit', 'zero-reset-rebase-no-emit', 'component-delta', 'component-delta-last-usage-missing', 'component-delta-last-usage-malformed', 'decrease-without-last-rebase-no-emit', 'invalid-delta-baseline-unchanged', 'invalid-snapshot-baseline-unchanged', 'stale-snapshot-no-emit'],
  unknownFieldNames: ['future_usage_detail', 'future_field'],
  coverageValues: ['complete', 'pending', 'partial'],
  diagnosticCodes: ['malformed-row', 'invalid-usage', 'claude-call-conflict', 'pending-call', 'codex-reset-rebase', 'codex-last-usage-mismatch', 'model-unavailable', 'codex-stale-source', 'source-discontinuity'],
  intentionalInvalidJsonRow: '{this-is-intentionally-invalid-json',
  intentionalInvalidJsonLocations: ['claude-code/malformed.jsonl:1', 'codex-cli/cumulative.jsonl:5'],
  intentionalNegativeCounters: [{ location: 'claude-code/malformed.jsonl:5:$.message.usage.input_tokens', value: -1 }],
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

const canonicalDiagnosticCoverageMap = {
  skippedRecords: ['malformed-row', 'invalid-usage', 'claude-call-conflict', 'codex-stale-source'],
  rebasedTransitions: ['codex-reset-rebase'],
  sourceDiscontinuities: ['source-discontinuity'],
  modelUnavailableEvents: ['model-unavailable'],
};

const manifest = JSON.parse(texts.get('manifest.json'));
if (!manifest
  || typeof manifest !== 'object'
  || Array.isArray(manifest)
  || !same(Object.keys(manifest).sort(), [...canonicalManifestRootKeys].sort())) {
  throw new Error('manifest:root-schema');
}
if (manifest.sourcePolicy !== canonicalManifestSourcePolicy) throw new Error('manifest:source-policy');
if (JSON.stringify(manifest.allowedProtocolValues) !== JSON.stringify(canonicalProtocol)) throw new Error('canonical protocol domain mismatch');
if (JSON.stringify(manifest.syntheticValuePolicy) !== JSON.stringify(canonicalSyntheticPolicy)) throw new Error('canonical synthetic policy mismatch');
if (JSON.stringify(manifest.jsonlObjectFields) !== JSON.stringify(canonicalJsonlObjectFields)) throw new Error('canonical JSONL object field grammar mismatch');
if (JSON.stringify(manifest.expectedObjectFields) !== JSON.stringify(canonicalExpectedObjectFields)) throw new Error('canonical expected object field grammar mismatch');
if (JSON.stringify(manifest.diagnosticCoverageMap) !== JSON.stringify(canonicalDiagnosticCoverageMap)) throw new Error('canonical diagnostic coverage map mismatch');
const policy = canonicalSyntheticPolicy;
if (!same([...manifest.inventory.directories].sort(), [...fixedDirectories].sort())
  || !same([...manifest.inventory.files].sort(), [...fixedFiles].sort())) {
  throw new Error('fixture manifest inventory mismatch');
}

const rules = [
  ['email', new RegExp('\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b', 'i')],
  ['url-or-remote', new RegExp('(?:ht' + 'tps?:\\/\\/|ss' + 'h:\\/\\/|gi' + 't@[^\\s:]+:)', 'i')],
  ['uuid', new RegExp('\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b', 'i')],
  ['ulid', new RegExp('\\b[0-7][0-9A-HJKMNP-TV-Z]{25}\\b', 'i')],
  ['long-hex', new RegExp('\\b[0-9a-f]{32,}\\b', 'i')],
  ['secret-shape', new RegExp('(?:s' + 'k-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|AK' + 'IA[0-9A-Z]{16}|xo' + 'x[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)')],
  ['secret-shape', new RegExp(['\\bBear', 'er\\s+[A-Za-z0-9._~+/-]{12,}'].join(''), 'i')],
  ['jwt', new RegExp('\\be' + 'yJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b')],
];
const fullTimestamp = new RegExp('\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})\\b', 'g');

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}

const MIN_HIGH_ENTROPY_TOKEN_LENGTH = 32;
const highEntropyToken = new RegExp(`[A-Za-z0-9+/_=-]{${MIN_HIGH_ENTROPY_TOKEN_LENGTH},}`, 'g');

function hasHighEntropyToken(line) {
  for (const token of line.match(highEntropyToken) ?? []) {
    if (entropy(token) >= 4) return true;
  }
  return false;
}

const exactFileTokens = new Set([
  ...fixedFiles.map((relative) => path.basename(relative)),
  'unexpected.synthetic',
]);
const schemaDottedTokens = new Set([
  'message.id', 'message.model', 'payload.model', 'turn_context.payload.model', 'session_meta.payload.model_provider',
  'fs.renameSync', 'fs.symlinkSync', 'fs.writeFileSync', 'Object.values', 'result.codexSessions',
  'Object.fromEntries', 'Object.entries', 'cursor.claudeCalls', 'state.status', 'Buffer.from',
  'Object.keys', 'value.sort', 'keys.sort', 'state.baseline', 'state.frontier', 'tuple.join',
  'ignored.lastUsageMissing', 'ignored.lastUsageMalformed', 'diagnostic.affectedRecords', 'evidence.code',
  'cursor.diagnosticTotals', 'cursor.coverageTotals.sourceDiscontinuities', 'event.identity.sourceGeneration',
  'event.identity.recordOrdinal', 'event.identity.subIndex', 'event.usage', 'stored.usage',
  'contract.sourceGenerations', 'state.wal.batchId', 'codeDomain.replaceAll',
  'JSON.stringify', 'cursor.coverageTotals', 'contract.batchId',
  'coverage.pendingCalls', 'contract.schemaVersion',
  'observation.completeRecords', 'previous.recordOrdinal', 'existing.model', 'value.message.model',
  'existing.inputTokens', 'existing.cacheWriteTokens', 'existing.cacheReadTokens', 'existing.maxOutputTokens',
  'state.wal', 'state.commitCount', 'state.cursorEnvelope.lastCommittedBatch', 'state.cursorEnvelope.revision',
  'state.cursorEnvelope.cursor', 'expectedMarker.committedCursorRevision', 'batch.nextCursor', 'batch.batchId',
  'state.wal.sourceGenerations', 'contract.nextCursor', 'reservedEntries.length', 'contract.events',
  'reservedEntries.map', 'reservedEntries.sort', 'reserved.has', 'contract.events.some', 'Object.hasOwn',
  'batch.baseCursorRevision', 'batch.nextCursor.sources',
  'state.events', 'event.identity', 'event.usage', 'errors.length',
  'marker.adapterId', 'marker.baseCursorRevision', 'marker.committedCursorRevision',
  'state.pendingAsiBoundary', 'state.pendingExpressionBoundary', 'pendingConstruct.isValue',
  'segment.surface', 'segment.value', 'segment.flags', 'rest.match', 'flags.includes',
  'state.expectOperand', 'state.atStatementStart', 'state.lastToken', 'frame.kind',
  'frame.pendingDirectKey', 'frame.propertyModifier',
  'state.lineTerminatedAsync', 'state.pendingAsyncStatementStart', 'left.every', 'right.some', 'controlHeadKeywords.has',
  'bindingDeclarationKeywords.has',
]);
const sensitiveKeyNames = new Set([
  ['authoriz', 'ation'].join(''),
  ['coo', 'kie'].join(''),
  ['pass', 'word'].join(''),
  ['api', 'key'].join(''),
  ['access', 'token'].join(''),
  ['refresh', 'token'].join(''),
  ['client', 'secret'].join(''),
  ['private', 'key'].join(''),
]);
function normalizePrivatePayloadKey(value) {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

const privatePayloadKeys = new Set([
  'content', 'text', 'prompt', 'messages', 'instructions', 'tool_use', 'tool_result', 'arguments', 'command',
  'stdout', 'stderr', 'cwd', 'home', 'origin_url', 'repository', 'account_id', 'organization_id', 'reasoning',
].map(normalizePrivatePayloadKey));
const codePrivatePayloadKeys = new Set([
  'content', 'text', 'prompt', 'messages', 'instructions', 'tool_use', 'tool_result', 'arguments', 'command',
  'stdout', 'stderr', 'reasoning',
].map(normalizePrivatePayloadKey));

const unicodeCodePointEscape = new RegExp(['\\\\', 'u\\{([0-9a-f]{1,6})\\}'].join(''), 'gi');
const unicodeCodeUnitEscape = new RegExp(['\\\\', 'u([0-9a-f]{4})'].join(''), 'gi');
const hexadecimalEscape = new RegExp(['\\\\', 'x([0-9a-f]{2})'].join(''), 'gi');
const quotedJsonKeyCandidate = new RegExp([
  '"', '((?:', '\\\\.', '|[^"', '\\\\', '])*)', '"', '\\s*:',
].join(''), 'g');

function decodeJavaScriptEscapes(value) {
  let decoded = value
    .replace(unicodeCodePointEscape, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(unicodeCodeUnitEscape, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(hexadecimalEscape, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
  for (const character of ['\\', "'", '"', '`', '.', '/', ':', '$']) decoded = decoded.replaceAll(`\\${character}`, character);
  return decoded;
}

function hasPrivatePayloadKeyName(value) {
  for (const match of value.matchAll(quotedJsonKeyCandidate)) {
    let decoded;
    try {
      decoded = JSON.parse(`"${match[1]}"`);
    } catch {
      decoded = decodeJavaScriptEscapes(match[1]);
    }
    if (privatePayloadKeys.has(normalizePrivatePayloadKey(decoded))) return true;
  }
  return false;
}

function decodeRegexPrivacySurface(value, flags) {
  const unicodeMode = flags.includes('u') || flags.includes('v');
  let decoded = '';
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '\\') {
      decoded += value[index];
      index += 1;
      continue;
    }

    const slashStart = index;
    while (value[index] === '\\') index += 1;
    const slashCount = index - slashStart;
    decoded += '\\'.repeat(slashCount - (slashCount % 2));
    if (slashCount % 2 === 0) continue;
    if (index >= value.length) {
      decoded += '\\';
      break;
    }

    const rest = value.slice(index);
    let match = rest.match(/^x([0-9a-f]{2})/i);
    if (match) {
      decoded += Number.parseInt(match[1], 16) === 46 ? '.' : '\\' + match[0];
      index += match[0].length;
      continue;
    }
    match = rest.match(/^u([0-9a-f]{4})/i);
    if (match) {
      decoded += Number.parseInt(match[1], 16) === 46 ? '.' : '\\' + match[0];
      index += match[0].length;
      continue;
    }
    match = unicodeMode ? rest.match(/^u\{([0-9a-f]{1,6})\}/i) : null;
    if (match) {
      decoded += Number.parseInt(match[1], 16) === 46 ? '.' : '\\' + match[0];
      index += match[0].length;
      continue;
    }
    match = unicodeMode ? null : rest.match(/^([0-7]{1,3})/);
    if (match) {
      decoded += Number.parseInt(match[1], 8) === 46 ? '.' : '\\' + match[0];
      index += match[0].length;
      continue;
    }
    if (rest[0] === '.') {
      decoded += '.';
      index += 1;
      continue;
    }
    decoded += '\\' + rest[0];
    index += 1;
  }
  return decoded;
}

function canonicalizeRegexPrivacySurface(value) {
  return value.replaceAll('[.]', '.');
}

const MAX_JAVASCRIPT_SURFACE_DEPTH = 32;
const controlHeadKeywords = new Set(['if', 'while', 'for', 'with', 'switch', 'catch']);
const statementBodyKeywords = new Set(['else', 'do']);
const restrictedAsiKeywords = new Set(['break', 'continue', 'debugger']);
const caseLabelKeywords = new Set(['case', 'default']);
const propertyModifierKeywords = new Set(['get', 'set', 'async']);
const bindingDeclarationKeywords = new Set(['const', 'let', 'var']);
const expressionPrefixKeywords = new Set([
  'return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'yield', 'await', 'new',
]);
const expressionOperators = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '&&=', '||=', '??=',
  '+', '-', '*', '%', '**', '&', '|', '^', '&&', '||', '??', '==', '!=', '===', '!==',
  '<', '>', '<=', '>=', '<<', '>>', '>>>', '!', '~', '?', ':', ',', ';', '(', '[', 'return', 'throw', 'case',
]);
const multiCharacterOperators = [
  '>>>=', '===', '!==', '**=', '&&=', '||=', '??=', '>>>', '=>', '++', '--', '&&', '||', '??', '==', '!=',
  '<=', '>=', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '?.', '...',
];
const javaScriptIdentifierToken = /^(?:[A-Za-z_$]|\\u(?:[0-9a-f]{4}|\{[0-9a-f]{1,6}\}))(?:[A-Za-z0-9_$]|\\u(?:[0-9a-f]{4}|\{[0-9a-f]{1,6}\}))*/i;

function createJavaScriptSyntaxState() {
  return {
    expectOperand: true,
    atStatementStart: true,
    lastToken: null,
    lastIdentifierWasStatementStart: false,
    pendingAsiBoundary: false,
    pendingExpressionBoundary: false,
    pendingAsyncStatementStart: null,
    lineTerminatedAsync: false,
    pendingConstruct: null,
    caseLabel: false,
    parenStack: [],
    bracketDepth: 0,
    braceStack: [],
  };
}

function isDirectPropertyFrame(frame) {
  return frame?.kind === 'object' || frame?.kind === 'binding-object';
}

function currentPropertyFrame(state) {
  const frame = state.braceStack.at(-1);
  if (!isDirectPropertyFrame(frame)
    || state.parenStack.length !== frame.parenDepth
    || state.bracketDepth !== frame.bracketDepth) return null;
  return frame;
}

function recordDirectPropertyCandidate(state, value, line, allowModifier = false) {
  const frame = currentPropertyFrame(state);
  if (!frame?.atPropertyStart) return null;
  const decoded = decodeJavaScriptEscapes(value);
  if (allowModifier && propertyModifierKeywords.has(decoded) && frame.propertyModifier === null) {
    frame.propertyModifier = decoded;
    return 'modifier';
  }
  frame.pendingDirectKey = { value, line };
  frame.atPropertyStart = false;
  return 'key';
}

function emitPendingDirectProperty(frame, add) {
  if (!frame?.pendingDirectKey) return;
  add('code-property-key', frame.pendingDirectKey.line, frame.pendingDirectKey.value);
  frame.pendingDirectKey = null;
}

function markJavaScriptValue(state) {
  state.expectOperand = false;
  state.atStatementStart = false;
  state.lastToken = 'value';
  state.lastIdentifierWasStatementStart = false;
  state.pendingAsiBoundary = false;
  state.pendingExpressionBoundary = false;
  state.pendingAsyncStatementStart = null;
  state.lineTerminatedAsync = false;
}

function consumeJavaScriptBare(value, state, line, add) {
  let index = 0;
  while (index < value.length) {
    const rest = value.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const identifier = rest.match(javaScriptIdentifierToken);
    if (identifier) {
      const rawToken = identifier[0];
      const token = decodeJavaScriptEscapes(rawToken);
      if (state.pendingExpressionBoundary) state.pendingExpressionBoundary = false;
      if (state.pendingAsiBoundary) {
        state.expectOperand = false;
        state.atStatementStart = false;
        state.lastToken = 'asi-label';
        index += rawToken.length;
        continue;
      }
      const propertyKind = recordDirectPropertyCandidate(state, rawToken, line, true);
      if (propertyKind) {
        state.expectOperand = propertyKind === 'modifier';
        state.atStatementStart = false;
        state.lastToken = propertyKind === 'modifier' ? 'property-modifier' : 'property-key';
        state.lastIdentifierWasStatementStart = false;
        index += rawToken.length;
        continue;
      }
      if (state.lastToken === '.' || state.lastToken === '?.') {
        markJavaScriptValue(state);
        index += rawToken.length;
        continue;
      }
      const previousToken = state.lastToken;
      const wasStatementStart = state.atStatementStart;
      const lineTerminatedAsync = state.lineTerminatedAsync;
      state.lineTerminatedAsync = false;
      const asyncStatementStart = state.pendingAsyncStatementStart;
      state.pendingAsyncStatementStart = null;
      if (token === 'default' && previousToken === 'export') {
        state.expectOperand = true;
        state.atStatementStart = false;
        state.lastToken = 'export-default';
        state.lastIdentifierWasStatementStart = false;
        index += rawToken.length;
        continue;
      }
      if (token === 'async') {
        state.pendingAsyncStatementStart = wasStatementStart || previousToken === 'export-default';
        state.expectOperand = false;
        state.atStatementStart = false;
        state.lastToken = token;
        state.lastIdentifierWasStatementStart = wasStatementStart;
        index += rawToken.length;
        continue;
      }
      if (token === 'function' || token === 'class') {
        const constructStatementStart = wasStatementStart
          || lineTerminatedAsync
          || previousToken === 'export-default';
        state.pendingConstruct = {
          type: token,
          isValue: token === 'function' && asyncStatementStart !== null
            ? !asyncStatementStart
            : !constructStatementStart,
          baseParenDepth: state.parenStack.length,
          parameterDepth: null,
          bodyReady: token === 'class',
        };
        state.expectOperand = false;
        state.atStatementStart = false;
        state.lastToken = token;
        state.lastIdentifierWasStatementStart = false;
        index += rawToken.length;
        continue;
      }
      if (token === 'await' && previousToken === 'for') {
        state.expectOperand = true;
        state.atStatementStart = false;
        state.lastToken = 'for-await';
        state.lastIdentifierWasStatementStart = false;
        index += rawToken.length;
        continue;
      }
      if (controlHeadKeywords.has(token)) {
        state.expectOperand = true;
        state.atStatementStart = false;
      } else if (statementBodyKeywords.has(token)) {
        state.expectOperand = true;
        state.atStatementStart = true;
      } else if (restrictedAsiKeywords.has(token)) {
        state.expectOperand = false;
        state.atStatementStart = false;
        state.pendingAsiBoundary = true;
      } else if (caseLabelKeywords.has(token)) {
        state.expectOperand = token === 'case';
        state.atStatementStart = false;
        state.caseLabel = true;
      } else {
        state.expectOperand = expressionPrefixKeywords.has(token);
        state.atStatementStart = false;
        state.pendingExpressionBoundary = token === 'return' || token === 'yield';
      }
      state.lastToken = token;
      state.lastIdentifierWasStatementStart = wasStatementStart;
      index += rawToken.length;
      continue;
    }
    const number = rest.match(/^\d+(?:\.\d+)?/);
    if (number) {
      markJavaScriptValue(state);
      index += number[0].length;
      continue;
    }
    const operator = multiCharacterOperators.find((candidate) => rest.startsWith(candidate)) ?? value[index];
    index += operator.length;
    state.pendingExpressionBoundary = false;
    state.pendingAsyncStatementStart = null;
    state.lineTerminatedAsync = false;

    if (operator === '(') {
      const frame = currentPropertyFrame(state);
      if (frame?.pendingDirectKey) {
        emitPendingDirectProperty(frame, add);
        frame.propertyModifier = null;
      }
      const pendingFunction = state.pendingConstruct?.type === 'function'
        && state.pendingConstruct.parameterDepth === null
        && state.parenStack.length === state.pendingConstruct.baseParenDepth;
      const opensControlHead = controlHeadKeywords.has(state.lastToken) || state.lastToken === 'for-await';
      state.parenStack.push(opensControlHead ? 'control' : 'group');
      if (pendingFunction) state.pendingConstruct.parameterDepth = state.parenStack.length;
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = '(';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === ')') {
      const closingDepth = state.parenStack.length;
      const kind = state.parenStack.pop() ?? 'group';
      if (state.pendingConstruct?.type === 'function'
        && state.pendingConstruct.parameterDepth === closingDepth) {
        state.pendingConstruct.bodyReady = true;
      }
      state.expectOperand = kind === 'control';
      state.atStatementStart = kind === 'control';
      state.lastToken = kind === 'control' ? 'control-close' : ')';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '[') {
      const frame = currentPropertyFrame(state);
      if (frame?.atPropertyStart) {
        frame.atPropertyStart = false;
        frame.pendingDirectKey = null;
        frame.propertyModifier = null;
      }
      state.bracketDepth += 1;
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = '[';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === ']') {
      state.bracketDepth = Math.max(0, state.bracketDepth - 1);
      state.expectOperand = false;
      state.atStatementStart = false;
      state.lastToken = ']';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '{') {
      const pendingConstruct = state.pendingConstruct;
      const opensConstruct = pendingConstruct
        && state.parenStack.length === pendingConstruct.baseParenDepth
        && (pendingConstruct.type === 'class' || pendingConstruct.bodyReady);
      let kind;
      if (state.lastToken === '=>') kind = 'value-block';
      else if (state.lastToken === 'catch') kind = 'block';
      else if (opensConstruct) kind = pendingConstruct.isValue ? 'value-block' : 'block';
      else if (bindingDeclarationKeywords.has(state.lastToken)) kind = 'binding-object';
      else kind = state.expectOperand && !state.atStatementStart ? 'object' : 'block';
      if (opensConstruct) state.pendingConstruct = null;
      const propertyBearing = kind === 'object' || kind === 'binding-object';
      state.braceStack.push({
        kind,
        parenDepth: state.parenStack.length,
        bracketDepth: state.bracketDepth,
        atPropertyStart: propertyBearing,
        pendingDirectKey: null,
        propertyModifier: null,
      });
      state.expectOperand = true;
      state.atStatementStart = !propertyBearing;
      state.lastToken = '{';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '}') {
      const frame = state.braceStack.at(-1);
      if (isDirectPropertyFrame(frame)) emitPendingDirectProperty(frame, add);
      state.braceStack.pop();
      if (isDirectPropertyFrame(frame) || frame?.kind === 'value-block') markJavaScriptValue(state);
      else {
        state.expectOperand = true;
        state.atStatementStart = true;
        state.lastToken = '}';
        state.lastIdentifierWasStatementStart = false;
        state.pendingAsiBoundary = false;
      }
      continue;
    }
    if (operator === ':') {
      const frame = currentPropertyFrame(state);
      emitPendingDirectProperty(frame, add);
      if (frame) {
        frame.atPropertyStart = false;
        frame.propertyModifier = null;
      }
      state.expectOperand = true;
      if (state.caseLabel) {
        state.atStatementStart = true;
        state.lastToken = 'case-colon';
      } else if (!frame && state.lastIdentifierWasStatementStart) {
        state.atStatementStart = true;
        state.lastToken = 'label-colon';
      } else {
        state.atStatementStart = false;
        state.lastToken = ':';
      }
      state.caseLabel = false;
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === ',') {
      const frame = currentPropertyFrame(state);
      if (frame) {
        emitPendingDirectProperty(frame, add);
        frame.atPropertyStart = true;
        frame.pendingDirectKey = null;
        frame.propertyModifier = null;
      }
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = ',';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === ';') {
      state.expectOperand = true;
      state.atStatementStart = true;
      state.lastToken = ';';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      state.caseLabel = false;
      continue;
    }
    if (operator === '++' || operator === '--') {
      state.expectOperand = false;
      state.atStatementStart = false;
      state.lastToken = operator;
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '=>') {
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = '=>';
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '.' || operator === '?.') {
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = operator;
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    if (operator === '...') {
      const frame = currentPropertyFrame(state);
      if (frame?.atPropertyStart) {
        frame.atPropertyStart = false;
        frame.propertyModifier = null;
      }
      state.expectOperand = true;
      state.atStatementStart = false;
      state.lastToken = operator;
      state.lastIdentifierWasStatementStart = false;
      state.pendingAsiBoundary = false;
      continue;
    }
    state.expectOperand = expressionOperators.has(operator) || operator === '/';
    state.atStatementStart = false;
    state.lastToken = operator;
    state.lastIdentifierWasStatementStart = false;
    state.pendingAsiBoundary = false;
  }
}

function finishJavaScriptLine(state) {
  if (state.pendingAsyncStatementStart !== null) {
    state.pendingAsyncStatementStart = null;
    state.lineTerminatedAsync = true;
  }
  if (!state.pendingAsiBoundary && !state.pendingExpressionBoundary) return;
  state.expectOperand = true;
  state.atStatementStart = true;
  state.lastToken = 'asi-boundary';
  state.lastIdentifierWasStatementStart = false;
  state.pendingAsiBoundary = false;
  state.pendingExpressionBoundary = false;
  state.pendingAsyncStatementStart = null;
}

function extractJavaScriptSurfaces(text, lineOffset = 0, depth = 0) {
  if (depth > MAX_JAVASCRIPT_SURFACE_DEPTH) throw new Error('javascript lexical surface nesting exceeded');
  const surfaces = [];
  const lines = text.split('\n');
  let inBlockComment = false;
  const syntaxState = createJavaScriptSyntaxState();
  const add = (surface, line, value, flags = '') => {
    if (value.length > 0) surfaces.push({ surface, line, value, flags });
  };

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineOffset + lineIndex + 1;
    let index = 0;
    let bare = '';
    const flushBare = () => {
      consumeJavaScriptBare(bare, syntaxState, lineNumber, add);
      add('code-bare', lineNumber, bare);
      bare = '';
    };
    while (index < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', index);
        if (end === -1) {
          add('code-comment', lineNumber, line.slice(index));
          index = line.length;
          continue;
        }
        add('code-comment', lineNumber, line.slice(index, end));
        inBlockComment = false;
        index = end + 2;
        continue;
      }
      if (line.startsWith('//', index)) {
        flushBare();
        add('code-comment', lineNumber, line.slice(index + 2));
        index = line.length;
        continue;
      }
      if (line.startsWith('/*', index)) {
        flushBare();
        const end = line.indexOf('*/', index + 2);
        if (end === -1) {
          add('code-comment', lineNumber, line.slice(index + 2));
          inBlockComment = true;
          index = line.length;
          continue;
        }
        add('code-comment', lineNumber, line.slice(index + 2, end));
        index = end + 2;
        continue;
      }
      const quote = line[index];
      if (quote === '"' || quote === "'") {
        flushBare();
        let value = '';
        let escaped = false;
        let closed = false;
        for (index += 1; index < line.length; index += 1) {
          const character = line[index];
          if (escaped) {
            value += `\\${character}`;
            escaped = false;
          } else if (character === '\\') escaped = true;
          else if (character === quote) {
            closed = true;
            index += 1;
            break;
          } else value += character;
        }
        if (!closed) throw new Error('javascript lexical surface invalid');
        add('code-string', lineNumber, value);
        recordDirectPropertyCandidate(syntaxState, value, lineNumber);
        markJavaScriptValue(syntaxState);
        continue;
      }
      if (quote === '`') {
        flushBare();
        let staticValue = '';
        let expression = '';
        let expressionDepth = 0;
        let escaped = false;
        let closed = false;
        for (index += 1; index < line.length; index += 1) {
          const character = line[index];
          if (escaped) {
            if (expressionDepth === 0) staticValue += `\\${character}`;
            else expression += `\\${character}`;
            escaped = false;
            continue;
          }
          if (character === '\\') {
            escaped = true;
            continue;
          }
          if (expressionDepth === 0 && character === '`') {
            add('code-template', lineNumber, staticValue);
            closed = true;
            index += 1;
            break;
          }
          if (expressionDepth === 0 && character === '$' && line[index + 1] === '{') {
            add('code-template', lineNumber, staticValue);
            staticValue = '';
            expressionDepth = 1;
            index += 1;
            continue;
          }
          if (expressionDepth > 0) {
            if (character === '{') expressionDepth += 1;
            else if (character === '}') {
              expressionDepth -= 1;
              if (expressionDepth === 0) {
                surfaces.push(...extractJavaScriptSurfaces(expression, lineNumber - 1, depth + 1));
                expression = '';
                continue;
              }
            }
            expression += character;
          } else staticValue += character;
        }
        if (!closed || expressionDepth !== 0) throw new Error('javascript lexical surface invalid');
        markJavaScriptValue(syntaxState);
        continue;
      }
      if (quote === '/') {
        flushBare();
        if (syntaxState.expectOperand) {
          let value = '';
          let escaped = false;
          let inClass = false;
          let end = -1;
          for (let cursor = index + 1; cursor < line.length; cursor += 1) {
            const character = line[cursor];
            if (escaped) {
              value += `\\${character}`;
              escaped = false;
            } else if (character === '\\') escaped = true;
            else if (character === '[') {
              inClass = true;
              value += character;
            } else if (character === ']') {
              inClass = false;
              value += character;
            } else if (character === '/' && !inClass) {
              end = cursor;
              break;
            } else value += character;
          }
          if (end !== -1) {
            let flagEnd = end + 1;
            while (/[a-z]/i.test(line[flagEnd] ?? '')) flagEnd += 1;
            add('code-regex', lineNumber, value, line.slice(end + 1, flagEnd));
            markJavaScriptValue(syntaxState);
            index = flagEnd;
            continue;
          }
        }
        bare = '/';
        index += 1;
        continue;
      }
      bare += line[index];
      index += 1;
    }
    flushBare();
    finishJavaScriptLine(syntaxState);
  }
  if (inBlockComment) throw new Error('javascript lexical surface invalid');
  return surfaces;
}

function hasAbsolutePath(value) {
  const posix = /(?:^|[\s"'(=])\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/;
  const home = /(?:^|[\s"'(=])~\/[A-Za-z0-9._-]+/;
  const drive = /(?:^|[\s"'(=])[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)*/;
  const unc = /(?:^|[\s"'(=])\\\\[^\s\\]+\\[^\s\\]+/;
  return posix.test(value) || home.test(value) || drive.test(value) || unc.test(value);
}

function hasIpAddress(value) {
  for (const candidate of value.match(/[0-9A-Fa-f:.]{3,}/g) ?? []) {
    const normalized = candidate.replace(/^[.:]+|[.:]+$/g, '');
    if (isIP(normalized) !== 0) return true;
  }
  return false;
}

function hasDomain(value) {
  for (const match of value.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})\b/gi)) {
    const candidate = match[0];
    if (value.slice(Math.max(0, match.index - 2), match.index) === '$.'
      || exactFileTokens.has(candidate)
      || canonicalProtocol.claudeCallDiscriminators.includes(candidate)
      || schemaDottedTokens.has(candidate)
      || isIP(candidate) !== 0
      || /^\d+(?:\.\d+)+-/.test(candidate)) continue;
    return true;
  }
  return false;
}

function hasSensitiveKeyName(value) {
  for (const match of value.matchAll(/["']?([A-Za-z][A-Za-z0-9_.-]{2,})["']?\s*(?::|=)/g)) {
    const normalized = match[1].replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if ([...sensitiveKeyNames].some((name) => normalized === name || normalized.endsWith(name))) return true;
  }
  return false;
}

function scanSegment(relative, lineNumber, value, surface) {
  for (const [rule, expression] of rules) {
    if (expression.test(value)) report(relative, lineNumber, surface, rule);
  }
  const isCanonicalEscapeRegex = surface.startsWith('code-regex')
    && (value.startsWith('\\\\u') || value.startsWith('\\\\x'))
    && value.includes('0-9a-f');
  if (hasAbsolutePath(value) && !isCanonicalEscapeRegex) report(relative, lineNumber, surface, 'absolute-path');
  if (hasIpAddress(value)) report(relative, lineNumber, surface, 'ip-address');
  if (!surface.startsWith('code-bare') && hasDomain(value)) report(relative, lineNumber, surface, 'hostname-or-domain');
  if (hasPrivatePayloadKeyName(value)) report(relative, lineNumber, surface, 'private-payload-key');
  if (surface.startsWith('code-property-key')
    && codePrivatePayloadKeys.has(normalizePrivatePayloadKey(value))) {
    report(relative, lineNumber, surface, 'private-payload-key');
  }
  if (hasSensitiveKeyName(value)) report(relative, lineNumber, surface, 'secret-key-name');
  for (const match of value.matchAll(fullTimestamp)) {
    if (!match[0].startsWith(policy.timestampPrefix)) report(relative, lineNumber, surface, 'non-synthetic-timestamp');
  }
  fullTimestamp.lastIndex = 0;
  if (hasHighEntropyToken(value)) report(relative, lineNumber, surface, 'high-entropy-string');
}

const violations = [];
const invalidJsonLocations = [];

function report(relative, line, surface, rule) {
  violations.push({ file: relative, line, surface, rule });
}

function walkJson(value, relative, line) {
  if (typeof value === 'string') {
    scanSegment(relative, line, value, 'json-string');
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) walkJson(child, relative, line);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    scanSegment(relative, line, `${JSON.stringify(key)}:`, 'json-key');
    if (privatePayloadKeys.has(normalizePrivatePayloadKey(key))) report(relative, line, 'json-key', 'private-payload-key');
    if (key === 'sessionId' && !policy.sessionIds.includes(child)) report(relative, line, 'json-value', 'session-id-not-allowlisted');
    if (key === 'requestId' && !policy.requestIds.includes(child)) report(relative, line, 'json-value', 'request-id-not-allowlisted');
    if (key === 'agentId' && !policy.agentIds.includes(child)) report(relative, line, 'json-value', 'agent-id-not-allowlisted');
    if (key === 'id' && typeof child === 'string' && !policy.messageIds.includes(child) && !policy.sessionIds.includes(child)) report(relative, line, 'json-value', 'id-not-allowlisted');
    if (key === 'model' && child !== null && !policy.models.includes(child)) report(relative, line, 'json-value', 'model-not-allowlisted');
    if (key === 'sourceKey' && !policy.logicalSources.includes(child)) report(relative, line, 'json-value', 'logical-source-not-allowlisted');
    if ((key === 'sourceGeneration' || key === 'generation') && !policy.sourceGenerations.includes(child)) report(relative, line, 'json-value', 'source-generation-not-allowlisted');
    if ((key === 'project' || key === 'projectDirectoryName') && !policy.projectSlugs.includes(child)) report(relative, line, 'json-value', 'project-not-allowlisted');
    walkJson(child, relative, line);
  }
}

for (const relative of fixedFiles) {
  scanSegment(relative, 0, relative, 'inventory-path');
  const lines = texts.get(relative).split('\n');
  if (relative.endsWith('.mjs')) {
    for (const segment of extractJavaScriptSurfaces(texts.get(relative))) {
      scanSegment(relative, segment.line, segment.value, segment.surface);
      const decoded = segment.surface === 'code-regex'
        ? decodeRegexPrivacySurface(segment.value, segment.flags)
        : decodeJavaScriptEscapes(segment.value);
      if (decoded !== segment.value) scanSegment(relative, segment.line, decoded, `${segment.surface}-decoded`);
      if (segment.surface === 'code-regex') {
        const canonical = canonicalizeRegexPrivacySurface(decoded);
        if (canonical !== decoded) scanSegment(relative, segment.line, canonical, 'code-regex-canonical');
      }
    }
  }
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    if (!relative.endsWith('.mjs')) scanSegment(relative, index + 1, line, 'raw-text');
    if (!relative.endsWith('.jsonl')) continue;
    try {
      walkJson(JSON.parse(line), relative, index + 1);
    } catch {
      invalidJsonLocations.push(`${relative}:${index + 1}`);
    }
  }
  if (relative.endsWith('.json')) {
    try {
      walkJson(JSON.parse(texts.get(relative)), relative, 1);
    } catch {
      report(relative, 1, 'json-document', 'invalid-json-document');
    }
  }
}

if (!same(invalidJsonLocations.sort(), [...canonicalProtocol.intentionalInvalidJsonLocations].sort())) {
  violations.push({ file: '<aggregate>', line: 0, surface: 'aggregate', rule: 'intentional-invalid-json-locations' });
}

console.log(JSON.stringify({
  status: violations.length ? 'fail' : 'pass',
  files: fixedFiles.length,
  intentionalInvalidJsonRows: invalidJsonLocations.length,
  violations,
}, null, 2));
if (violations.length) process.exitCode = 1;
