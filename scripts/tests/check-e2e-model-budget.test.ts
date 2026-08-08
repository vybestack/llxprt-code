/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  validateBudget,
  validateBudgetPolicy,
  declaredCiApiRequests,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEntry(
  testName: string,
  apiRequestsPerRun: number,
  reason = 'valid reason',
  runsInE2eCi = true,
): RealModelBudgetEntry {
  return { testName, apiRequestsPerRun, runsInE2eCi, reason };
}

function record(
  testName: string,
  testDir = '/tmp/test',
): RealProviderRunRecord {
  return { testName, testDir };
}

// ---------------------------------------------------------------------------
// validateBudget
// ---------------------------------------------------------------------------

describe('validateBudget', () => {
  it('passes for a well-formed budget under the ceiling', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('test-a', 1),
      validEntry('test-b', 1),
    ];
    expect(validateBudget(budget, 2)).toEqual([]);
  });

  it('passes when the summed total equals the ceiling exactly', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('test-a', 1),
      validEntry('test-b', 1),
    ];
    expect(validateBudget(budget, 2)).toEqual([]);
  });

  it('reports a duplicate testName', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('dup', 0),
      validEntry('dup', 0),
    ];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('duplicate'))).toBe(true);
    expect(violations.some((v) => v.includes('dup'))).toBe(true);
  });

  it('reports a negative apiRequestsPerRun', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('neg', -1)];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('negative'))).toBe(true);
  });

  it('reports a non-integer apiRequestsPerRun', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('frac', 0.5)];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('integer'))).toBe(true);
  });

  it('reports an empty reason', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('empty-reason', 0, ''),
    ];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('reason'))).toBe(true);
  });

  it('reports a whitespace-only reason', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('ws-reason', 0, '   '),
    ];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('reason'))).toBe(true);
  });

  it('reports an empty testName', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('', 0)];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('testName'))).toBe(true);
  });

  it('reports a whitespace-only testName', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('  ', 0)];
    const violations = validateBudget(budget, 5);
    expect(violations.some((v) => v.includes('testName'))).toBe(true);
  });

  it('reports when the declared total for CI-executed tests exceeds the ceiling', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('a', 2),
      validEntry('b', 1),
    ];
    const violations = validateBudget(budget, 2);
    expect(violations.some((v) => v.includes('exceeds'))).toBe(true);
  });

  it('ignores entries that E2E CI never executes when applying the ceiling', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('runs-in-ci', 2),
      validEntry('never-selected', 5, 'valid reason', false),
    ];
    expect(validateBudget(budget, 2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// declaredCiApiRequests
// ---------------------------------------------------------------------------

describe('declaredCiApiRequests', () => {
  it('sums only the entries that E2E CI executes', () => {
    const budget: readonly RealModelBudgetEntry[] = [
      validEntry('in-ci-a', 1),
      validEntry('in-ci-b', 1),
      validEntry('not-in-ci', 4, 'valid reason', false),
    ];
    expect(declaredCiApiRequests(budget)).toBe(2);
  });

  it('is zero for an empty budget', () => {
    expect(declaredCiApiRequests([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateBudgetPolicy
// ---------------------------------------------------------------------------

describe('validateBudgetPolicy', () => {
  it('passes when max is at most half of baseline', () => {
    expect(validateBudgetPolicy(2, 5)).toEqual([]);
  });

  it('passes when max is exactly half of baseline', () => {
    expect(validateBudgetPolicy(2, 4)).toEqual([]);
  });

  it('fails when max is not less than baseline', () => {
    const violations = validateBudgetPolicy(5, 5);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('fails when max exceeds baseline', () => {
    const violations = validateBudgetPolicy(6, 5);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('fails when max is more than half of baseline', () => {
    const violations = validateBudgetPolicy(3, 5);
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkLedgerAgainstBudget
// ---------------------------------------------------------------------------

describe('checkLedgerAgainstBudget', () => {
  const budget: readonly RealModelBudgetEntry[] = [
    validEntry('canary-a', 1),
    validEntry('canary-b', 1),
    validEntry('zero-cost', 0),
  ];

  it('passes for an empty ledger', () => {
    const result = checkLedgerAgainstBudget([], budget, 2);
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(0);
  });

  it('passes when total is exactly at ceiling', () => {
    const records: readonly RealProviderRunRecord[] = [
      record('canary-a'),
      record('canary-b'),
    ];
    const result = checkLedgerAgainstBudget(records, budget, 2);
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(2);
  });

  it('fails when total exceeds ceiling by one', () => {
    const records: readonly RealProviderRunRecord[] = [
      record('canary-a'),
      record('canary-a'),
      record('canary-b'),
    ];
    const result = checkLedgerAgainstBudget(records, budget, 2);
    expect(result.violations.some((v) => v.includes('exceeds'))).toBe(true);
    expect(result.totalApiRequests).toBe(3);
  });

  it('fails when a recorded testName is not in the budget', () => {
    const records: readonly RealProviderRunRecord[] = [record('unknown-test')];
    const result = checkLedgerAgainstBudget(records, budget, 2);
    expect(result.violations.some((v) => v.includes('unknown-test'))).toBe(
      true,
    );
    expect(result.violations.some((v) => v.includes('fakeResponsesPath'))).toBe(
      true,
    );
  });

  it('counts zero-cost tests without adding to the total', () => {
    const records: readonly RealProviderRunRecord[] = [
      record('zero-cost'),
      record('zero-cost'),
    ];
    const result = checkLedgerAgainstBudget(records, budget, 2);
    expect(result.violations).toEqual([]);
    expect(result.totalApiRequests).toBe(0);
    expect(result.perTest.get('zero-cost')).toBe(2);
  });

  it('tracks per-test run counts correctly', () => {
    const records: readonly RealProviderRunRecord[] = [
      record('canary-a'),
      record('canary-b'),
      record('canary-a'),
    ];
    const result = checkLedgerAgainstBudget(records, budget, 5);
    expect(result.perTest.get('canary-a')).toBe(2);
    expect(result.perTest.get('canary-b')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('reports each recorded test with its run count and API cost', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('test-x', 1)];
    const records: readonly RealProviderRunRecord[] = [
      record('test-x'),
      record('test-x'),
    ];
    const report = formatReport(
      checkLedgerAgainstBudget(records, budget, 5),
      budget,
      5,
      10,
    );
    expect(report).toContain('test-x: 2 run(s) x 1 req = 2');
    expect(report).toContain('Recorded API requests: 2');
  });

  it('states that no runs were recorded for an empty ledger', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('test-y', 1)];
    const report = formatReport(
      checkLedgerAgainstBudget([], budget, 2),
      budget,
      2,
      5,
    );
    expect(report).toContain('No real-provider runs recorded.');
    expect(report).toContain('All checks passed.');
  });

  it('marks a recorded test that is absent from the budget as unbudgeted', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('known', 1)];
    const records: readonly RealProviderRunRecord[] = [record('rogue')];
    const report = formatReport(
      checkLedgerAgainstBudget(records, budget, 2),
      budget,
      2,
      5,
    );
    expect(report).toContain('rogue: 1 run(s) x UNBUDGETED req = UNBUDGETED');
    expect(report).toContain('VIOLATIONS:');
  });

  it('reports the ceiling and baseline it was checked against', () => {
    const budget: readonly RealModelBudgetEntry[] = [validEntry('t', 1)];
    const report = formatReport(
      checkLedgerAgainstBudget([], budget, 2),
      budget,
      2,
      5,
    );
    expect(report).toContain('Ceiling: 2');
    expect(report).toContain('Baseline: 5');
  });
});

// ---------------------------------------------------------------------------
// parseLedgerPath
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Real-repository assertion: the checked-in budget is self-consistent
// ---------------------------------------------------------------------------

describe('checked-in real-model-budget.ts', () => {
  it('passes validateBudget', () => {
    const violations = validateBudget(
      REAL_MODEL_RUN_BUDGET,
      MAX_REAL_MODEL_API_REQUESTS,
    );
    expect(violations).toEqual([]);
  });

  it('passes validateBudgetPolicy', () => {
    const violations = validateBudgetPolicy(
      MAX_REAL_MODEL_API_REQUESTS,
      BASELINE_REAL_MODEL_API_REQUESTS,
    );
    expect(violations).toEqual([]);
  });

  it('permits exactly the reviewed set of real-provider tests', () => {
    expect(REAL_MODEL_RUN_BUDGET.map((entry) => entry.testName).sort()).toEqual(
      [
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

  it('bills an E2E CI API request only to the two model tool-selection canaries', () => {
    const billed = REAL_MODEL_RUN_BUDGET.filter(
      (entry) => entry.runsInE2eCi && entry.apiRequestsPerRun > 0,
    ).map((entry) => entry.testName);
    expect(billed.sort()).toEqual(
      [
        'should be able to replace content in a file',
        'should be able to run a shell command',
      ].sort(),
    );
  });

  it('declares an E2E CI cost at or below MAX_REAL_MODEL_API_REQUESTS', () => {
    expect(declaredCiApiRequests(REAL_MODEL_RUN_BUDGET)).toBeLessThanOrEqual(
      MAX_REAL_MODEL_API_REQUESTS,
    );
  });

  it('declares an E2E CI cost at most half the recorded baseline', () => {
    expect(
      declaredCiApiRequests(REAL_MODEL_RUN_BUDGET) * 2,
    ).toBeLessThanOrEqual(BASELINE_REAL_MODEL_API_REQUESTS);
  });
});
