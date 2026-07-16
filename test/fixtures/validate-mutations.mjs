import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('mutation validator does not accept arguments');

const root = path.dirname(fileURLToPath(import.meta.url));
const temporaryRoot = fs.mkdtempSync(path.join('/', 'tmp', 'tokenmeter-synthetic-fixtures-'));
const results = [];

function runValidator(directory, script) {
  return spawnSync(process.execPath, [path.join(directory, script)], {
    cwd: directory,
    encoding: 'utf8',
    env: {},
  });
}

function requireBaseline(script) {
  const result = runValidator(root, script);
  if (result.status !== 0) throw new Error(`${script} baseline failed`);
}

function expectArgumentRejection(script) {
  const result = spawnSync(process.execPath, [path.join(root, script), 'synthetic-root'], {
    cwd: root,
    encoding: 'utf8',
    env: {},
  });
  if (result.status === 0) throw new Error(`${script} accepted an alternate root`);
  results.push(`${script}-argument-rejection`);
}

function cloneFor(name) {
  const destination = path.join(temporaryRoot, name);
  fs.cpSync(root, destination, { recursive: true, errorOnExist: true });
  return destination;
}

function updateText(directory, relative, transform) {
  const file = path.join(directory, relative);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`mutation ${relative} did not change its synthetic target`);
  fs.writeFileSync(file, after, 'utf8');
}

function updateJson(directory, relative, transform) {
  updateText(directory, relative, (text) => `${JSON.stringify(transform(JSON.parse(text)), null, 2)}\n`);
}

function expectFailure(name, mutate, script = 'validate.mjs', fragment = null) {
  const directory = cloneFor(name);
  mutate(directory);
  const result = runValidator(directory, script);
  if (result.status === 0) throw new Error(`${name} mutation survived`);
  if (fragment && !`${result.stdout}${result.stderr}`.includes(fragment)) {
    throw new Error(`${name} failed for an unexpected reason`);
  }
  results.push(name);
}

function expectSuccess(name, mutate, script = 'validate.mjs') {
  const directory = cloneFor(name);
  mutate(directory);
  const result = runValidator(directory, script);
  if (result.status !== 0) throw new Error(`${name} mutation failed: ${result.stdout}${result.stderr}`);
  results.push(name);
}

function expectPrivacyRule(name, sentinel, expectedRule) {
  const directory = cloneFor(name);
  fs.appendFileSync(path.join(directory, 'README.md'), `\n${sentinel}\n`, 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  if (result.status === 0) throw new Error(`${name} privacy mutation survived`);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${name} privacy mutation did not return structured evidence`);
  }
  if (!payload.violations.some((violation) => violation.rule === expectedRule)) {
    throw new Error(`${name} did not trigger ${expectedRule}`);
  }
  results.push(name);
}

function expectPrivacyCodeRule(name, source, expectedSurface, expectedRule) {
  const directory = cloneFor(name);
  fs.appendFileSync(path.join(directory, 'validate.mjs'), `\n${source}\n`, 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  if (result.status === 0) throw new Error(`${name} code privacy mutation survived`);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${name} code privacy mutation did not return structured evidence`);
  }
  if (!payload.violations.some((violation) => violation.file === 'validate.mjs'
    && violation.surface === expectedSurface
    && violation.rule === expectedRule)) {
    throw new Error(`${name} did not trigger ${expectedSurface}:${expectedRule}`);
  }
  results.push(name);
}

function expectPrivacyPass(name, sentinel) {
  const directory = cloneFor(name);
  fs.appendFileSync(path.join(directory, 'README.md'), `\n${sentinel}\n`, 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  if (result.status !== 0) throw new Error(`${name} privacy boundary was rejected`);
  results.push(name);
}

function expectPrivacyCodePass(name, source) {
  const directory = cloneFor(name);
  fs.appendFileSync(path.join(directory, 'validate.mjs'), `\n${source}\n`, 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  if (result.status !== 0) throw new Error(`${name} code privacy boundary was rejected`);
  results.push(name);
}

function expectPrivacyDetectionGuard(name, mutate, source, expectedSurface, expectedRule) {
  const directory = cloneFor(name);
  mutate(directory);
  fs.appendFileSync(path.join(directory, 'validate.mjs'), '\n' + source + '\n', 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(name + ' guard mutation did not return structured evidence');
  }
  const expected = payload.violations.some((violation) => violation.file === 'validate.mjs'
    && violation.surface === expectedSurface
    && violation.rule === expectedRule);
  if (expected) throw new Error(name + ' guard mutation survived');
  if (payload.violations.length > 0) throw new Error(name + ' guard mutation failed for an unexpected reason');
  results.push(name);
}

function expectPrivacyPassGuard(name, mutate, source, expectedSurface, expectedRule) {
  const directory = cloneFor(name);
  mutate(directory);
  fs.appendFileSync(path.join(directory, 'validate.mjs'), '\n' + source + '\n', 'utf8');
  const result = runValidator(directory, 'validate-privacy.mjs');
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(name + ' pass-guard mutation did not return structured evidence');
  }
  if (!payload.violations.some((violation) => violation.file === 'validate.mjs'
    && violation.surface === expectedSurface
    && violation.rule === expectedRule)) {
    throw new Error(name + ' pass-guard mutation failed for an unexpected reason');
  }
  results.push(name);
}

function expectPrivacyMutationRule(name, mutate, expectedFile, expectedSurface, expectedRule) {
  const directory = cloneFor(name);
  mutate(directory);
  const result = runValidator(directory, 'validate-privacy.mjs');
  if (result.status === 0) throw new Error(`${name} privacy mutation survived`);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${name} privacy mutation did not return structured evidence`);
  }
  if (!payload.violations.some((violation) => violation.file === expectedFile
    && violation.surface === expectedSurface
    && violation.rule === expectedRule)) {
    throw new Error(`${name} did not trigger ${expectedSurface}:${expectedRule}`);
  }
  results.push(name);
}

function unicodeEscape(value) {
  return [...value].map((character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`).join('');
}

const swapMarker = '    // SYNTHETIC_SWAP_POINT';

function expectPinnedParentSwap(name, script) {
  expectFailure(name, (directory) => {
    const replacement = `${directory}-replacement`;
    fs.cpSync(directory, replacement, { recursive: true, errorOnExist: true });
    fs.writeFileSync(path.join(replacement, 'README.md'), Buffer.from([0xc3, 0x28]));
    updateText(directory, script, (text) => text.replace(swapMarker, [
      swapMarker,
      '    const syntheticMovedRoot = `${root}-moved`;',
      '    fs.renameSync(root, syntheticMovedRoot);',
      '    fs.symlinkSync(`${root}-replacement`, root, "dir");',
    ].join('\n')));
  }, script, 'fixture tree changed during pinned read');
}

function expectPinnedFileSwap(name, script) {
  expectFailure(name, (directory) => {
    updateText(directory, script, (text) => text.replace(swapMarker, [
      swapMarker,
      '    const syntheticMovedFile = "README-moved";',
      '    fs.renameSync("README.md", syntheticMovedFile);',
      '    fs.writeFileSync("README.md", Buffer.from([0xc3, 0x28]));',
    ].join('\n')));
  }, script, 'fixture tree changed during pinned read');
}

function expectPinnedHardLink(name, script) {
  expectFailure(name, (directory) => {
    const target = path.join(directory, 'README.md');
    const outside = path.join(temporaryRoot, `${name}-outside-synthetic`);
    fs.copyFileSync(target, outside);
    fs.rmSync(target);
    fs.linkSync(outside, target);
  }, script, 'fixture file ownership boundary invalid');
}

function replaceSyntheticScalar(directory, before, after) {
  let replacements = 0;
  for (const relative of [
    'manifest.json',
    'claude-code/streaming.jsonl',
    'claude-code/malformed.jsonl',
    'claude-code/pending-continuation.jsonl',
    'claude-code/pending-inherited-noop.jsonl',
    'claude-code/terminal-duplicate.jsonl',
    'claude-code/rejected-continuation.jsonl',
    'claude-code/discriminator-matrix.jsonl',
    'claude-code/streaming-invariant-matrix.jsonl',
    'claude-code/expected.json',
    'codex-cli/cumulative.jsonl',
    'codex-cli/metadata-only.jsonl',
    'codex-cli/resume.jsonl',
    'codex-cli/reset.jsonl',
    'codex-cli/resume-boundaries.jsonl',
    'codex-cli/stale.jsonl',
    'codex-cli/expected.json',
  ]) {
    const file = path.join(directory, relative);
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(before)) continue;
    fs.writeFileSync(file, text.replaceAll(before, after), 'utf8');
    replacements += 1;
  }
  if (replacements === 0) throw new Error('joint scalar mutation changed no synthetic fixture');
}

try {
  requireBaseline('validate.mjs');
  requireBaseline('validate-privacy.mjs');
  expectArgumentRejection('validate.mjs');
  expectArgumentRejection('validate-privacy.mjs');

  expectPinnedParentSwap('inventory-parent-swap-semantic', 'validate.mjs');
  expectPinnedParentSwap('inventory-parent-swap-privacy', 'validate-privacy.mjs');
  expectPinnedFileSwap('inventory-file-swap-semantic', 'validate.mjs');
  expectPinnedFileSwap('inventory-file-swap-privacy', 'validate-privacy.mjs');
  expectPinnedHardLink('inventory-hard-link-semantic', 'validate.mjs');
  expectPinnedHardLink('inventory-hard-link-privacy', 'validate-privacy.mjs');

  expectFailure('canonical-session-joint-semantic', (directory) => {
    replaceSyntheticScalar(directory, 'session-claude-a', 'session-synthetic-outsider');
  }, 'validate.mjs', 'canonical synthetic policy mismatch');

  expectFailure('canonical-session-joint-privacy', (directory) => {
    replaceSyntheticScalar(directory, 'session-claude-a', 'session-synthetic-outsider');
  }, 'validate-privacy.mjs', 'canonical synthetic policy mismatch');

  expectFailure('canonical-generation-joint-semantic', (directory) => {
    replaceSyntheticScalar(directory, 'codex-generation-a', 'codex-generation-outsider');
  }, 'validate.mjs', 'canonical synthetic policy mismatch');

  expectFailure('canonical-generation-joint-privacy', (directory) => {
    replaceSyntheticScalar(directory, 'codex-generation-a', 'codex-generation-outsider');
  }, 'validate-privacy.mjs', 'canonical synthetic policy mismatch');

  expectFailure('canonical-protocol-joint-semantic', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.allowedProtocolValues.caseKinds[0] = 'claude-streaming-outsider';
      value.replayPlan['claude-code'][0].kind = 'claude-streaming-outsider';
      return value;
    });
  }, 'validate.mjs', 'canonical protocol domain mismatch');

  expectFailure('canonical-protocol-joint-privacy', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.allowedProtocolValues.caseKinds[0] = 'claude-streaming-outsider';
      value.replayPlan['claude-code'][0].kind = 'claude-streaming-outsider';
      return value;
    });
  }, 'validate-privacy.mjs', 'canonical protocol domain mismatch');

  const addManifestRootKey = (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.syntheticRootNote = 'synthetic prose';
      return value;
    });
  };
  expectFailure('manifest-root-extra-key-semantic', addManifestRootKey, 'validate.mjs', 'manifest:root-schema');
  expectFailure('manifest-root-extra-key-privacy', addManifestRootKey, 'validate-privacy.mjs', 'manifest:root-schema');

  const removeManifestSourcePolicy = (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      delete value.sourcePolicy;
      return value;
    });
  };
  expectFailure('manifest-source-policy-missing-semantic', removeManifestSourcePolicy, 'validate.mjs', 'manifest:root-schema');
  expectFailure('manifest-source-policy-missing-privacy', removeManifestSourcePolicy, 'validate-privacy.mjs', 'manifest:root-schema');

  const changeManifestSourcePolicy = (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.sourcePolicy = 'Synthetic-only prose is permitted.';
      return value;
    });
  };
  expectFailure('manifest-policy-semantic', changeManifestSourcePolicy, 'validate.mjs', 'manifest:source-policy');
  expectFailure('manifest-policy-privacy', changeManifestSourcePolicy, 'validate-privacy.mjs', 'manifest:source-policy');

  const removeCodexTotalTokens = (directory) => updateText(directory, 'codex-cli/cumulative.jsonl', (text) => text
    .replace(',"total_tokens":200120', '')
    .replace(',"total_tokens":30', ''));
  expectSuccess('codex-total-optional-semantic', removeCodexTotalTokens, 'validate.mjs');
  expectSuccess('codex-total-optional-privacy', removeCodexTotalTokens, 'validate-privacy.mjs');

  const nullCodexTotalTokens = (directory) => updateText(directory, 'codex-cli/cumulative.jsonl', (text) => text
    .replace(',"total_tokens":30}}', ',"total_tokens":null}}'));
  expectSuccess('codex-total-malformed-semantic', nullCodexTotalTokens, 'validate.mjs');
  expectSuccess('codex-total-malformed-privacy', nullCodexTotalTokens, 'validate-privacy.mjs');

  const mutateJsonlFieldGrammar = (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.jsonlObjectFields.claudeUsageOptional.push('nickname');
      return value;
    });
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      '"future_usage_detail":{"synthetic":true},"nickname":"synthetic-short"',
    ));
  };
  expectFailure('canonical-jsonl-fields-joint-semantic', mutateJsonlFieldGrammar, 'validate.mjs', 'canonical JSONL object field grammar mismatch');
  expectFailure('canonical-jsonl-fields-joint-privacy', mutateJsonlFieldGrammar, 'validate-privacy.mjs', 'canonical JSONL object field grammar mismatch');

  const mutateExpectedFieldGrammar = (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.expectedObjectFields.claudeState.push('nickname');
      return value;
    });
    updateJson(directory, 'claude-code/expected.json', (value) => {
      value.cases[0].state.nickname = 'synthetic-short';
      return value;
    });
  };
  expectFailure('canonical-expected-fields-joint-semantic', mutateExpectedFieldGrammar, 'validate.mjs', 'canonical expected object field grammar mismatch');
  expectFailure('canonical-expected-fields-joint-privacy', mutateExpectedFieldGrammar, 'validate-privacy.mjs', 'canonical expected object field grammar mismatch');

  expectFailure('schema-nested-field', (directory) => {
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      '"future_usage_detail":{"synthetic":true,"type":"synthetic prose"}',
    ));
  }, 'validate.mjs', 'schema-unexpected-key');

  expectFailure('schema-boolean-type', (directory) => {
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace('"isSidechain":false', '"isSidechain":"false"'));
  }, 'validate.mjs', 'schema-type');

  expectFailure('schema-synthetic-constant', (directory) => {
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      '"future_usage_detail":{"synthetic":false}',
    ));
  }, 'validate.mjs', 'schema-constant');

  expectFailure('schema-timestamp-domain', (directory) => {
    const offPolicyTimestamp = ['2001', '-01-01T00:00:01.000Z'].join('');
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace('2000-01-01T00:00:01.000Z', offPolicyTimestamp));
  }, 'validate.mjs', 'schema-timestamp');

  expectFailure('schema-negative-location', (directory) => {
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace('"input_tokens":100', '"input_tokens":-100'));
  }, 'validate.mjs', 'schema-range');

  expectFailure('required-state-metadata', (directory) => {
    updateJson(directory, 'claude-code/expected.json', (value) => {
      delete value.cases[0].state.pendingBefore;
      return value;
    });
  }, 'validate.mjs', 'schema-missing-key');

  expectFailure('derived-transition-evidence', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.cases[0].transitionDecisions[0] = 'component-delta';
      return value;
    });
  }, 'validate.mjs', 'transitions mismatch');

  expectFailure('derived-cache-root', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.inputExcludesCacheRead = false;
      return value;
    });
  }, 'validate.mjs', 'input cache root contract mismatch');

  expectFailure('derived-reasoning-root', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.reasoningIsIncludedInOutput = false;
      return value;
    });
  }, 'validate.mjs', 'reasoning root contract mismatch');

  expectFailure('derived-unknown-field-evidence', (directory) => {
    updateJson(directory, 'claude-code/expected.json', (value) => {
      value.cases[0].ignored.unknownFieldNames = [];
      return value;
    });
  }, 'validate.mjs', 'ignored mismatch');

  expectFailure('derived-project-metadata', (directory) => {
    updateJson(directory, 'claude-code/expected.json', (value) => {
      value.cases[0].events[0].project = 'synthetic-project-b';
      return value;
    });
  }, 'validate.mjs', 'events mismatch');

  expectFailure('required-replay-reference', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      delete value.replayPlan['codex-cli'][1].continuesSessionFrom;
      return value;
    });
  }, 'validate.mjs', 'schema-missing-key');

  expectFailure('complete-replay-inventory', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.replayPlan['claude-code'].pop();
      return value;
    });
  }, 'validate.mjs', 'replay inventory mismatch');

  const callFieldMarker = "const CLAUDE_CALL_FIELDS = ['sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain'];";
  for (const field of ['sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain']) {
    expectFailure(`discriminator-${field.replace('.', '-')}`, (directory) => {
      updateText(directory, 'validate.mjs', (text) => text.replace(
        callFieldMarker,
        `const CLAUDE_CALL_FIELDS = ${JSON.stringify(['sessionId', 'requestId', 'message.id', 'agentId', 'isSidechain'].filter((candidate) => candidate !== field))};`,
      ));
    });
  }

  expectFailure('discriminator-source-key', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.replayPlan['claude-code'][1].sourceKey = 'claude-source-a';
      return value;
    });
  }, 'validate.mjs', 'collision-reference');

  expectFailure('cursor-required-field', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      delete value.sourceCursorContract.scenarios[1].expected.next.mtimeMs;
      return value;
    });
  }, 'validate.mjs', 'source cursor scenario');

  expectFailure('cursor-record-ordinal-required', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      delete value.sourceCursorContract.scenarios[1].expected.next.recordOrdinal;
      return value;
    });
  }, 'validate.mjs', 'source cursor scenario');

  expectFailure('cursor-mtime-safe-integer', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.sourceCursorContract.scenarios[0].observation.mtimeMs = 1.5;
      return value;
    });
  }, 'validate.mjs', 'source cursor observation invalid');

  expectFailure('cursor-record-regression-scenario-required', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.sourceCursorContract.scenarios.splice(3, 1);
      return value;
    });
  }, 'validate.mjs', 'source cursor scenario inventory mismatch');

  expectFailure('cursor-record-regression-trigger-required', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '      || observation.completeRecords < previous.recordOrdinal);',
      '      || false);',
    ));
  }, 'validate.mjs', 'source cursor scenario record-count-regression mismatch');

  expectFailure('cursor-public-state-persistence', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace('  return result;\n}', '  return createCursor();\n}'));
  }, 'validate.mjs', 'cursor round trip mismatch');

  expectFailure('cursor-frontier-persistence', (directory) => {
    const marker = '  assertPublicCursor(result);';
    const mutation = [
      marker,
      ['  for (const state of Object.values(result', '.codexSessions)) delete state', '.frontier;'].join(''),
    ].join('\n');
    updateText(directory, 'validate.mjs', (text) => text.replace(marker, mutation));
  }, 'validate.mjs');

  expectFailure('cursor-recursive-exact-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  if (!isObject(value) || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${label} invalid`);",
      "  if (!isObject(value)) throw new Error(`${label} invalid`);",
    ));
  }, 'validate.mjs', 'cursor rejects hidden root state');

  expectFailure('cursor-recursive-source-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    assertExactObject(source, ['generation', 'mtimeMs', 'size', 'offset', 'recordOrdinal'], 'source cursor');",
      "    if (!isObject(source)) throw new Error('source cursor invalid');",
    ));
  }, 'validate.mjs', 'cursor rejects hidden source state');

  expectFailure('cursor-recursive-claude-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "        assertExactObject(state, ['status', 'sourceKey', 'sessionId', 'requestId', 'messageId', 'agentId', 'isSidechain', 'model', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'maxOutputTokens'], 'Claude pending call');",
      "        if (!isObject(state)) throw new Error('Claude pending call invalid');",
    ));
  }, 'validate.mjs', 'cursor rejects hidden Claude state');

  expectFailure('cursor-recursive-codex-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    assertExactObject(state, ['baseline', 'latestModel', 'frontier'], 'Codex session state');",
      "    if (!isObject(state)) throw new Error('Codex session state invalid');",
    ));
  }, 'validate.mjs', 'cursor rejects hidden Codex state');

  expectFailure('cursor-recursive-frontier-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "      assertExactObject(state.frontier, ['sourceOrder', 'recordOrdinal'], 'Codex session frontier');",
      "      if (!isObject(state.frontier)) throw new Error('Codex session frontier invalid');",
    ));
  }, 'validate.mjs', 'cursor rejects hidden frontier state');

  expectFailure('cursor-recursive-coverage-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text
      .replace(
        "  assertExactObject(cursor.coverageTotals, ['skippedRecords', 'rebasedTransitions', 'sourceDiscontinuities', 'modelUnavailableEvents'], 'adapter cursor coverage totals');",
        "  if (!isObject(cursor.coverageTotals)) throw new Error('adapter cursor coverage totals invalid');",
      )
      .replace(
        '  assertDiagnosticCoverageCoherence(cursor.diagnosticTotals, cursor.coverageTotals);',
        '  deriveCoverageTotals(cursor.diagnosticTotals);',
      ));
  }, 'validate.mjs', 'cursor rejects hidden coverage state');

  expectFailure('cursor-call-key-canonical', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  if (encodeClaudeCallTuple(decoded) !== key) throw new Error('Claude call key is not canonical');",
      "  if (false) throw new Error('Claude call key is not canonical');",
    ));
  }, 'validate.mjs', 'cursor rejects non-canonical Claude call key');

  expectFailure('cursor-null-baseline-projection', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      'baseline: state.baseline === null ? null : [...state.baseline]',
      'baseline: [...state.baseline]',
    ));
  });

  expectFailure('cursor-null-frontier-projection', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      'frontier: state.frontier === null ? null : { ...state.frontier }',
      'frontier: { ...state.frontier }',
    ));
  }, 'validate.mjs', 'nullable Codex cursor evidence');

  expectFailure('cursor-discontinuity-all-statuses', (directory) => {
    const marker = ['  delete cursor', '.claudeCalls[sourceKey];'].join('');
    const mutation = [
      '  const retained = Object.fromEntries(Object.entries(cursor', '.claudeCalls[sourceKey]).filter(([, state]) => state.status !== "pending"));',
      ['  cursor', '.claudeCalls[sourceKey] = retained;'].join(''),
    ].join('');
    updateText(directory, 'validate.mjs', (text) => text.replace(marker, mutation));
  }, 'validate.mjs', 'drops every Claude call status');

  expectFailure('identity-record-ordinal-derived', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace('recordOrdinal: recordOrdinalStart + index', 'recordOrdinal: 0'));
  }, 'validate.mjs');

  expectFailure('identity-equal-values-remain-distinct', (directory) => {
    updateJson(directory, 'claude-code/expected.json', (value) => {
      const testCase = value.cases.find((candidate) => candidate.fixture === 'discriminator-matrix.jsonl');
      testCase.eventIdentities[1] = { ...testCase.eventIdentities[0] };
      return value;
    });
  }, 'validate.mjs', 'scanned events mismatch');

  expectFailure('identity-canonical-tuple-encoding', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  return encodeClaudeCallTuple(tuple);',
      "  return tuple.join(':');",
    ));
  }, 'validate.mjs', 'Claude delimiter collision-free key');

  for (const [name, comparator] of [
    ['model', '    && existing.model === (value.message.model ?? null)'],
    ['input', '    && existing.inputTokens === tuple[0]'],
    ['cache-write', '    && existing.cacheWriteTokens === tuple[1]'],
    ['cache-read', '    && existing.cacheReadTokens === tuple[2]'],
    ['output-monotonicity', '    && tuple[3] >= existing.maxOutputTokens;'],
  ]) {
    expectFailure(`claude-streaming-invariant-${name}`, (directory) => {
      updateText(directory, 'validate.mjs', (text) => text.replace(
        comparator,
        comparator.endsWith(';') ? '    && true;' : '    && true',
      ));
    }, 'validate.mjs', 'Claude streaming invariant rejection');
  }

  expectFailure('pending-coverage-global-across-sources', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  const globalPendingAfter = countPendingCalls(cursor);',
      '  const globalPendingAfter = pendingAfter;',
    ));
  }, 'validate.mjs', 'cross-source global pending coverage');

  expectFailure('pending-diagnostic-global-across-sources', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '      occurrences: globalPendingAfter,',
      '      occurrences: pendingAfter,',
    ));
  }, 'validate.mjs', 'cross-source global pending diagnostic');

  expectFailure('pending-affected-records-current-scan-only', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '      ...(affectedPendingRecords > 0 ? { affectedRecords: affectedPendingRecords } : {}),',
      '      ...(pendingAfter > 0 ? { affectedRecords: pendingAfter } : {}),',
    ));
  }, 'validate.mjs', 'diagnostics mismatch');

  expectFailure('codex-source-order-unique', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.replayPlan['codex-cli'][1].sourceOrder = value.replayPlan['codex-cli'][0].sourceOrder;
      return value;
    });
  }, 'validate.mjs', 'source-order');

  expectFailure('codex-stale-frontier-enforced', (directory) => {
    const marker = ['    if (state?', '.frontier && comparePosition(position, state', '.frontier) <= 0) {'].join('');
    updateText(directory, 'validate.mjs', (text) => text.replace(marker, '    if (false) {'));
  }, 'validate.mjs');

  expectFailure('codex-last-usage-not-required', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace('const ACCEPT_VALID_TOTAL_WITHOUT_VALID_LAST = true;', 'const ACCEPT_VALID_TOTAL_WITHOUT_VALID_LAST = false;'));
  }, 'validate.mjs', 'scanned events mismatch');

  expectFailure('codex-last-usage-not-delta-source', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace('const normalizedDelta = delta;', 'const normalizedDelta = lastUsage ?? delta;'));
  }, 'validate.mjs', 'scanned events mismatch');

  expectFailure('codex-resume-missing-evidence-counted', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    if (!hasLastUsage) ignored.lastUsageMissing += 1;',
      '    if (!isResumed && !hasLastUsage) ignored.lastUsageMissing += 1;',
    ));
  }, 'validate.mjs', 'ignored mismatch');

  expectFailure('codex-resume-malformed-evidence-counted', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    else if (!lastUsage) ignored.lastUsageMalformed += 1;',
      '    else if (!isResumed && !lastUsage) ignored.lastUsageMalformed += 1;',
    ));
  }, 'validate.mjs', 'ignored mismatch');

  expectFailure('source-discontinuity-affected-records-omitted', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "      if (evidence[code].affectedRecords !== undefined) diagnostic.affectedRecords = evidence[code].affectedRecords;",
      '      diagnostic.affectedRecords = evidence[code].affectedRecords ?? evidence[code].occurrences;',
    ));
  }, 'validate.mjs', 'source discontinuity public diagnostics');

  expectFailure('source-discontinuity-counted-once', (directory) => {
    const marker = '  dropClaudeSourceState(cursor, sourceKey);';
    updateText(directory, 'validate.mjs', (text) => text.replace(marker, [
      marker,
      "  cursor.diagnosticTotals['source-discontinuity'] = (cursor.diagnosticTotals['source-discontinuity'] ?? 0) + 1;",
      '  cursor.coverageTotals.sourceDiscontinuities += 1;',
    ].join('\n')));
  }, 'validate.mjs');

  expectFailure('source-discontinuity-public-result', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    'source-discontinuity': { occurrences: 1 },",
      "    'source-discontinuity': { occurrences: 0 },",
    ));
  }, 'validate.mjs', 'source discontinuity public diagnostics');

  expectFailure('store-recovery-contract-canonical', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value.storeRecoveryContract.batchId = 'batch-synthetic-regenerated';
      value.storeRecoveryContract.expected.lastCommittedBatch.batchId = 'batch-synthetic-regenerated';
      return value;
    });
  }, 'validate.mjs', 'canonical store recovery contract mismatch');

  expectFailure('store-recovery-identity-not-payload', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  return JSON.stringify([adapterId, event.identity.sourceGeneration, event.identity.recordOrdinal, event.identity.subIndex]);",
      '  return JSON.stringify([adapterId, event.usage]);',
    ));
  }, 'validate.mjs', 'store identity-key evidence');

  expectFailure('store-recovery-identity-conflict', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text
      .replace(
        '    if (hasStored && (!sameScalarObject(state.events[key].identity, event.identity)\n      || !sameScalarObject(state.events[key].usage, event.usage))) {',
        '    if (false) {',
      )
      .replace(
        "    if (hasStored && !sameScalarObject(state.events[key].usage, event.usage)) throw new Error('store event identity conflict');",
        "    if (false) throw new Error('store event identity conflict');",
      ));
  }, 'validate.mjs', 'store rejects same identity with different usage');

  expectFailure('store-recovery-events-before-cursor', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  appendPreparedEvents(state);\n  replacePreparedCursor(state);',
      '  replacePreparedCursor(state);\n  appendPreparedEvents(state);',
    ));
  }, 'validate.mjs', 'store cursor advanced before durable events');

  expectFailure('store-recovery-source-generation-reservation', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    sourceGenerations: cloneJson(contract.sourceGenerations),',
      "    sourceGenerations: { 'store-source-a': 'source-generation-b' },",
    ));
  }, 'validate.mjs', 'store source generation reservation does not match next cursor');

  expectFailure('store-recovery-schema-version', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    schemaVersion: contract.schemaVersion,',
      '    schemaVersion: contract.schemaVersion + 1,',
    ));
  }, 'validate.mjs', 'store begin WAL invalid');

  expectFailure('store-recovery-batch-id-reservation', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    batchId: contract.batchId,',
      "    batchId: 'batch-synthetic-regenerated',",
    ));
  }, 'validate.mjs');

  expectFailure('store-recovery-last-committed-batch', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    lastCommittedBatch: committedBatchMarker(state.wal),',
      '    lastCommittedBatch: null,',
    ));
  }, 'validate.mjs', 'store batch commit state invalid');

  for (const [name, before, after] of [
    [
      'before-durable-begin',
      "  if (crashPoint === 'before-durable-begin') return;",
      "  if (crashPoint === 'before-durable-begin') { durableBeginBatch(state, contract); return; }",
    ],
    [
      'after-durable-begin',
      "  if (crashPoint === 'after-durable-begin') return;",
      "  if (crashPoint === 'after-durable-begin') { durableReadyBatch(state, contract); return; }",
    ],
    [
      'after-durable-ready',
      "  if (crashPoint === 'after-durable-ready') return;",
      "  if (crashPoint === 'after-durable-ready') { appendPreparedEvents(state); return; }",
    ],
    [
      'after-first-event',
      "  appendPreparedEvents(state, crashPoint === 'after-first-event' ? 1 : Number.POSITIVE_INFINITY);",
      '  appendPreparedEvents(state);',
    ],
    [
      'after-all-events',
      "  if (crashPoint === 'after-all-events') return;",
      "  if (crashPoint === 'after-all-events') { replacePreparedCursor(state); return; }",
    ],
    [
      'after-cursor-replace',
      "  if (crashPoint === 'after-cursor-replace') return;",
      "  if (crashPoint === 'after-cursor-replace') { durableCommitBatch(state); return; }",
    ],
  ]) {
    expectFailure(`store-crash-state-${name}`, (directory) => {
      updateText(directory, 'validate.mjs', (text) => text.replace(before, after));
    }, 'validate.mjs', `store pre-recovery state ${name} mismatch`);
  }

  expectFailure('store-crash-state-after-durable-commit', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  durableCommitBatch(state);\n}\n\nfunction expectedPreRecoveryState',
      '  state.commitCount += 0;\n}\n\nfunction expectedPreRecoveryState',
    ));
  }, 'validate.mjs', 'store pre-recovery state after-durable-commit mismatch');

  expectFailure('store-batch-applied-revision-bound', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  const expectedMarker = committedBatchMarker(batch);\n  if (!sameScalarObject(state.cursorEnvelope.lastCommittedBatch, expectedMarker)) return false;\n  if (state.cursorEnvelope.revision !== expectedMarker.committedCursorRevision\n    || !sameJsonStructure(state.cursorEnvelope.cursor, batch.nextCursor)) {\n    throw new Error('store applied batch marker does not match cursor');\n  }\n  return true;",
      '  return state.cursorEnvelope.lastCommittedBatch?.batchId === batch.batchId;',
    ));
  }, 'validate.mjs', 'store repeated batch id advances a new revision');

  expectFailure('store-applied-marker-cursor-bound', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (state.cursorEnvelope.revision !== expectedMarker.committedCursorRevision\n    || !sameJsonStructure(state.cursorEnvelope.cursor, batch.nextCursor)) {',
      '  if (state.cursorEnvelope.revision !== expectedMarker.committedCursorRevision) {',
    ));
  }, 'validate.mjs', 'store rejects applied marker with different cursor');

  expectFailure('store-ready-preflight-required', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  assertReadyWalRecoverable(state, state.wal);\n  appendPreparedEvents(state);',
      '  appendPreparedEvents(state);',
    ));
  }, 'validate.mjs', 'store eventful ready rejects marker at revision zero failed');

  expectFailure('store-ready-preflight-before-write', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  assertReadyWalRecoverable(state, state.wal);\n  appendPreparedEvents(state);',
      '  appendPreparedEvents(state);\n  assertReadyWalRecoverable(state, state.wal);',
    ));
  }, 'validate.mjs', 'store eventful ready rejects marker at revision zero preserves state mismatch');

  expectFailure('store-ready-exact-envelope', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  assertExactObject(batch, ['phase', 'schemaVersion', 'adapterId', 'batchId', 'baseCursorRevision', 'sourceGenerations', 'events', 'nextCursor'], 'store ready WAL');",
      "  if (!isObject(batch)) throw new Error('store ready WAL invalid');",
    ));
  }, 'validate.mjs', 'store direct-ready rejects hidden WAL state failed');

  expectFailure('store-ready-event-envelope', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    assertExactObject(event, ['identity', 'usage'], 'store ready WAL event');",
      "    if (!isObject(event)) throw new Error('store ready WAL event invalid');",
    ));
  }, 'validate.mjs', 'store direct-ready rejects hidden event state failed');

  expectFailure('store-loaded-event-envelope', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    assertExactObject(stored, ['identity', 'usage'], 'store durable event');",
      "    if (!isObject(stored)) throw new Error('store durable event invalid');",
    ));
  }, 'validate.mjs', 'store rejects hidden durable event envelope failed');

  expectFailure('store-loaded-event-schema', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    if (errors.length > 0) throw new Error('store durable event invalid');",
      "    if (false) throw new Error('store durable event invalid');",
    ));
  }, 'validate.mjs', 'store rejects invalid durable event schema failed');

  expectFailure('store-loaded-event-key', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    if (eventStorageKey(adapterId, stored) !== key) throw new Error('store durable event storage key mismatch');",
      "    if (false) throw new Error('store durable event storage key mismatch');",
    ));
  }, 'validate.mjs', 'store rejects durable event key mismatch failed');

  expectFailure('store-zero-revision-marker', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    if (marker !== null) throw new Error('store zero revision marker invalid');",
      "    if (false) throw new Error('store zero revision marker invalid');",
    ));
  }, 'validate.mjs', 'store eventful ready rejects marker at revision zero failed');

  expectFailure('store-marker-exact-envelope', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  assertExactObject(marker, ['adapterId', 'batchId', 'baseCursorRevision', 'committedCursorRevision'], 'store committed batch marker');",
      "  if (!isObject(marker)) throw new Error('store committed batch marker invalid');",
    ));
  }, 'validate.mjs', 'store zero-event ready rejects hidden prior marker failed');

  expectFailure('store-marker-base-revision', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    || marker.committedCursorRevision !== marker.baseCursorRevision + 1',
      '    || false',
    ));
  }, 'validate.mjs', 'store zero-event ready rejects prior marker base mismatch failed');

  expectFailure('store-marker-envelope-revision', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    || marker.committedCursorRevision !== revision) {',
      '    || false) {',
    ));
  }, 'validate.mjs', 'store zero-event ready rejects prior marker revision mismatch failed');

  expectFailure('store-marker-adapter', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (marker.adapterId !== adapterId',
      '  if (false',
    ));
  }, 'validate.mjs', 'store zero-event ready rejects prior marker adapter mismatch failed');

  expectFailure('store-marker-order-independent', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (!sameScalarObject(state.cursorEnvelope.lastCommittedBatch, expectedMarker)) return false;',
      '  if (JSON.stringify(state.cursorEnvelope.lastCommittedBatch) !== JSON.stringify(expectedMarker)) return false;',
    ));
  }, 'validate.mjs', 'store reordered applied marker is order-independent failed');

  expectFailure('store-applied-cursor-order-independent', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    || !sameJsonStructure(state.cursorEnvelope.cursor, batch.nextCursor)) {',
      '    || JSON.stringify(state.cursorEnvelope.cursor) !== JSON.stringify(batch.nextCursor)) {',
    ));
  }, 'validate.mjs', 'store reordered eventful applied cursor is order-independent failed');

  expectFailure('store-applied-cursor-array-order', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '      && left.every((value, index) => sameJsonStructure(value, right[index]));',
      '      && left.every((value) => right.some((candidate) => sameJsonStructure(value, candidate)));',
    ));
  }, 'validate.mjs', 'store rejects applied cursor with reordered Codex baseline tuple failed');

  expectFailure('store-begin-reservation-order-independent', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (!sameJsonStructure(state.wal, expectedBegin)) {',
      '  if (JSON.stringify(state.wal) !== JSON.stringify(expectedBegin)) {',
    ));
  }, 'validate.mjs', 'store batch reservation changed during recovery');

  expectFailure('store-begin-exact-envelope', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  assertExactObject(batch, ['phase', 'schemaVersion', 'adapterId', 'batchId', 'baseCursorRevision', 'sourceGenerations'], 'store begin WAL');",
      "  if (!isObject(batch)) throw new Error('store begin WAL invalid');",
    ));
  }, 'validate.mjs', 'store rejects hidden begin WAL state failed');

  expectFailure('store-fresh-ready-preflight-before-begin', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '    assertReadyWalRecoverable(state, batch);\n    if (preparedBatchApplied(state, batch)) return;\n    durableBeginBatch(state, contract);',
      '    if (preparedBatchApplied(state, batch)) return;\n    durableBeginBatch(state, contract);\n    assertReadyWalRecoverable(state, batch);',
    ));
  }, 'validate.mjs', 'store preflights fresh ready contract before begin write preserves state mismatch');

  expectFailure('store-ready-public-next-cursor', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  assertPublicCursor(batch.nextCursor);',
      '  createCursor(batch.nextCursor);',
    ));
  }, 'validate.mjs');

  expectFailure('store-ready-revision-bound', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (!applied && state.cursorEnvelope.revision !== batch.baseCursorRevision) {',
      '  if (false) {',
    ));
  }, 'validate.mjs', 'store direct-ready rejects cursor revision conflict failed');

  expectFailure('store-source-reservation-next-cursor-bound', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (JSON.stringify(reservedEntries.sort())\n    !== JSON.stringify(Object.entries(sourceGenerationReservations(batch.nextCursor)).sort())) {',
      '  if (false) {',
    ));
  }, 'validate.mjs', 'store direct-ready rejects zero-event reservation mismatch failed');

  expectFailure('store-source-reservation-unique', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  if (new Set(reservedEntries.map(([, generation]) => generation)).size !== reservedEntries.length) {',
      '  if (false) {',
    ));
  }, 'validate.mjs', 'store direct-ready rejects duplicate reservation failed');

  expectFailure('store-event-generation-reserved', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    if (!reserved.has(event.identity.sourceGeneration)) throw new Error('store event generation was not durably reserved');",
      "  if (false) throw new Error('store event generation was not durably reserved');",
    ));
  }, 'validate.mjs', 'store direct-ready rejects unreserved event failed');

  expectFailure('store-ready-source-deletion', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "    if (!Object.hasOwn(batch.nextCursor.sources, sourceKey)) throw new Error('store source deletion is unsupported');",
      "    if (false) throw new Error('store source deletion is unsupported');",
    ));
  }, 'validate.mjs', 'store direct-ready rejects source deletion failed');

  expectFailure('public-diagnostic-occurrences', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.cases[0].diagnostics[0].occurrences += 1;
      return value;
    });
  }, 'validate.mjs', 'diagnostics mismatch');

  expectFailure('public-diagnostic-affected-records', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.cases[0].diagnostics[0].affectedRecords += 1;
      return value;
    });
  }, 'validate.mjs', 'diagnostics mismatch');

  expectFailure('public-coverage-lifetime-counter', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.cases[0].coverage.skippedRecords += 1;
      return value;
    });
  }, 'validate.mjs', 'coverage mismatch');

  expectFailure('public-cursor-diagnostic-total', (directory) => {
    updateJson(directory, 'codex-cli/expected.json', (value) => {
      value.cases[0].cursorEvidence.diagnosticTotals['malformed-row'] += 1;
      return value;
    });
  }, 'validate.mjs');

  expectFailure('cursor-diagnostic-coverage-coherence', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  assertDiagnosticCoverageCoherence(cursor.diagnosticTotals, cursor.coverageTotals);',
      '  deriveCoverageTotals(cursor.diagnosticTotals);',
    ));
  }, 'validate.mjs', 'cursor rejects diagnostic without coverage');

  expectFailure('diagnostic-map-conflict', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      "  skippedRecords: ['malformed-row', 'invalid-usage', 'claude-call-conflict', 'codex-stale-source'],",
      "  skippedRecords: ['malformed-row', 'invalid-usage', 'codex-stale-source'],",
    ));
    updateJson(directory, 'manifest.json', (value) => {
      value.diagnosticCoverageMap.skippedRecords = value.diagnosticCoverageMap.skippedRecords.filter((code) => code !== 'claude-call-conflict');
      return value;
    });
  }, 'validate.mjs', 'diagnostic-coverage-mismatch');

  expectFailure('diagnostic-coverage-single-finalization', (directory) => {
    updateText(directory, 'validate.mjs', (text) => text.replace(
      '  cursor.coverageTotals = deriveCoverageTotals(cursor.diagnosticTotals);',
      '  cursor.coverageTotals = { ...cursor.coverageTotals };',
    ));
  }, 'validate.mjs', 'adapter cursor diagnostic coverage mismatch');

  expectFailure('pending-diagnostic-not-lifetime', (directory) => {
    updateJson(directory, 'claude-code/expected.json', (value) => {
      value.cases[1].cursorEvidence.diagnosticTotals['pending-call'] = 1;
      return value;
    });
  }, 'validate.mjs', 'diagnostic-totals');

  expectFailure('inventory-root-file', (directory) => {
    fs.writeFileSync(path.join(directory, 'unexpected.synthetic'), 'synthetic', 'utf8');
  });

  expectFailure('inventory-nested-file', (directory) => {
    fs.writeFileSync(path.join(directory, 'claude-code', 'unexpected.synthetic'), 'synthetic', 'utf8');
  });

  expectFailure('inventory-empty-directory', (directory) => {
    fs.mkdirSync(path.join(directory, 'unexpected-directory'));
  });

  expectFailure('inventory-symlink', (directory) => {
    const target = path.join(directory, 'claude-code', 'streaming.jsonl');
    fs.rmSync(target);
    fs.symlinkSync('malformed.jsonl', target);
  });

  const fifoExecutable = ['/us', 'r/bin/mkfifo'].join('');
  if (fs.existsSync(fifoExecutable)) {
    expectFailure('inventory-fifo', (directory) => {
      const target = path.join(directory, 'claude-code', 'streaming.jsonl');
      fs.rmSync(target);
      const created = spawnSync(fifoExecutable, [target], { env: {}, encoding: 'utf8' });
      if (created.status !== 0) throw new Error('synthetic FIFO setup failed');
    });
  }

  expectFailure('encoding-binary-control', (directory) => {
    fs.writeFileSync(path.join(directory, 'README.md'), Buffer.from([0x73, 0x79, 0x6e, 0x00]));
  }, 'validate.mjs', 'binary control');

  expectFailure('encoding-invalid-utf8', (directory) => {
    fs.writeFileSync(path.join(directory, 'README.md'), Buffer.from([0xc3, 0x28]));
  }, 'validate.mjs', 'invalid text encoding');

  expectPrivacyRule('privacy-ulid', ['01ARZ3NDEKTS', 'V4RRFFQ69G5FAV'].join(''), 'ulid');
  expectPrivacyRule('privacy-ulid-lowercase', ['01arz3ndekts', 'v4rrffq69g5fav'].join(''), 'ulid');
  expectPrivacyRule('privacy-ipv4', ['192.0.', '2.10'].join(''), 'ip-address');
  expectPrivacyRule('privacy-ipv6', ['2001:', '0db8:', '0000:', '0000:', '0000:', '0000:', '0000:', '0001'].join(''), 'ip-address');
  expectPrivacyRule('privacy-ipv6-compressed', ['2001:', 'db8::', '7'].join(''), 'ip-address');
  expectPrivacyRule('privacy-hostname', ['synthetic-host', '.example', '.invalid'].join(''), 'hostname-or-domain');
  expectPrivacyRule('privacy-domain-test', ['synthetic-host', '.example', '.test'].join(''), 'hostname-or-domain');
  expectPrivacyRule('privacy-domain-arbitrary-tld', ['synthetic-host', '.example', '.museum'].join(''), 'hostname-or-domain');
  expectPrivacyRule('privacy-posix-path', ['/sr', 'v/synthetic-user/data'].join(''), 'absolute-path');
  expectPrivacyRule('privacy-generic-posix-path', ['/da', 'ta/synthetic-user/item'].join(''), 'absolute-path');
  expectPrivacyRule('privacy-windows-path', ['C:', '\\Users\\synthetic-user\\data'].join(''), 'absolute-path');
  expectPrivacyRule('privacy-unc-path', ['\\\\synthetic-host', '\\share\\data'].join(''), 'absolute-path');
  expectPrivacyRule('privacy-timestamp', ['2026-02-03', 'T04:05:06.000Z'].join(''), 'non-synthetic-timestamp');
  const highEntropy32 = ['Aa1_Bb2-', 'Cc3_Dd4-', 'Ee5_Ff6-', 'Gg7_Hh8_'].join('');
  const highEntropy40 = [highEntropy32, 'Ii9_Jj0_'].join('');
  const highEntropyOneClass32 = ['qwertyui', 'opasdfgh', 'jklzxcvb', 'nmqwerty'].join('');
  const highEntropyTwoClass32 = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ', '23456789'].join('');
  expectPrivacyRule('privacy-high-entropy-32', highEntropy32, 'high-entropy-string');
  expectPrivacyRule('privacy-high-entropy-one-32', highEntropyOneClass32, 'high-entropy-string');
  expectPrivacyRule('privacy-high-entropy-two-32', highEntropyTwoClass32, 'high-entropy-string');
  expectPrivacyCodeRule('privacy-code-entropy-40', `// ${highEntropy40}`, 'code-comment', 'high-entropy-string');
  expectPrivacyRule('privacy-high-entropy', ['Aa1_Bb2-Cc3_Dd4-Ee5_Ff6-', 'Gg7_Hh8-Ii9_Jj0-Kk1_Ll2_'].join(''), 'high-entropy-string');
  expectPrivacyPass('privacy-entropy-length31-pass', highEntropyOneClass32.slice(0, 31));
  expectPrivacyPass('privacy-entropy-low-pass', 'qZ'.repeat(16));
  expectPrivacyPass('privacy-private-key-suffix-pass', ['{"content_', 'type":"synthetic","prompt', 'Tokens":1,"tool', 'ResultCount":0}'].join(''));
  expectPrivacyRule('privacy-secret-key', ['"access_', 'token": "synthetic"'].join(''), 'secret-key-name');
  expectPrivacyRule('privacy-secret-camel-key', ['"access', 'Token": "synthetic"'].join(''), 'secret-key-name');
  expectPrivacyRule('privacy-secret-env-key', ['SYNTHETIC_API_', 'KEY=synthetic'].join(''), 'secret-key-name');
  expectPrivacyRule('privacy-bearer-shape', ['Authoriz', 'ation: Bear', 'er SyntheticValue1234567890'].join(''), 'secret-shape');
  expectPrivacyRule('privacy-secret-shape', ['s', 'k-', 'SyntheticOnlyValue1234567890'].join(''), 'secret-shape');
  expectPrivacyRule('privacy-uuid-v7', ['01890f3e', '-7b4d-7cc1-8e12-123456789abc'].join(''), 'uuid');

  const codeDomain = ['synthetic-host', '.example', '.museum'].join('');
  const escapedCodeDomain = codeDomain.replaceAll('.', '\\.');
  expectPrivacyDetectionGuard('privacy-guard-regex-after-else', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "const statementBodyKeywords = new Set(['else', 'do']);",
      "const statementBodyKeywords = new Set(['do']);",
    ));
  }, ['if (true) {} else /', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('privacy-guard-regex-after-do', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "const statementBodyKeywords = new Set(['else', 'do']);",
      "const statementBodyKeywords = new Set(['else']);",
    ));
  }, ['do /', escapedCodeDomain, '/; while (false);'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('privacy-guard-regex-after-restricted-asi', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      '  if (!state.pendingAsiBoundary && !state.pendingExpressionBoundary) return;',
      '  if (!state.pendingExpressionBoundary) return;',
    ));
  }, ['while (false) { break', '\n/', escapedCodeDomain, "/.test('synthetic'); }"].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyPassGuard('privacy-guard-function-expression-division', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "else if (opensConstruct) kind = pendingConstruct.isValue ? 'value-block' : 'block';",
      "else if (opensConstruct) kind = 'block';",
    ));
  }, ['const syntheticRatio = function () {} / ', codeDomain, ' / syntheticDivisor;'].join(''), 'code-regex', 'hostname-or-domain');
  const asyncLineTerminatorSource = [
    'const syntheticAsyncValue = async',
    '\nfunction syntheticLineDeclaration() {}',
    '\n/', escapedCodeDomain, '/;',
  ].join('');
  expectPrivacyDetectionGuard('privacy-guard-async-line-terminator', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "        const constructStatementStart = wasStatementStart\n          || lineTerminatedAsync\n          || previousToken === 'export-default';",
      "        const constructStatementStart = wasStatementStart\n          || previousToken === 'export-default';",
    ));
  }, asyncLineTerminatorSource, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('privacy-guard-optional-catch-body', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      else if (state.lastToken === 'catch') kind = 'block';",
      '      else if (false) kind = \'block\';',
    ));
  }, ['try {} catch {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  const catchLabelKey = ['Con', 'tent'].join('');
  expectPrivacyPassGuard('privacy-guard-optional-catch-label', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      else if (state.lastToken === 'catch') kind = 'block';",
      '      else if (false) kind = \'block\';',
    ));
  }, ['try {} catch { ', catchLabelKey, ': syntheticValue; }'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-for-await-control-head', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      const opensControlHead = controlHeadKeywords.has(state.lastToken) || state.lastToken === 'for-await';",
      '      const opensControlHead = controlHeadKeywords.has(state.lastToken);',
    ));
  }, ['for await (const syntheticValue of []) /', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-async-function-declaration', ['async function syntheticAsyncDeclaration() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-async-line-terminator', asyncLineTerminatorSource, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-optional-catch', ['try {} catch {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-optional-catch-newline', ['try {} catch', '\n{}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-for-await', ['for await (const syntheticValue of []) /', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-for-await-newlines', ['for', '\nawait', '\n(const syntheticValue of []) /', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('guard-export-object', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      if (token === 'default' && previousToken === 'export') {",
      "      if (false && previousToken === 'export') {",
    ));
  }, ['export default { ', catchLabelKey, ': syntheticValue };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('guard-export-function', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "        const constructStatementStart = wasStatementStart\n          || lineTerminatedAsync\n          || previousToken === 'export-default';",
      '        const constructStatementStart = wasStatementStart\n          || lineTerminatedAsync;',
    ));
  }, ['export default function syntheticExport() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('guard-export-async', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "        state.pendingAsyncStatementStart = wasStatementStart || previousToken === 'export-default';",
      '        state.pendingAsyncStatementStart = wasStatementStart;',
    ));
  }, ['export default async function syntheticExport() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-function-regex', ['export default function syntheticExport() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-anon-fn-regex', ['export default function () {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-class-regex', ['export default class SyntheticExport {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-anon-class-regex', ['export default class {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-async-regex', ['export default async function syntheticExport() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-export-object-key', ['export default { ', catchLabelKey, ': syntheticValue };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodePass('privacy-code-async-function-expression-division-pass', ['const syntheticRatio = async function () {} / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-code-async-line-division-pass', ['const syntheticRatio = async', '\n/ ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-code-optional-catch-label-pass', ['try {} catch { ', catchLabelKey, ': syntheticValue; }'].join(''));
  expectPrivacyCodeRule('privacy-code-optional-catch-object-property', ['try {} catch { const syntheticPayload = { ', catchLabelKey, ': syntheticValue }; }'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodePass('privacy-code-await-group-division-pass', ['await (syntheticValue) / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-export-fn-division-pass', ['export default (function () {}) / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-export-class-div-pass', ['export default (class {}) / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-export-class-member-pass', ['export default class { ', catchLabelKey, '() {} }'].join(''));
  expectPrivacyCodePass('privacy-switch-default-label-pass', ['switch (syntheticValue) { default: { ', catchLabelKey, ': syntheticValue; } }'].join(''));
  expectPrivacyCodeRule('privacy-code-regex-after-else', ['if (true) {} else /', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-do', ['do /', escapedCodeDomain, '/; while (false);'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-break-asi', ['while (false) { break', '\n/', escapedCodeDomain, "/.test('synthetic'); }"].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-continue-asi', ['while (false) { continue', '\n/', escapedCodeDomain, "/.test('synthetic'); }"].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-function-declaration', ['function syntheticDeclaration() {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-class-declaration', ['class SyntheticDeclaration {}', '\n/', escapedCodeDomain, '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodePass('privacy-code-function-expression-division-pass', ['const syntheticRatio = function () {} / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-code-named-function-expression-division-pass', ['const syntheticRatio = function syntheticNamed() {} / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-code-class-expression-division-pass', ['const syntheticRatio = class {} / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodePass('privacy-code-named-class-expression-division-pass', ['const syntheticRatio = class SyntheticNamed {} / ', codeDomain, ' / syntheticDivisor;'].join(''));
  expectPrivacyCodeRule('privacy-code-comment', `// ${codeDomain}`, 'code-comment', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex', `const syntheticPattern = /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-return', `function syntheticPattern() { return /${escapedCodeDomain}/; }`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-arrow', `const syntheticPattern = () => /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-if', `if (true) /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-if-strings', `if ('synthetic' === 'synthetic') /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-while', `while (false) /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-for', `for (; false;) /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-plus', `const syntheticPattern = syntheticPrefix + /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodeRule('privacy-code-regex-after-multiply', `const syntheticPattern = 2 * /${escapedCodeDomain}/;`, 'code-regex-decoded', 'hostname-or-domain');
  const templateArrowRegexSource = ['const syntheticTemplateRegex = `', '${() => /', escapedCodeDomain, '/}', '`;'].join('');
  expectPrivacyCodeRule('privacy-code-template-expression-arrow-regex', templateArrowRegexSource, 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodePass('privacy-code-division-not-regex', `const syntheticRatio = syntheticAmount / ${codeDomain} / syntheticDivisor;`);
  expectPrivacyCodePass('privacy-code-call-division-not-regex', `const syntheticRatio = syntheticCall() / ${codeDomain} / syntheticDivisor;`);
  expectPrivacyCodePass('privacy-code-group-division-not-regex', `const syntheticRatio = (syntheticAmount) / ${codeDomain} / syntheticDivisor;`);
  expectPrivacyCodePass('privacy-code-postfix-division-not-regex', `const syntheticRatio = syntheticAmount++ / ${codeDomain} / syntheticDivisor;`);
  const classDotDomain = codeDomain.replaceAll('.', '[.]');
  expectPrivacyCodeRule('privacy-code-regex-class-dot', `const syntheticPattern = /${classDotDomain}/;`, 'code-regex-canonical', 'hostname-or-domain');
  const hexadecimalClassDotDomain = codeDomain.replaceAll('.', '[\\x2e]');
  const slashCharacter = String.fromCharCode(92);
  expectPrivacyPassGuard('privacy-guard-regex-escape-parity', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      const decoded = segment.surface === 'code-regex'\n        ? decodeRegexPrivacySurface(segment.value, segment.flags)\n        : decodeJavaScriptEscapes(segment.value);",
      '      const decoded = decodeJavaScriptEscapes(segment.value);',
    ));
  }, ['const syntheticPattern = /', codeDomain.replaceAll('.', slashCharacter.repeat(2) + 'x2e'), '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyDetectionGuard('privacy-guard-regex-legacy-octal', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      '    match = unicodeMode ? null : rest.match(/^([0-7]{1,3})/);',
      '    match = null;',
    ));
  }, ['const syntheticPattern = /', codeDomain.replaceAll('.', slashCharacter + '056'), '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyPassGuard('privacy-guard-regex-unicode-flag', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "  const unicodeMode = flags.includes('u') || flags.includes('v');",
      '  const unicodeMode = true;',
    ));
  }, ['const syntheticPattern = /', codeDomain.replaceAll('.', slashCharacter + 'u{2e}'), '/;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  const doubleEscapedHexDomain = codeDomain.replaceAll('.', slashCharacter.repeat(2) + 'x2e');
  expectPrivacyCodePass('privacy-code-regex-double-escaped-hex-pass', ['const syntheticPattern = /', doubleEscapedHexDomain, '/;'].join(''));
  const doubleEscapedHexClassDomain = codeDomain.replaceAll('.', '[' + slashCharacter.repeat(2) + 'x2e]');
  expectPrivacyCodePass('privacy-code-regex-double-escaped-hex-class-pass', ['const syntheticPattern = /', doubleEscapedHexClassDomain, '/;'].join(''));
  const legacyOctalDomain = codeDomain.replaceAll('.', slashCharacter + '056');
  expectPrivacyCodeRule('privacy-code-regex-legacy-octal-dot', ['const syntheticPattern = /', legacyOctalDomain, '/g;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  const legacyOctalClassDomain = codeDomain.replaceAll('.', '[' + slashCharacter + '056]');
  expectPrivacyCodeRule('privacy-code-regex-legacy-octal-class-dot', ['const syntheticPattern = /', legacyOctalClassDomain, '/;'].join(''), 'code-regex-canonical', 'hostname-or-domain');
  const unicodeCodePointDomain = codeDomain.replaceAll('.', slashCharacter + 'u{2e}');
  expectPrivacyCodeRule('privacy-code-regex-unicode-code-point-dot', ['const syntheticPattern = /', unicodeCodePointDomain, '/u;'].join(''), 'code-regex-decoded', 'hostname-or-domain');
  expectPrivacyCodePass('privacy-code-regex-unicode-code-point-no-flag-pass', ['const syntheticPattern = /', unicodeCodePointDomain, '/;'].join(''));
  expectPrivacyCodeRule('privacy-code-regex-hex-class-dot', `const syntheticPattern = /${hexadecimalClassDotDomain}/;`, 'code-regex-canonical', 'hostname-or-domain');
  expectPrivacyCodePass('privacy-code-regex-class-nondomain-pass', `const syntheticPattern = /${codeDomain.replaceAll('.', '[a]')}/;`);
  expectPrivacyCodePass('privacy-code-regex-single-dot-pass', 'const syntheticPattern = /[.]/;');
  expectPrivacyCodeRule('privacy-code-template-static', `const syntheticTemplate = \`prefix \${true} ${codeDomain}\`;`, 'code-template', 'hostname-or-domain');
  const templateExpressionSource = ['const syntheticTemplateExpression = `', '${"', codeDomain, '"}', '`;'].join('');
  expectPrivacyCodeRule('privacy-code-template-expression-string', templateExpressionSource, 'code-string', 'hostname-or-domain');
  const nestedTemplateExpressionSource = ['const syntheticNestedTemplate = `', '${`', '${"', codeDomain, '"}', '`}', '`;'].join('');
  expectPrivacyCodeRule('privacy-code-template-expression-nested', nestedTemplateExpressionSource, 'code-string', 'hostname-or-domain');
  const sensitiveIdentifier = ['access', 'Token'].join('');
  expectPrivacyCodeRule('privacy-code-bare', `const ${sensitiveIdentifier} = 1;`, 'code-bare', 'secret-key-name');

  const codeContentKey = ['Con', 'tent'].join('');
  const codePromptKey = ['Pro', 'mpt'].join('');
  const codeToolResultKey = ['tool', 'Result'].join('');
  const codeSeparatedToolResultKey = ['Tool-', 'Result'].join('');
  expectPrivacyCodeRule('privacy-code-property-unquoted', `const syntheticPayload = { ${codeContentKey}: 'synthetic prose' };`, 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-quoted', `const syntheticPayload = { '${codeToolResultKey}': 'synthetic prose' };`, 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-separated', `const syntheticPayload = { "${codeSeparatedToolResultKey}": 'synthetic prose' };`, 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-binding-object', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      else if (bindingDeclarationKeywords.has(state.lastToken)) kind = 'binding-object';",
      "      else if (false) kind = 'binding-object';",
    ));
  }, ['const { ', codeContentKey, ' } = syntheticPayload;'].join(''), 'code-property-key', 'private-payload-key');
  const encodedCodePromptKey = unicodeEscape(codePromptKey);
  expectPrivacyDetectionGuard('privacy-guard-property-escaped-identifier', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      '    const identifier = rest.match(javaScriptIdentifierToken);',
      '    const identifier = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);',
    ));
  }, ['const syntheticPayload = { ', encodedCodePromptKey, ": 'synthetic prose' };"].join(''), 'code-property-key-decoded', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-property-shorthand', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      '      if (isDirectPropertyFrame(frame)) emitPendingDirectProperty(frame, add);',
      '      if (false) emitPendingDirectProperty(frame, add);',
    ));
  }, ['const ', codeContentKey, ' = 1; const syntheticPayload = { ', codeContentKey, ' };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-property-method', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      '      if (frame?.pendingDirectKey) {\n        emitPendingDirectProperty(frame, add);\n        frame.propertyModifier = null;\n      }',
      '      if (frame?.pendingDirectKey) {\n        frame.pendingDirectKey = null;\n        frame.propertyModifier = null;\n      }',
    ));
  }, ['const syntheticPayload = { ', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-property-accessor', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "const propertyModifierKeywords = new Set(['get', 'set', 'async']);",
      "const propertyModifierKeywords = new Set(['set', 'async']);",
    ));
  }, ['const syntheticPayload = { get ', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyDetectionGuard('privacy-guard-property-prefix-object', (directory) => {
    updateText(directory, 'validate-privacy.mjs', (text) => text.replace(
      "      else kind = state.expectOperand && !state.atStatementStart ? 'object' : 'block';",
      "      else kind = state.expectOperand && !state.atStatementStart && state.lastToken !== 'void' ? 'object' : 'block';",
    ));
  }, ['void { ', codeContentKey, ": 'synthetic prose' };"].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-async-method', ['const syntheticPayload = { async ', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-generator-method', ['const syntheticPayload = { *', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-async-generator-method', ['const syntheticPayload = { async *', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-escaped-identifier', ['const syntheticPayload = { ', encodedCodePromptKey, ": 'synthetic prose' };"].join(''), 'code-property-key-decoded', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-shorthand', ['const ', codeContentKey, ' = 1; const syntheticPayload = { ', codeContentKey, ' };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-method', ['const syntheticPayload = { ', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-getter', ['const syntheticPayload = { get ', codeContentKey, '() {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-setter', ['const syntheticPayload = { set ', codeContentKey, '(syntheticValue) {} };'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-void-object', ['void { ', codeContentKey, ": 'synthetic prose' };"].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-property-unicode', `const syntheticPayload = { "${encodedCodePromptKey}": 'synthetic prose' };`, 'code-property-key-decoded', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-binding-property-shorthand', ['const { ', codeContentKey, ' } = syntheticPayload;'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-binding-property-renamed', ['let { ', codeContentKey, ': syntheticLocal } = syntheticPayload;'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-binding-property-nested', ['var { safe: { ', codePromptKey, ' } } = syntheticPayload;'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodeRule('privacy-code-binding-property-declaration-continuation', ['const syntheticSafe = syntheticValue, { \'', codeSeparatedToolResultKey, '\': syntheticLocal } = syntheticPayload;'].join(''), 'code-property-key', 'private-payload-key');
  expectPrivacyCodePass('privacy-code-property-string-pass', `const syntheticValue = '${codeContentKey}';`);
  expectPrivacyCodePass('privacy-code-property-suffix-pass', `const syntheticPayload = { ${codeContentKey}Type: 1, ${codePromptKey}Tokens: 1, ${codeToolResultKey}Count: 0 };`);
  expectPrivacyCodePass('privacy-code-property-computed-pass', `const syntheticPayload = { ['${codePromptKey}']: 'synthetic prose' };`);
  expectPrivacyCodePass('privacy-code-property-label-pass', `function syntheticLabel() { ${codeContentKey}: for (;;) break ${codeContentKey}; }`);

  expectPrivacyCodePass('privacy-code-property-accessor-name-pass', ['const ', codePromptKey, ' = 1; const syntheticPayload = { get: ', codePromptKey, ', set: ', codePromptKey, ', get() { return ', codePromptKey, '; } };'].join(''));
  expectPrivacyCodePass('privacy-code-property-class-method-pass', ['class SyntheticPayload { ', codeContentKey, '() {} }'].join(''));
  expectPrivacyCodePass('privacy-code-property-return-newline-label-pass', ['function syntheticReturn() { return', '\n{ ', codeContentKey, ": 'synthetic prose' }; }"].join(''));
  expectPrivacyCodePass('privacy-code-binding-target-name-pass', ['const { safe: ', codeContentKey, ' } = syntheticPayload;'].join(''));
  expectPrivacyCodePass('privacy-code-binding-computed-pass', ['const { [', codePromptKey, ']: syntheticLocal } = syntheticPayload;'].join(''));
  expectPrivacyCodePass('privacy-code-binding-rest-pass', ['const { ...', codeContentKey, ' } = syntheticPayload;'].join(''));
  expectPrivacyCodePass('privacy-code-binding-suffix-pass', ['const { ', codeContentKey, 'Type } = syntheticPayload;'].join(''));

  expectPrivacyMutationRule('privacy-json-decoded-key', (directory) => {
    const encodedKey = unicodeEscape(['access', 'Token'].join(''));
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      `"future_usage_detail":{"synthetic":true,"${encodedKey}":"synthetic"}`,
    ));
  }, 'claude-code/streaming.jsonl', 'json-key', 'secret-key-name');

  expectPrivacyMutationRule('privacy-json-decoded-string', (directory) => {
    const encodedValue = unicodeEscape(['s', 'k-', 'SyntheticOnlyValue1234567890'].join(''));
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      `"future_usage_detail":{"synthetic":true,"synthetic_note":"${encodedValue}"}`,
    ));
  }, 'claude-code/streaming.jsonl', 'json-string', 'secret-shape');

  expectPrivacyMutationRule('privacy-json-decoded-private-payload-key', (directory) => {
    const privatePayloadName = ['con', 'tent'].join('');
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail"',
      `"${unicodeEscape(privatePayloadName)}"`,
    ));
  }, 'claude-code/streaming.jsonl', 'json-key', 'private-payload-key');

  const rootPrivatePayloadKey = ['Con', 'tent'].join('');
  expectFailure('manifest-root-private', (directory) => {
    updateJson(directory, 'manifest.json', (value) => {
      value[rootPrivatePayloadKey] = 'synthetic prose';
      return value;
    });
  }, 'validate-privacy.mjs', 'manifest:root-schema');

  for (const [name, fragments] of [
    ['case-prompt', ['Pro', 'mpt']],
    ['camel-tool-result', ['tool', 'Result']],
    ['separator-tool-result', ['Tool-', 'Result']],
  ]) {
    expectPrivacyMutationRule(`privacy-json-private-payload-key-${name}`, (directory) => {
      const privatePayloadName = fragments.join('');
      updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
        '"future_usage_detail":{"synthetic":true}',
        `"future_usage_detail":{"synthetic":true,"${privatePayloadName}":"synthetic prose"}`,
      ));
    }, 'claude-code/streaming.jsonl', 'json-key', 'private-payload-key');
  }

  expectPrivacyMutationRule('privacy-private-key-unicode', (directory) => {
    const privatePayloadName = unicodeEscape(['tool', 'Result'].join(''));
    updateText(directory, 'claude-code/streaming.jsonl', (text) => text.replace(
      '"future_usage_detail":{"synthetic":true}',
      `"future_usage_detail":{"synthetic":true,"${privatePayloadName}":"synthetic prose"}`,
    ));
  }, 'claude-code/streaming.jsonl', 'json-key', 'private-payload-key');

  console.log(JSON.stringify({ status: 'pass', mutations: results.length }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
