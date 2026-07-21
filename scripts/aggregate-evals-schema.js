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
export function resolveTestName(assertion) {
  const fullName =
    typeof assertion.fullName === 'string' ? assertion.fullName.trim() : '';
  const title =
    typeof assertion.title === 'string' ? assertion.title.trim() : '';
  const name = fullName || title;
  return name.length > 0 ? name : null;
}

/**
 * Result of parsing a report: an explicit validation state.
 * @typedef {Object} ParsedReport
 * @property {boolean} valid - false when the report is structurally or
 *   semantically malformed and must fail the aggregation closed.
 * @property {Map<string, {pass: number, fail: number, total: number}>} stats -
 *   Per-test pass/fail/total. `total` is pass+fail only (skipped/pending
 *   excluded) so the pass-rate denominator is never corrupted.
 * @property {string[]} errors - Human-readable validation errors.
 * @property {number} usableAssertions - count of passed/failed assertions.
 */

/**
 * Record a single usable assertion result into the stats map. Only passed/failed
 * assertions contribute to pass/fail/total; skipped/pending are ignored here so
 * they cannot inflate the pass-rate denominator.
 */
export function recordUsableAssertion(stats, assertion) {
  const testName = resolveTestName(assertion);
  const status = assertion.status;

  if (!stats.has(testName)) {
    stats.set(testName, { pass: 0, fail: 0, total: 0 });
  }
  const testStats = stats.get(testName);
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
export function validateAssertion(assertion) {
  if (!assertion || typeof assertion !== 'object') {
    return 'assertion is not an object';
  }
  if (resolveTestName(assertion) === null) {
    return 'assertion is missing a nonempty title/fullName';
  }
  const status = assertion.status;
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
export function readReportCounter(report, field) {
  if (report === null || typeof report !== 'object') {
    return null;
  }
  const value = report[field];
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
export function readStrictCounter(report, field) {
  if (report === null || typeof report !== 'object') {
    return null;
  }
  if (!(field in report)) {
    return null;
  }
  const value = report[field];
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
export function readOptionalCounter(report, field) {
  try {
    return readStrictCounter(report, field);
  } catch {
    return null;
  }
}

/**
 * Validate the assertionResults of a single testResult (suite) for
 * current-report strictness. Records usable assertions into `stats`/`totals`
 * and returns the count of failed assertions within this suite, so the caller
 * can detect unrepresented suite-level failures. Also tallies the
 * non-denominator statuses so the caller can reconcile them with the report's
 * top-level counters:
 *   - `pending` AND `skipped` both map to `totals.pending`, because real
 *     Vitest 3.2.6 reports both inside `numPendingTests`;
 *   - the deferred status maps to `totals.deferred` (reconciles with
 *     `numTodoTests`).
 *
 * Neither pending/skipped nor the deferred status contribute to the pass-rate
 * denominator.
 *
 * @returns {number} the number of failed assertions in this suite.
 */
export function validateSuite(reportPath, testResult, stats, totals, errors) {
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
      continue;
    }
    if (USABLE_STATUSES.has(assertion.status)) {
      recordUsableAssertion(stats, assertion);
      totals.usable++;
      if (assertion.status === 'passed') {
        totals.passed++;
      }
      if (assertion.status === 'failed') {
        totals.failed++;
        suiteFailed++;
      }
    } else if (
      assertion.status === 'pending' ||
      assertion.status === 'skipped'
    ) {
      // Real Vitest 3.2.6 counts BOTH pending and skipped inside
      // numPendingTests, so both map to the pending cohort here.
      totals.pending++;
    } else if (assertion.status === 'todo') {
      totals.deferred++;
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
    // status is present but not a string (numeric, null, array, object).
    // An omitted status is accepted (real Vitest reports may omit it), but a
    // present non-string status is malformed and must fail closed.
    const suiteName = testResult.name ?? '<unknown>';
    errors.push(
      `${reportPath}: testResult "${suiteName}" status must be a string (got ${typeof testResult.status})`,
    );
  }

  return suiteFailed;
}

/**
 * Detect unrepresented failures at the report level: an explicit
 * report.success=false, or failed-suite/test counters, must each be backed by
 * at least one failed assertion within the same report.
 */
export function validateReportLevelFailureCounts(
  reportPath,
  report,
  failedAssertions,
  errors,
) {
  if (report?.success === false && failedAssertions === 0) {
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

/**
 * Explicit human-readable label for each counter field, used in validation
 * error messages. Replaces fragile string manipulation (e.g.
 * `field.replace('num','').toLowerCase().replace('tests','')`) that produced
 * garbled labels like `totaluites` for `numTotalTestSuites`.
 */
const COUNTER_FIELD_LABELS = {
  numPassedTests: 'passed',
  numFailedTests: 'failed',
  numPendingTests: 'pending',
  numTodoTests: 'todo',
};

/**
 * Validate that each exact top-level test counter, when present, EQUALS the
 * count of represented assertions of that status. A counter greater than the
 * represented assertions indicates truncation/corruption; a counter less than
 * the represented assertions indicates the assertion list was inflated.
 */
function validateTestCountersEqualRepresented(
  reportPath,
  report,
  counts,
  errors,
) {
  const pairs = [
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

/**
 * Validate that suite-level counters reconcile among themselves when the
 * relevant counters are present: numTotalTestSuites, when present alongside
 * numPassedTestSuites/numFailedTestSuites/numPendingTestSuites, must equal
 * passed+failed+pending. Suites are deliberately NOT equated to the count of
 * testResults entries because a single testResult file can hold many assertions
 * and one logical suite may span multiple files (or vice versa).
 */
function validateSuiteCountersReconcile(reportPath, report, errors) {
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

/**
 * Validate the top-level schema of a CURRENT report for strictness. When these
 * optional fields are PRESENT, they must be well-formed and reconcile with the
 * represented assertions:
 *   - `success` must be a boolean;
 *   - the test counters must be nonnegative integers;
 *   - each exact test counter, when present, must EQUAL the count of
 *     represented assertions of that status;
 *   - numTotalTests, when present alongside the component counters, must equal
 *     the sum of the components;
 *   - numTotalTests, when present, must EXACTLY equal the count of represented
 *     assertionResults (even when the component counters are absent);
 *   - success=true must not coexist with a positive failed counter or a
 *     positive represented failed-assertion count;
 *   - the suite counters must reconcile AMONG THEMSELVES when present together,
 *     but suites are NOT equated to testResults files.
 *
 * Fields that are absent are not required (optional-field compatibility with
 * real Vitest reports that omit counters).
 *
 * @param {string} reportPath
 * @param {object} report - parsed report object
 * @param {{usable: number, failed: number, passed: number, represented: number, pending: number, deferred: number}} counts -
 *   tallies derived from the represented assertionResults
 * @param {string[]} errors - accumulator for validation errors
 */
export function validateReportTopLevel(reportPath, report, counts, errors) {
  if (report === null || typeof report !== 'object') {
    return;
  }

  validateSuccessField(reportPath, report, errors);
  validateCounterTypes(reportPath, report, errors);
  validateTestCountersEqualRepresented(reportPath, report, counts, errors);
  validateTotalTestsReconcile(reportPath, report, errors);
  validateTotalEqualsRepresented(reportPath, report, counts, errors);
  validateSuccessConsistency(reportPath, report, counts, errors);
  validateSuiteCountersReconcile(reportPath, report, errors);
}

function validateSuccessField(reportPath, report, errors) {
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

function validateCounterTypes(reportPath, report, errors) {
  for (const field of COUNTER_FIELDS) {
    try {
      readStrictCounter(report, field);
    } catch (err) {
      errors.push(`${reportPath}: ${err.message}`);
    }
  }
}

function validateTotalTestsReconcile(reportPath, report, errors) {
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

/**
 * Validate that numTotalTests, when present, EXACTLY equals the count of
 * represented assertionResults — even when the component counters
 * (numPassedTests/numFailedTests/numPendingTests/numTodoTests) are absent.
 * A mismatch in either direction indicates truncation/corruption.
 */
function validateTotalEqualsRepresented(reportPath, report, counts, errors) {
  const totalTests = readOptionalCounter(report, 'numTotalTests');
  if (totalTests !== null && counts.represented !== totalTests) {
    errors.push(
      `${reportPath}: represented assertions (${counts.represented}) do not equal numTotalTests (${totalTests})`,
    );
  }
}

function validateSuccessConsistency(reportPath, report, counts, errors) {
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

/**
 * Strictly parse a CURRENT vitest JSON report. Each current report must
 * INDEPENDENTLY satisfy all of:
 *   - be structurally valid (testResults array, each testResult an
 *     assertionResults array, every assertion recognized);
 *   - contribute at least one usable passed/failed assertion (empty
 *     testResults, empty assertionResults, and non-denominator-status-only
 *     reports carry no pass/fail signal and fail closed);
 *   - be free of unrepresented failures.
 *
 * Optional top-level counters are NOT required to be present: an ordinary
 * valid vitest report that omits them is accepted.
 *
 * @param {string} reportPath - Path to report.json
 * @returns {ParsedReport}
 */
export function parseCurrentReport(reportPath) {
  const stats = new Map();
  const errors = [];
  const totals = {
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

  for (const testResult of report.testResults) {
    validateSuite(reportPath, testResult, stats, totals, errors);
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

/**
 * Read and JSON-parse a report file. On failure, record an error and return
 * null. On success, return the parsed object.
 */
function readAndParseReport(reportPath, errors) {
  try {
    const content = readFileSync(reportPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    errors.push(`Could not parse ${reportPath}: ${err.message}`);
    return null;
  }
}

/**
 * Merge a set of report stats into the aggregated stats map.
 */
export function aggregateStats(target, source) {
  for (const [testName, stats] of source) {
    if (!target.has(testName)) {
      target.set(testName, { pass: 0, fail: 0, total: 0 });
    }
    const aggregated = target.get(testName);
    aggregated.pass += stats.pass;
    aggregated.fail += stats.fail;
    aggregated.total += stats.total;
  }
}
