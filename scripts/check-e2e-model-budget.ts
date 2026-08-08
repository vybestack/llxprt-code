#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guard for the real-provider E2E model request budget (issue #2278).
 *
 * Two modes:
 *
 * - `--validate-budget` checks the checked-in declaration in
 *   `integration-tests/real-model-budget.ts` for internal consistency and
 *   confirms every declared test name is actually used by a `rig.setup()` call
 *   in `integration-tests/`. This runs in the CI lint job.
 * - `--ledger <path>` additionally checks the ledger produced by a real E2E leg:
 *   any recorded test missing from the budget fails, and the summed cost of the
 *   DISTINCT recorded tests must stay within the ceiling.
 *
 * The ceiling is applied per distinct test rather than per record because the
 * `integration-tests` root is configured with retries (`scripts/bun-test-roots.ts`)
 * and a retry re-spawns the whole file, legitimately producing duplicate
 * records. The report surfaces the run counts so a retry is visible.
 *
 * Usage:
 *   bun scripts/check-e2e-model-budget.ts --validate-budget
 *   bun scripts/check-e2e-model-budget.ts --ledger <path>
 *
 * Exits 0 on success, 1 on any violation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTEGRATION_TESTS_DIR = join(REPO_ROOT, 'integration-tests');

// ---------------------------------------------------------------------------
// Budget declaration checks
// ---------------------------------------------------------------------------

export function validateBudget(
  budget: readonly RealModelBudgetEntry[],
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

  return violations;
}

/**
 * Assert the ceiling really is a reduction of at least half the recorded
 * baseline, which is what issue #2278 requires.
 */
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
      `MAX_REAL_MODEL_API_REQUESTS (${maxApiRequests}) must be at most half of BASELINE_REAL_MODEL_API_REQUESTS (${baselineApiRequests}), i.e. <= ${halfBaseline}. Issue #2278 requires a >= 50% reduction from the measured baseline.`,
    );
  }

  return violations;
}

/**
 * Catch drift between the budget and the tests it claims to describe. The
 * ledger records the name passed to `rig.setup()`, so a budget entry naming a
 * string no `rig.setup()` call uses can never match anything and is dead.
 */
export function validateBudgetNamesAreUsed(
  budget: readonly RealModelBudgetEntry[],
  setupNames: ReadonlySet<string>,
): readonly string[] {
  return budget
    .filter((entry) => !setupNames.has(entry.testName))
    .map(
      (entry) =>
        `Budget entry "${entry.testName}" matches no rig.setup() call in integration-tests/. ` +
        `Either the test was renamed or removed, or the entry is a typo; the ledger can never match it.`,
    );
}

/** Extract every string literal passed as the first argument to `rig.setup(`. */
export function extractSetupNames(source: string): readonly string[] {
  const names: string[] = [];
  const pattern = /\.setup\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[2];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

/**
 * A failure to scan the test tree is an environment fault, not a budget
 * violation, so it is not folded into the violation list — that would report a
 * broken checkout as a budget problem. It is rethrown with the offending path so
 * the message is actionable instead of a bare filesystem stack trace.
 */
export function collectSetupNames(directory: string): ReadonlySet<string> {
  let fileNames: readonly string[];
  try {
    fileNames = readdirSync(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot scan integration tests at ${directory}: ${message}. ` +
        `The budget guard must run from a complete checkout.`,
    );
  }

  const names = new Set<string>();
  for (const fileName of fileNames) {
    if (!fileName.endsWith('.test.ts')) {
      continue;
    }
    const filePath = join(directory, fileName);
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read ${filePath}: ${message}`);
    }
    for (const name of extractSetupNames(source)) {
      names.add(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Ledger checks
// ---------------------------------------------------------------------------

export interface LedgerCheckResult {
  readonly violations: readonly string[];
  readonly totalApiRequests: number;
  /** Recorded run count per test name, including retry duplicates. */
  readonly runsPerTest: ReadonlyMap<string, number>;
}

export function checkLedgerAgainstBudget(
  records: readonly RealProviderRunRecord[],
  budget: readonly RealModelBudgetEntry[],
  maxApiRequests: number,
): LedgerCheckResult {
  const violations: string[] = [];
  const costByTest = new Map(
    budget.map((entry) => [entry.testName, entry.apiRequestsPerRun]),
  );

  const runsPerTest = new Map<string, number>();
  for (const record of records) {
    runsPerTest.set(
      record.testName,
      (runsPerTest.get(record.testName) ?? 0) + 1,
    );
  }

  let totalApiRequests = 0;
  for (const testName of runsPerTest.keys()) {
    const cost = costByTest.get(testName);
    if (cost === undefined) {
      violations.push(
        `Recorded test "${testName}" is not in the real-model budget. ` +
          `Either give the test a fakeResponsesPath so its model turn is replayed from a fixture, ` +
          `or add an entry to integration-tests/real-model-budget.ts with its measured ` +
          `apiRequestsPerRun and a justification.`,
      );
      continue;
    }
    totalApiRequests += cost;
  }

  if (totalApiRequests > maxApiRequests) {
    violations.push(
      `Real-model API requests for the distinct tests recorded (${totalApiRequests}) exceeds the ceiling (${maxApiRequests}).`,
    );
  }

  return { violations, totalApiRequests, runsPerTest };
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
    `Ceiling: ${maxApiRequests} | Baseline: ${baselineApiRequests} | ` +
      `API requests for distinct tests recorded: ${result.totalApiRequests}`,
    '',
  ];

  if (result.runsPerTest.size === 0) {
    lines.push('No real-provider runs recorded.');
  } else {
    lines.push('Distinct tests recorded (run count includes retries):');
    for (const [testName, runs] of result.runsPerTest) {
      const cost = costByTest.get(testName);
      const costLabel = cost === undefined ? 'UNBUDGETED' : `${cost}`;
      const retryNote = runs > 1 ? ` (retried: ${runs} runs)` : '';
      lines.push(`  ${testName}: ${costLabel} req${retryNote}`);
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

/**
 * An absent ledger means no real-provider run happened on this leg — for
 * instance when every budgeted test was skipped for the platform. That is
 * within the ceiling, so it is reported as zero rather than treated as an error.
 */
function readLedgerRecords(
  ledgerPath: string,
): readonly RealProviderRunRecord[] {
  if (!existsSync(ledgerPath)) {
    console.log(`No ledger at ${ledgerPath}; no real-provider runs occurred.`);
    return [];
  }
  return readLedger(ledgerPath);
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

  let setupNames: ReadonlySet<string>;
  try {
    setupNames = collectSetupNames(INTEGRATION_TESTS_DIR);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const violations: string[] = [
    ...validateBudget(REAL_MODEL_RUN_BUDGET),
    ...validateBudgetPolicy(
      MAX_REAL_MODEL_API_REQUESTS,
      BASELINE_REAL_MODEL_API_REQUESTS,
    ),
    ...validateBudgetNamesAreUsed(REAL_MODEL_RUN_BUDGET, setupNames),
  ];

  if (ledgerPath === undefined) {
    console.log(
      `Budget validation: ${REAL_MODEL_RUN_BUDGET.length} entries, ` +
        `ceiling=${MAX_REAL_MODEL_API_REQUESTS}, ` +
        `measured baseline=${BASELINE_REAL_MODEL_API_REQUESTS}`,
    );
  } else {
    let records: readonly RealProviderRunRecord[];
    try {
      records = readLedgerRecords(ledgerPath);
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
