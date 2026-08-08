/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectSetupNames,
  validateBudget,
  validateBudgetPolicy,
  validateBudgetNamesAreUsed,
  extractSetupNames,
  checkLedgerAgainstBudget,
  formatReport,
  parseLedgerPath,
} from '../check-e2e-model-budget.ts';
import {
  REAL_MODEL_RUN_BUDGET,
  MAX_REAL_MODEL_API_REQUESTS,
  BASELINE_REAL_MODEL_API_REQUESTS,
  type RealModelBudgetEntry,
} from '../../integration-tests/real-model-budget.ts';
import type { RealProviderRunRecord } from '../../packages/test-utils/src/model-request-ledger.ts';

const INTEGRATION_TESTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'integration-tests',
);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'e2e-budget-guard-test-'));
}

function validEntry(
  testName: string,
  apiRequestsPerRun: number,
  reason = 'valid reason',
): RealModelBudgetEntry {
  return { testName, apiRequestsPerRun, reason };
}

function record(
  testName: string,
  testDir = '/tmp/test',
): RealProviderRunRecord {
  return { testName, testDir };
}

describe('validateBudget', () => {
  it('passes for a well-formed budget', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('test-a', 2),
      validEntry('test-b', 0),
    ];
    expect(validateBudget(budget)).toEqual([]);
  });

  it('reports a duplicate testName', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('dup', 0),
      validEntry('dup', 0),
    ];
    const violations = validateBudget(budget);
    expect(violations.some((v) => v.includes('duplicate'))).toBe(true);
    expect(violations.some((v) => v.includes('dup'))).toBe(true);
  });

  it('reports a negative apiRequestsPerRun', () => {
    const violations = validateBudget([validEntry('neg', -1)]);
    expect(violations.some((v) => v.includes('negative'))).toBe(true);
  });

  it('reports a non-integer apiRequestsPerRun', () => {
    const violations = validateBudget([validEntry('frac', 0.5)]);
    expect(violations.some((v) => v.includes('integer'))).toBe(true);
  });

  it('reports an empty reason', () => {
    const violations = validateBudget([validEntry('empty-reason', 0, '')]);
    expect(violations.some((v) => v.includes('reason'))).toBe(true);
  });

  it('reports a whitespace-only reason', () => {
    const violations = validateBudget([validEntry('ws-reason', 0, '   ')]);
    expect(violations.some((v) => v.includes('reason'))).toBe(true);
  });

  it('reports an empty testName', () => {
    const violations = validateBudget([validEntry('', 0)]);
    expect(violations.some((v) => v.includes('testName'))).toBe(true);
  });

  it('reports a whitespace-only testName', () => {
    const violations = validateBudget([validEntry('  ', 0)]);
    expect(violations.some((v) => v.includes('testName'))).toBe(true);
  });
});

describe('validateBudgetPolicy', () => {
  it('passes when the ceiling is below half the baseline', () => {
    expect(validateBudgetPolicy(4, 9)).toEqual([]);
  });

  it('passes when the ceiling is exactly half the baseline', () => {
    expect(validateBudgetPolicy(4, 8)).toEqual([]);
  });

  it('fails when the ceiling equals the baseline', () => {
    expect(validateBudgetPolicy(9, 9).length).toBeGreaterThan(0);
  });

  it('fails when the ceiling exceeds the baseline', () => {
    expect(validateBudgetPolicy(10, 9).length).toBeGreaterThan(0);
  });

  it('fails when the ceiling is more than half the baseline', () => {
    const violations = validateBudgetPolicy(5, 9);
    expect(violations.some((v) => v.includes('50%'))).toBe(true);
  });
});

describe('extractSetupNames', () => {
  it('extracts the first string argument of each rig.setup call', () => {
    const source = [
      "await rig.setup('first name', { settings: {} });",
      "rig.setup('second name');",
    ].join('\n');
    expect(extractSetupNames(source)).toEqual(['first name', 'second name']);
  });

  it('extracts names written across multiple lines', () => {
    const source = [
      'await rig.setup(',
      "  'wrapped name',",
      '  {},',
      ');',
    ].join('\n');
    expect(extractSetupNames(source)).toEqual(['wrapped name']);
  });

  it('handles double-quoted names containing an apostrophe', () => {
    expect(extractSetupNames('rig.setup("it\'s fine");')).toEqual([
      "it's fine",
    ]);
  });

  it('returns nothing for a source with no setup call', () => {
    expect(extractSetupNames('const x = 1;')).toEqual([]);
  });
});

describe('collectSetupNames', () => {
  it('aggregates setup names across every .test.ts file in a directory', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'alpha.test.ts'),
      `await rig.setup('alpha one', {});\nrig.setup('alpha two');\n`,
    );
    writeFileSync(join(dir, 'beta.test.ts'), `rig.setup('beta one');\n`);

    expect([...collectSetupNames(dir)].sort()).toEqual([
      'alpha one',
      'alpha two',
      'beta one',
    ]);
  });

  it('ignores files that are not .test.ts', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'real.test.ts'), `rig.setup('counted');\n`);
    writeFileSync(join(dir, 'helper.ts'), `rig.setup('not counted');\n`);
    writeFileSync(join(dir, 'notes.md'), `rig.setup('also not counted');\n`);

    expect([...collectSetupNames(dir)]).toEqual(['counted']);
  });

  it('returns an empty set for a directory with no test files', () => {
    expect(collectSetupNames(makeTempDir()).size).toBe(0);
  });

  // Deliberately asserts against the real tree, matching the established
  // real-repository pattern in scripts/check-test-file-coverage.ts. This is the
  // drift detection the guard exists for: if a budgeted `rig.setup()` name is
  // renamed, `validateBudgetNamesAreUsed` must notice, which it can only do if
  // `collectSetupNames` really reads this repository. `integration-tests/` is a
  // committed, non-optional directory that `scripts/bun-test-roots.ts` also
  // hard-codes as a test root.
  it('collects every rig.setup name across the integration tests on disk', () => {
    const names = collectSetupNames(INTEGRATION_TESTS_DIR);
    expect(names.has('should be able to run a shell command')).toBe(true);
    expect(names.has('should be able to replace content in a file')).toBe(true);
    expect(names.has('extension install test')).toBe(true);
  });

  // A missing or unreadable test tree is an environment fault, not a budget
  // violation, so it must surface as an actionable error naming the path rather
  // than a bare filesystem stack trace or a bogus "violation".
  it('throws an actionable error naming the directory it could not scan', () => {
    const missing = join(makeTempDir(), 'no-such-integration-tests');
    expect(() => collectSetupNames(missing)).toThrow(missing);
    expect(() => collectSetupNames(missing)).toThrow(/complete checkout/);
  });
});

describe('validateBudgetNamesAreUsed', () => {
  it('passes when every budget name is used by a setup call', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('used', 0)];
    expect(validateBudgetNamesAreUsed(budget, new Set(['used']))).toEqual([]);
  });

  it('reports a budget name that no setup call uses', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('ghost', 2)];
    const violations = validateBudgetNamesAreUsed(budget, new Set(['other']));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('ghost');
  });
});

describe('checkLedgerAgainstBudget', () => {
  const budget: readonly RealModelBudgetEntry[] = [
    validEntry('canary-a', 2),
    validEntry('canary-b', 2),
    validEntry('zero-cost', 0),
  ];

  it('passes for an empty ledger', () => {
    const result = checkLedgerAgainstBudget([], budget, 4);
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(0);
  });

  it('passes when the distinct-test total is exactly at the ceiling', () => {
    const result = checkLedgerAgainstBudget(
      [record('canary-a'), record('canary-b')],
      budget,
      4,
    );
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(4);
  });

  it('fails when the distinct-test total exceeds the ceiling', () => {
    const result = checkLedgerAgainstBudget(
      [record('canary-a'), record('canary-b')],
      budget,
      3,
    );
    expect(result.violations.some((v) => v.includes('exceeds'))).toBe(true);
    expect(result.totalApiRequests).toBe(4);
  });

  // scripts/bun-test-roots.ts gives the integration-tests root retries, and a
  // retry re-spawns the whole file, so duplicate records are legitimate. Billing
  // per record would red-fail a green leg.
  it('bills a retried test once no matter how many times it was recorded', () => {
    const result = checkLedgerAgainstBudget(
      [
        record('canary-a'),
        record('canary-a'),
        record('canary-a'),
        record('canary-b'),
      ],
      budget,
      4,
    );
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(4);
  });

  it('reports the run count per test so a retry stays visible', () => {
    const result = checkLedgerAgainstBudget(
      [record('canary-a'), record('canary-a'), record('canary-b')],
      budget,
      4,
    );
    expect(result.runsPerTest.get('canary-a')).toBe(2);
    expect(result.runsPerTest.get('canary-b')).toBe(1);
  });

  it('fails when a recorded testName is not in the budget', () => {
    const result = checkLedgerAgainstBudget(
      [record('unknown-test')],
      budget,
      4,
    );
    expect(result.violations.some((v) => v.includes('unknown-test'))).toBe(
      true,
    );
    expect(result.violations.some((v) => v.includes('fakeResponsesPath'))).toBe(
      true,
    );
  });

  it('records zero-cost tests without adding to the total', () => {
    const result = checkLedgerAgainstBudget(
      [record('zero-cost'), record('zero-cost')],
      budget,
      4,
    );
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(0);
    expect(result.runsPerTest.get('zero-cost')).toBe(2);
  });
});

describe('formatReport', () => {
  it('reports each recorded test with its API cost', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('test-x', 2)];
    const report = formatReport(
      checkLedgerAgainstBudget([record('test-x')], budget, 4),
      budget,
      4,
      9,
    );
    expect(report).toContain('test-x: 2 req');
    expect(report).toContain('API requests for distinct tests recorded: 2');
  });

  it('annotates a retried test with its run count', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('test-x', 2)];
    const report = formatReport(
      checkLedgerAgainstBudget([record('test-x'), record('test-x')], budget, 4),
      budget,
      4,
      9,
    );
    expect(report).toContain('test-x: 2 req (retried: 2 runs)');
  });

  it('states that no runs were recorded for an empty ledger', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('test-y', 2)];
    const report = formatReport(
      checkLedgerAgainstBudget([], budget, 4),
      budget,
      4,
      9,
    );
    expect(report).toContain('No real-provider runs recorded.');
    expect(report).toContain('All checks passed.');
  });

  it('marks a recorded test that is absent from the budget as unbudgeted', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('known', 2)];
    const report = formatReport(
      checkLedgerAgainstBudget([record('rogue')], budget, 4),
      budget,
      4,
      9,
    );
    expect(report).toContain('rogue: UNBUDGETED req');
    expect(report).toContain('VIOLATIONS:');
  });

  it('reports the ceiling and baseline it was checked against', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('t', 2)];
    const report = formatReport(
      checkLedgerAgainstBudget([], budget, 4),
      budget,
      4,
      9,
    );
    expect(report).toContain('Ceiling: 4');
    expect(report).toContain('Baseline: 9');
  });
});

describe('parseLedgerPath', () => {
  it('returns undefined when --ledger is absent', () => {
    expect(parseLedgerPath(['--validate-budget'])).toBeUndefined();
  });

  it('returns the path that follows --ledger', () => {
    expect(parseLedgerPath(['--ledger', '/tmp/ledger.jsonl'])).toBe(
      '/tmp/ledger.jsonl',
    );
  });

  it('throws when --ledger is the final argument', () => {
    expect(() => parseLedgerPath(['--ledger'])).toThrow(
      '--ledger requires a path argument',
    );
  });

  it('throws when --ledger is followed by a blank value', () => {
    expect(() => parseLedgerPath(['--ledger', '   '])).toThrow(
      '--ledger requires a path argument',
    );
  });
});

describe('checked-in real-model-budget.ts', () => {
  it('passes validateBudget', () => {
    expect(validateBudget(REAL_MODEL_RUN_BUDGET)).toEqual([]);
  });

  it('passes validateBudgetPolicy', () => {
    expect(
      validateBudgetPolicy(
        MAX_REAL_MODEL_API_REQUESTS,
        BASELINE_REAL_MODEL_API_REQUESTS,
      ),
    ).toEqual([]);
  });

  it('permits exactly the reviewed set of real-provider tests', () => {
    expect(REAL_MODEL_RUN_BUDGET.map((entry) => entry.testName).sort()).toEqual(
      [
        'codex-image-real',
        'extension install test',
        'should allow all with "ShellTool" and other specific tools',
        'should be able to replace content in a file',
        'should be able to run a shell command',
        'should exit quickly if stdin stream does not end',
        'should not crash when using mixed prompt inputs',
        'should propagate environment variables',
        'should provide clear error message for mixed input',
        'should succeed with --yolo mode',
      ].sort(),
    );
  });

  // The two tests e2e.yml actually selects that reach a model. Everything else
  // in the budget either never starts a model turn or is not selected in CI.
  it('holds the two E2E-selected model canaries within the ceiling', () => {
    const canaries = [
      'should be able to run a shell command',
      'should be able to replace content in a file',
    ];
    const cost = REAL_MODEL_RUN_BUDGET.filter((entry) =>
      canaries.includes(entry.testName),
    ).reduce((sum, entry) => sum + entry.apiRequestsPerRun, 0);
    expect(cost).toBe(MAX_REAL_MODEL_API_REQUESTS);
  });

  it('charges nothing to the tests that exit before any model turn', () => {
    const freeTests = [
      'should not crash when using mixed prompt inputs',
      'should provide clear error message for mixed input',
      'should exit quickly if stdin stream does not end',
      'extension install test',
    ];
    for (const testName of freeTests) {
      const entry = REAL_MODEL_RUN_BUDGET.find((e) => e.testName === testName);
      expect(entry?.apiRequestsPerRun).toBe(0);
    }
  });
});
