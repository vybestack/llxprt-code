#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guard for the real-provider E2E model request budget (issue #2278 AC1).
 *
 * Validates the checked-in budget declaration and, optionally, checks the
 * E2E run ledger against it so a suite that exceeds the declared ceiling
 * fails CI.
 *
 * Usage:
 *   bun scripts/check-e2e-model-budget.ts --validate-budget
 *   bun scripts/check-e2e-model-budget.ts --ledger <path>
 *
 * Exits 0 on success, 1 on any violation.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_MODEL_RUN_BUDGET,
  MAX_REAL_MODEL_API_REQUESTS,
  BASELINE_REAL_MODEL_API_REQUESTS,
  type RealModelBudgetEntry,
} from '../integration-tests/real-model-budget.ts';
import {
  readLedger,
  type RealProviderRunRecord,
} from '../packages/test-utils/src/model-request-ledger.ts';

// ---------------------------------------------------------------------------
// Pure validation functions
// ---------------------------------------------------------------------------

export function validateBudget(
  budget: readonly RealModelBudgetEntry[],
  maxApiRequests: number,
): readonly string[] {
  const violations: string[] = [];
  const seenNames = new Set<string>();

  for (const entry of budget) {
    if (entry.testName.trim().length === 0) {
      violations.push(
        `Budget entry has an empty testName (apiRequestsPerRun=${entry.apiRequestsPerRun}).`,
      );
      continue;
    }
    if (seenNames.has(entry.testName)) {
      violations.push(
        `duplicate budget entry for testName "${entry.testName}".`,
      );
    }
    seenNames.add(entry.testName);

    if (!Number.isInteger(entry.apiRequestsPerRun)) {
      violations.push(
        `Budget entry "${entry.testName}" has non-integer apiRequestsPerRun=${entry.apiRequestsPerRun}.`,
      );
    }
    if (entry.apiRequestsPerRun < 0) {
      violations.push(
        `Budget entry "${entry.testName}" has negative apiRequestsPerRun=${entry.apiRequestsPerRun}.`,
      );
    }
    if (entry.reason.trim().length === 0) {
      violations.push(`Budget entry "${entry.testName}" has an empty reason.`);
    }
  }

  const declaredCiTotal = declaredCiApiRequests(budget);
  if (declaredCiTotal > maxApiRequests) {
    violations.push(
      `Declared apiRequestsPerRun for tests that run in E2E CI (${declaredCiTotal}) exceeds ceiling (${maxApiRequests}).`,
    );
  }

  return violations;
}

/**
 * Sum the declared cost of the entries that `.github/workflows/e2e.yml`
 * actually executes. Entries the workflow never selects cost nothing per leg
 * and so do not count against the ceiling.
 */
export function declaredCiApiRequests(
  budget: readonly RealModelBudgetEntry[],
): number {
  return budget
    .filter((entry) => entry.runsInE2eCi)
    .reduce((sum, entry) => sum + entry.apiRequestsPerRun, 0);
}

export function validateBudgetPolicy(
  maxApiRequests: number,
  baselineApiRequests: number,
): readonly string[] {
  const violations: string[] = [];

  if (maxApiRequests >= baselineApiRequests) {
    violations.push(
      `MAX_REAL_MODEL_API_REQUESTS (${maxApiRequests}) must be strictly less than BASELINE_REAL_MODEL_API_REQUESTS (${baselineApiRequests}).`,
    );
  }

  const halfBaseline = baselineApiRequests / 2;
  if (maxApiRequests > halfBaseline) {
    violations.push(
      `MAX_REAL_MODEL_API_REQUESTS (${maxApiRequests}) must be at most half of BASELINE_REAL_MODEL_API_REQUESTS (${baselineApiRequests}), i.e. <= ${halfBaseline}. The issue requires a >= 50% reduction from the baseline.`,
    );
  }

  return violations;
}

export interface LedgerCheckResult {
  readonly violations: readonly string[];
  readonly totalApiRequests: number;
  readonly perTest: ReadonlyMap<string, number>;
}

export function checkLedgerAgainstBudget(
  records: readonly RealProviderRunRecord[],
  budget: readonly RealModelBudgetEntry[],
  maxApiRequests: number,
): LedgerCheckResult {
  const violations: string[] = [];
  const budgetMap = new Map<string, number>();
  for (const entry of budget) {
    budgetMap.set(entry.testName, entry.apiRequestsPerRun);
  }

  const perTest = new Map<string, number>();
  let totalApiRequests = 0;

  for (const rec of records) {
    const runCount = (perTest.get(rec.testName) ?? 0) + 1;
    perTest.set(rec.testName, runCount);

    const cost = budgetMap.get(rec.testName);
    if (cost === undefined) {
      violations.push(
        `Recorded test "${rec.testName}" is not in the real-model budget. ` +
          `Either add a fakeResponsesPath to the test or add a budget entry ` +
          `with justification in integration-tests/real-model-budget.ts.`,
      );
      continue;
    }
    totalApiRequests += cost;
  }

  if (totalApiRequests > maxApiRequests) {
    violations.push(
      `Recorded real-model API requests (${totalApiRequests}) exceeds the ceiling (${maxApiRequests}).`,
    );
  }

  return { violations, totalApiRequests, perTest };
}

export function formatReport(
  result: LedgerCheckResult,
  budget: readonly RealModelBudgetEntry[],
  maxApiRequests: number,
  baselineApiRequests: number,
): string {
  const costByTest = new Map(
    budget.map((entry) => [entry.testName, entry.apiRequestsPerRun]),
  );
  const lines: string[] = [
    'Real-Model E2E Budget Report',
    '='.repeat(60),
    `Ceiling: ${maxApiRequests} | Baseline: ${baselineApiRequests} | Recorded API requests: ${result.totalApiRequests}`,
    '',
  ];

  if (result.perTest.size === 0) {
    lines.push('No real-provider runs recorded.');
  } else {
    lines.push('Per-test run counts:');
    for (const [testName, count] of result.perTest) {
      const apiCost = costByTest.get(testName);
      const costLabel = apiCost === undefined ? 'UNBUDGETED' : `${apiCost}`;
      const totalLabel =
        apiCost === undefined ? 'UNBUDGETED' : `${apiCost * count}`;
      lines.push(
        `  ${testName}: ${count} run(s) x ${costLabel} req = ${totalLabel}`,
      );
    }
  }

  lines.push('');
  if (result.violations.length > 0) {
    lines.push('VIOLATIONS:');
    for (const violation of result.violations) {
      lines.push(`  - ${violation}`);
    }
  } else {
    lines.push('All checks passed.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the `--ledger <path>` argument. Returns undefined when the flag is
 * absent. Throws when the flag is present without a usable value, so a typo in
 * CI fails loudly instead of silently degrading to budget-only validation.
 */
export function parseLedgerPath(args: readonly string[]): string | undefined {
  const ledgerIndex = args.indexOf('--ledger');
  if (ledgerIndex < 0) {
    return undefined;
  }
  const value = args[ledgerIndex + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error('--ledger requires a path argument');
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);

  let ledgerPath: string | undefined;
  try {
    ledgerPath = parseLedgerPath(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const violations: string[] = [
    ...validateBudget(REAL_MODEL_RUN_BUDGET, MAX_REAL_MODEL_API_REQUESTS),
    ...validateBudgetPolicy(
      MAX_REAL_MODEL_API_REQUESTS,
      BASELINE_REAL_MODEL_API_REQUESTS,
    ),
  ];

  if (ledgerPath === undefined) {
    console.log(
      `Budget validation: ${REAL_MODEL_RUN_BUDGET.length} entries, ` +
        `declared E2E CI API requests=${declaredCiApiRequests(REAL_MODEL_RUN_BUDGET)}, ` +
        `ceiling=${MAX_REAL_MODEL_API_REQUESTS}, baseline=${BASELINE_REAL_MODEL_API_REQUESTS}`,
    );
  } else {
    let records: readonly RealProviderRunRecord[];
    try {
      records = readLedger(ledgerPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to read ledger: ${message}`);
      process.exit(1);
    }

    const result = checkLedgerAgainstBudget(
      records,
      REAL_MODEL_RUN_BUDGET,
      MAX_REAL_MODEL_API_REQUESTS,
    );
    violations.push(...result.violations);

    console.log(
      formatReport(
        result,
        REAL_MODEL_RUN_BUDGET,
        MAX_REAL_MODEL_API_REQUESTS,
        BASELINE_REAL_MODEL_API_REQUESTS,
      ),
    );
  }

  if (violations.length > 0) {
    console.error('\ne2e-model-budget guard FAILED:');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log('e2e-model-budget guard PASSED.');
  process.exit(0);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
