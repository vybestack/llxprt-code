/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strict parsing and validation of Vitest JSON eval reports. Extracted from
 * aggregate_evals.js so the schema rules are cohesive and independently
 * testable. Historical reports reuse the SAME strict parser
 * (parseCurrentReport) as current reports — there is no lenient historical
 * parser. This module reads and parses report files from the filesystem
 * (readFileSync); it performs no process spawning.
 */

import { readFileSync } from 'node:fs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface TestStats {
  pass: number;
  fail: number;
  total: number;
}

interface AssertionRecord {
  fullName?: string;
  title?: string;
  status?: string;
}

interface TestResultRecord {
  name?: string;
  status?: unknown;
  assertionResults?: unknown[];
}

interface ParsedReport {
  valid: boolean;
  stats: Map<string, TestStats>;
  errors: string[];
  usableAssertions: number;
  testResults?: unknown[];
  success?: unknown;
  [key: string]: unknown;
}

interface Totals {
  usable: number;
  failed: number;
  passed: number;
  represented: number;
  pending: number;
  deferred: number;
}

/**
 * Assertion statuses that carry a usable pass/fail signal for the pass-rate
 * denominator.
 */
export const USABLE_STATUSES = new Set(['passed', 'failed']);
/**
 * Recognized statuses that do NOT contribute to the pass-rate denominator.
 * They are valid (not malformed) but are excluded from pass/fail/total.
 */
export const NON_DENOMINATOR_STATUSES = new Set(['skipped', 'pending', 'todo']);
export const RECOGNIZED_STATUSES = new Set([
  ...USABLE_STATUSES,
  ...NON_DENOMINATOR_STATUSES,
]);

/**
 * The only testResult.status values real Vitest JSON reports emit for a
 * collected suite. When present, testResult.status must be one of these. A
 * 'failed' status requires at least one failed assertion; a 'passed' status
 * forbids any failed assertion.
 */
export const RECOGNIZED_SUITE_STATUSES = new Set(['passed', 'failed']);

/**
 * Resolve a nonempty test name from an assertion's fullName/title. Prefers
 * `fullName` over `title` so two assertions that share a short `title` but live
 * in different suites (and therefore have distinct `fullName`s) produce
 * distinct stats keys instead of being collapsed. The Vitest JSON reporter
 * derives `fullName` as `[...ancestorTitles, name].join(" ")` (space-joined);
 * the " > " separator is a CLI-list-only convention and does not appear in the
 * JSON report the aggregator consumes.
 * @returns {string|null} null when no usable name is present.
 */
export function resolveTestName(assertion: {
  fullName?: string;
  title?: string;
}): string | null {
  const fullName =
    typeof assertion.fullName === 'string' ? assertion.fullName.trim() : '';
  const title =
    typeof assertion.title === 'string' ? assertion.title.trim() : '';
  const name = fullName || title;
  return name.length > 0 ? name : null;
}

/**
 * Record a single usable assertion result into the stats map. Only passed/failed
 * assertions contribute to pass/fail/total; skipped/pending are ignored here so
 * they cannot inflate the pass-rate denominator.
 */
export function recordUsableAssertion(
  stats: Map<string, TestStats>,
  assertion: AssertionRecord,
): void {
  const testName = resolveTestName(assertion);
  const status = assertion.status;

  if (testName === null) return;
  let testStats = stats.get(testName);
  if (testStats === undefined) {
    testStats = { pass: 0, fail: 0, total: 0 };
    stats.set(testName, testStats);
  }
  testStats.total++;
  if (status === 'passed') {
    testStats.pass++;
  } else if (status === 'failed') {
    testStats.fail++;
  }
}

/**
 * Validate a single assertion for current-report strictness.
 * @returns {string|null} an error message when malformed, null when valid.
 */
export function validateAssertion(assertion: unknown): string | null {
  if (!isRecord(assertion)) {
    return 'assertion is not an object';
  }
  const rec = assertion;
  if (resolveTestName(rec) === null) {
    return 'assertion is missing a nonempty title/fullName';
  }
  const status = rec.status;
  if (typeof status !== 'string' || status.length === 0) {
    return 'assertion is missing a status';
  }
  if (!RECOGNIZED_STATUSES.has(status)) {
    return `assertion has unrecognized status "${status}"`;
  }
  return null;
}

/**
 * Read a nonnegative integer field from a parsed report object, returning null
 * when the field is absent or not a usable counter. Used for optional vitest
 * top-level counters so their absence does not by itself reject an otherwise
 * valid report.
 * @returns {number|null}
 */
export function readReportCounter(
  report: unknown,
  field: string,
): number | null {
  if (!isRecord(report)) {
    return null;
  }
  const rec = report;
  const value = rec[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * Strictly read a nonnegative integer counter that MUST be valid when present.
 * Returns null only when the field is absent. When present but not a finite
 * nonnegative integer, throws with a descriptive message so the caller can
 * record the schema error.
 * @returns {number|null}
 * @throws {Error} when the field is present but not a valid counter.
 */
export function readStrictCounter(
  report: unknown,
  field: string,
): number | null {
  if (!isRecord(report)) {
    return null;
  }
  const rec = report;
  if (!(field in rec)) {
    return null;
  }
  const value = rec[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${field} must be a nonnegative integer (got ${String(value)})`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer (got ${value})`);
  }
  return value;
}

/**
 * Read an optional counter using the strict reader, returning null when absent
 * or when invalid (invalid values are already recorded as errors by the caller
 * loop, so this helper only needs the numeric value or null).
 * @returns {number|null}
 */
export function readOptionalCounter(
  report: unknown,
  field: string,
): number | null {
  try {
    return readStrictCounter(report, field);
  } catch {
    return null;
  }
}

function recordAssertionOutcome(
  assertion: AssertionRecord,
  stats: Map<string, TestStats>,
  totals: Totals,
): number {
  if (
    typeof assertion.status === 'string' &&
    USABLE_STATUSES.has(assertion.status)
  ) {
    recordUsableAssertion(stats, assertion);
    totals.usable++;
    if (assertion.status === 'passed') totals.passed++;
    if (assertion.status === 'failed') {
      totals.failed++;
      return 1;
    }
  } else if (assertion.status === 'pending' || assertion.status === 'skipped') {
    totals.pending++;
  } else if (assertion.status === 'todo') {
    totals.deferred++;
  }
  return 0;
}

/**
 * Validate the assertionResults of a single testResult (suite) for
 * current-report strictness. Records usable assertions into `stats`/`totals`
 * and returns the count of failed assertions within this suite, so the caller
 * can detect unrepresented suite-level failures.
 *
 * @returns {number} the number of failed assertions in this suite.
 */
export function validateSuite(
  reportPath: string,
  testResult: TestResultRecord,
  stats: Map<string, TestStats>,
  totals: Totals,
  errors: string[],
): number {
  if (!testResult || !Array.isArray(testResult.assertionResults)) {
    errors.push(
      `Invalid report format in ${reportPath}: a testResult is missing an assertionResults array`,
    );
    return 0;
  }

  let suiteFailed = 0;
  for (const assertion of testResult.assertionResults) {
    totals.represented++;
    const assertionError = validateAssertion(assertion);
    if (assertionError !== null) {
      errors.push(`${reportPath}: ${assertionError}`);
    } else if (isRecord(assertion)) {
      suiteFailed += recordAssertionOutcome(assertion, stats, totals);
    }
  }

  if (typeof testResult.status === 'string') {
    const suiteName = testResult.name ?? '<unknown>';
    if (!RECOGNIZED_SUITE_STATUSES.has(testResult.status)) {
      errors.push(
        `${reportPath}: testResult "${suiteName}" has unrecognized status "${testResult.status}"`,
      );
    } else if (testResult.status === 'failed' && suiteFailed === 0) {
      errors.push(
        `${reportPath}: testResult "${suiteName}" is marked failed but has no failed assertions`,
      );
    } else if (testResult.status === 'passed' && suiteFailed > 0) {
      errors.push(
        `${reportPath}: testResult "${suiteName}" is marked passed but has ${suiteFailed} failed assertion(s)`,
      );
    }
  } else if ('status' in testResult) {
    const suiteName = testResult.name ?? '<unknown>';
    errors.push(
      `${reportPath}: testResult "${suiteName}" status must be a string (got ${typeof testResult.status})`,
    );
  }

  return suiteFailed;
}

/**
 * Detect unrepresented failures at the report level.
 */
export function validateReportLevelFailureCounts(
  reportPath: string,
  report: Record<string, unknown>,
  failedAssertions: number,
  errors: string[],
): void {
  if (report.success === false && failedAssertions === 0) {
    errors.push(
      `${reportPath}: report.success is false but no assertions are failed`,
    );
  }

  const failedSuites = readReportCounter(report, 'numFailedTestSuites');
  if (failedSuites !== null && failedSuites > 0 && failedAssertions === 0) {
    errors.push(
      `${reportPath}: numFailedTestSuites is ${failedSuites} but no assertions are failed`,
    );
  }

  const failedTests = readReportCounter(report, 'numFailedTests');
  if (failedTests !== null && failedTests > 0 && failedAssertions === 0) {
    errors.push(
      `${reportPath}: numFailedTests is ${failedTests} but no assertions are failed`,
    );
  }
}

const COUNTER_FIELD_LABELS: Record<string, string> = {
  numPassedTests: 'passed',
  numFailedTests: 'failed',
  numPendingTests: 'pending',
  numTodoTests: 'todo',
};

function validateTestCountersEqualRepresented(
  reportPath: string,
  report: Record<string, unknown>,
  counts: Totals,
  errors: string[],
): void {
  const pairs: Array<[string, number]> = [
    ['numPassedTests', counts.passed],
    ['numFailedTests', counts.failed],
    ['numPendingTests', counts.pending],
    ['numTodoTests', counts.deferred],
  ];
  for (const [field, represented] of pairs) {
    const counter = readOptionalCounter(report, field);
    if (counter !== null && counter !== represented) {
      const label = COUNTER_FIELD_LABELS[field] ?? field;
      errors.push(
        `${reportPath}: ${field} (${counter}) does not equal represented ${label} assertions (${represented})`,
      );
    }
  }
}

function validateSuiteCountersReconcile(
  reportPath: string,
  report: Record<string, unknown>,
  errors: string[],
): void {
  const totalSuites = readOptionalCounter(report, 'numTotalTestSuites');
  const passedSuites = readOptionalCounter(report, 'numPassedTestSuites');
  const failedSuites = readOptionalCounter(report, 'numFailedTestSuites');
  const pendingSuites = readOptionalCounter(report, 'numPendingTestSuites');

  if (
    totalSuites !== null &&
    passedSuites !== null &&
    failedSuites !== null &&
    pendingSuites !== null
  ) {
    const sumSuiteComponents = passedSuites + failedSuites + pendingSuites;
    if (totalSuites !== sumSuiteComponents) {
      errors.push(
        `${reportPath}: numTotalTestSuites (${totalSuites}) does not reconcile with passed+failed+pending suites (${sumSuiteComponents})`,
      );
    }
  }
}

export function validateReportTopLevel(
  reportPath: string,
  report: Record<string, unknown>,
  counts: Totals,
  errors: string[],
): void {
  validateSuccessField(reportPath, report, errors);
  validateCounterTypes(reportPath, report, errors);
  validateTestCountersEqualRepresented(reportPath, report, counts, errors);
  validateTotalTestsReconcile(reportPath, report, errors);
  validateTotalEqualsRepresented(reportPath, report, counts, errors);
  validateSuccessConsistency(reportPath, report, counts, errors);
  validateSuiteCountersReconcile(reportPath, report, errors);
}

function validateSuccessField(
  reportPath: string,
  report: Record<string, unknown>,
  errors: string[],
): void {
  if ('success' in report && typeof report.success !== 'boolean') {
    errors.push(
      `${reportPath}: success must be a boolean (got ${typeof report.success})`,
    );
  }
}

const COUNTER_FIELDS = [
  'numTotalTests',
  'numPassedTests',
  'numFailedTests',
  'numPendingTests',
  'numTodoTests',
  'numTotalTestSuites',
  'numPassedTestSuites',
  'numFailedTestSuites',
  'numPendingTestSuites',
];

function validateCounterTypes(
  reportPath: string,
  report: Record<string, unknown>,
  errors: string[],
): void {
  for (const field of COUNTER_FIELDS) {
    try {
      readStrictCounter(report, field);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${reportPath}: ${msg}`);
    }
  }
}

function validateTotalTestsReconcile(
  reportPath: string,
  report: Record<string, unknown>,
  errors: string[],
): void {
  const totalTests = readOptionalCounter(report, 'numTotalTests');
  const passed = readOptionalCounter(report, 'numPassedTests');
  const failed = readOptionalCounter(report, 'numFailedTests');
  const pending = readOptionalCounter(report, 'numPendingTests');
  const todo = readOptionalCounter(report, 'numTodoTests');

  if (
    totalTests !== null &&
    passed !== null &&
    failed !== null &&
    pending !== null
  ) {
    const sumComponents = passed + failed + pending + (todo ?? 0);
    if (totalTests !== sumComponents) {
      errors.push(
        `${reportPath}: numTotalTests (${totalTests}) does not reconcile with passed+failed+pending${todo !== null ? '+todo' : ''} (${sumComponents})`,
      );
    }
  }
}

function validateTotalEqualsRepresented(
  reportPath: string,
  report: Record<string, unknown>,
  counts: Totals,
  errors: string[],
): void {
  const totalTests = readOptionalCounter(report, 'numTotalTests');
  if (totalTests !== null && counts.represented !== totalTests) {
    errors.push(
      `${reportPath}: represented assertions (${counts.represented}) do not equal numTotalTests (${totalTests})`,
    );
  }
}

function validateSuccessConsistency(
  reportPath: string,
  report: Record<string, unknown>,
  counts: Totals,
  errors: string[],
): void {
  const failed = readOptionalCounter(report, 'numFailedTests');
  if (report.success === true && failed !== null && failed > 0) {
    errors.push(
      `${reportPath}: success is true but numFailedTests is ${failed}`,
    );
  }
  if (report.success === true && counts.failed > 0) {
    errors.push(
      `${reportPath}: success is true but ${counts.failed} failed assertions are represented`,
    );
  }
}

export function parseCurrentReport(reportPath: string): ParsedReport {
  const stats = new Map<string, TestStats>();
  const errors: string[] = [];
  const totals: Totals = {
    usable: 0,
    failed: 0,
    passed: 0,
    represented: 0,
    pending: 0,
    deferred: 0,
  };

  const report = readAndParseReport(reportPath, errors);
  if (report === null) {
    return { valid: false, stats, errors, usableAssertions: 0 };
  }

  if (!Array.isArray(report.testResults)) {
    return {
      valid: false,
      stats,
      errors: [
        `Invalid report format in ${reportPath}: testResults is not an array`,
      ],
      usableAssertions: 0,
    };
  }

  for (const testResult of report.testResults ?? []) {
    validateSuite(
      reportPath,
      isRecord(testResult) ? testResult : {},
      stats,
      totals,
      errors,
    );
  }

  if (totals.usable === 0) {
    errors.push(`${reportPath}: report has no usable passed/failed assertions`);
  }

  validateReportTopLevel(reportPath, report, totals, errors);
  validateReportLevelFailureCounts(reportPath, report, totals.failed, errors);

  return {
    valid: errors.length === 0,
    stats,
    errors,
    usableAssertions: totals.usable,
  };
}

function readAndParseReport(
  reportPath: string,
  errors: string[],
): Record<string, unknown> | null {
  try {
    const content = readFileSync(reportPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      errors.push(`Invalid report format in ${reportPath}: not an object`);
      return null;
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Could not parse ${reportPath}: ${msg}`);
    return null;
  }
}

export function aggregateStats(
  target: Map<string, TestStats>,
  source: Map<string, TestStats>,
): void {
  for (const [testName, stats] of source) {
    if (!target.has(testName)) {
      target.set(testName, { pass: 0, fail: 0, total: 0 });
    }
    const aggregated = target.get(testName);
    if (aggregated === undefined) {
      continue;
    }
    aggregated.pass += stats.pass;
    aggregated.fail += stats.fail;
    aggregated.total += stats.total;
  }
}
