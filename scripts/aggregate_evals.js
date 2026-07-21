#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Aggregate eval results from current and historical runs.
 *
 * Usage:
 *   node scripts/aggregate_evals.js [artifacts-dir]
 *
 * Where artifacts-dir is the directory containing downloaded GitHub Actions
 * artifacts (each artifact is a subdirectory with a report.json file).
 * Defaults to current directory if not specified.
 *
 * Outputs a GitHub-flavored Markdown summary to stdout.
 *
 * Exit codes:
 *   0 - at least one report with usable assertions was aggregated
 *   1 - no reports found, or reports contained no usable assertion data
 *
 * Environment:
 *   AGGREGATE_SKIP_HISTORICAL=1 - skip fetching historical workflow runs
 *     (useful in tests and when GH_TOKEN is unavailable)
 *
 * Architecture: this is a thin orchestrator. The cohesive concerns live in:
 *   - aggregate-evals-schema.js      (strict current-report schema/parser,
 *                                     stats merge; historical reports reuse
 *                                     the SAME strict parser)
 *   - aggregate-evals-historical.js  (retention window, pagination, download)
 *   - aggregate-evals-cardinality.js (artifact identity, cardinality,
 *                                     expected-attempts CLI/env parsing)
 *
 * The cardinality and historical helpers used by tests are re-exported from
 * here so the CLI entry point and the test-facing API stay compatible. The
 * schema/parser helpers (parseCurrentReport, aggregateStats) are consumed
 * internally by this orchestrator and the historical module; they are NOT
 * re-exported because no consumer requires them via this module's public API
 * surface.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCurrentReport,
  aggregateStats,
} from './aggregate-evals-schema.js';
import {
  isWithinRetentionWindow,
  selectRunsInWindow,
  listWorkflowRunsInWindow,
  fetchHistoricalData,
  normalizeRunEntry,
} from './aggregate-evals-historical.js';
import {
  extractAttemptFromPath,
  validateCardinality,
  validateTopLevelArtifactDirs,
  parseExpectedAttempts,
  resolveExpectedAttempts,
} from './aggregate-evals-cardinality.js';

// Re-export the test-facing API so the CLI entry point and existing dynamic
// imports (loadAggregateModule) stay compatible after decomposition. Only the
// cardinality and historical helpers that tests consume via this module are
// re-exported; the schema/parser helpers are internal-only.
export {
  isWithinRetentionWindow,
  selectRunsInWindow,
  listWorkflowRunsInWindow,
  normalizeRunEntry,
};
export {
  extractAttemptFromPath,
  validateCardinality,
  validateTopLevelArtifactDirs,
  parseExpectedAttempts,
};

const REPO_URL = 'https://github.com/vybestack/llxprt-code';

/**
 * Recursively find all report.json files in a directory tree.
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of absolute paths to report.json files
 */
function findReports(dir) {
  const reports = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      findReportsEntry(join(dir, entry), entry, reports);
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
    console.error(`Warning: Could not read directory ${dir}: ${err.message}`);
  }
  return reports;
}

function findReportsEntry(fullPath, entry, reports) {
  try {
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      reports.push(...findReports(fullPath));
    } else if (entry === 'report.json') {
      reports.push(fullPath);
    }
  } catch (err) {
    // Skip entries that can't be read
    console.error(`Warning: Could not read ${fullPath}: ${err.message}`);
  }
}

/**
 * Strictly aggregate CURRENT reports. Any malformed current report fails the
 * whole aggregation closed; the result is only usable when every report is
 * valid and at least one passed/failed assertion was recorded.
 *
 * Each per-report parse is wrapped in try/catch so an UNEXPECTED exception
 * (not a normal schema validation error — those are already recorded as
 * diagnostics by the parser) fails closed with a fatal error message instead
 * of crashing the script with an uncaught exception and bypassing the
 * exit-code-1 contract. Normal strict diagnostics are never lost: the parsed
 * result's own errors array is still accumulated.
 *
 * @param {string[]} reports - Array of report.json paths
 * @param {(reportPath: string) => {valid: boolean, stats: Map<string, {pass: number, fail: number, total: number}>, errors: string[], usableAssertions: number}} [parseReport] -
 *   injectable report parser (defaults to the strict `parseCurrentReport`)
 * @returns {{valid: boolean, stats: Map<string, {pass: number, fail: number, total: number}>, errors: string[], usableAssertions: number, reports: string[]}}
 */
export function aggregateReports(reports, parseReport = parseCurrentReport) {
  const stats = new Map();
  const errors = [];
  let usableAssertions = 0;

  for (const reportPath of reports) {
    let parsed;
    try {
      parsed = parseReport(reportPath);
    } catch (err) {
      // An unexpected exception during parsing must fail closed rather than
      // crash the script. Normal schema diagnostics are returned (not thrown)
      // by the parser; this guards against unforeseen throws.
      errors.push(
        `Fatal error parsing ${reportPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    aggregateStats(stats, parsed.stats);
    errors.push(...parsed.errors);
    usableAssertions += parsed.usableAssertions;
  }

  return {
    valid: errors.length === 0 && usableAssertions > 0,
    stats,
    errors,
    usableAssertions,
  };
}

/**
 * Append historical pass-rate cells to a markdown table row.
 */
function appendHistoricalPassRates(
  row,
  historicalRuns,
  historicalStats,
  testName,
) {
  for (const runId of historicalRuns) {
    const runStats = historicalStats.get(runId);
    const testStats = runStats?.get(testName);
    if (testStats && testStats.total > 0) {
      const passRate = ((testStats.pass / testStats.total) * 100).toFixed(0);
      row.push(`${passRate}%`);
    } else {
      row.push('—');
    }
  }
}

/**
 * Build the Markdown table header row (Test | [Run N]* | Current) and its
 * alignment row, parameterized by the historical run ids.
 * @param {string[]} historicalRuns
 * @returns {{headers: string[], alignments: string[]}}
 */
function buildTableHeader(historicalRuns) {
  const headers = ['Test'];
  const alignments = [':---'];

  if (historicalRuns.length > 0) {
    for (const runId of historicalRuns) {
      headers.push(`[Run ${runId}](${REPO_URL}/actions/runs/${runId})`);
      alignments.push(':---:');
    }
  }
  headers.push('**Current**');
  alignments.push(':---:');
  return { headers, alignments };
}

/**
 * Build a single Markdown table row for a test name, including the historical
 * pass-rate cells and the current-run pass rate.
 * @param {string} testName
 * @param {{pass: number, fail: number, total: number}} currentTestStats
 * @param {string[]} historicalRuns
 * @param {Map<string, Map<string, {pass: number, fail: number, total: number}>>} historicalStats
 * @returns {string[]}
 */
function buildTestRow(
  testName,
  currentTestStats,
  historicalRuns,
  historicalStats,
) {
  const row = [];

  // Test name with search link
  const searchUrl = `${REPO_URL}/search?q=${encodeURIComponent(testName)}&type=code`;
  row.push(`[${testName}](${searchUrl})`);

  // Historical pass rates
  if (historicalRuns.length > 0) {
    appendHistoricalPassRates(row, historicalRuns, historicalStats, testName);
  }

  // Current run pass rate
  if (currentTestStats && currentTestStats.total > 0) {
    const passRate = (
      (currentTestStats.pass / currentTestStats.total) *
      100
    ).toFixed(0);
    row.push(`**${passRate}%**`);
  } else {
    row.push('**—**');
  }
  return row;
}

/**
 * Generate a Markdown summary table.
 * @param {Map<string, {pass: number, fail: number, total: number}>} currentStats - Current run stats
 * @param {Map<string, Map<string, {pass: number, fail: number, total: number}>>} historicalStats - Historical stats
 * @returns {string} - Markdown table
 */
function generateMarkdown(currentStats, historicalStats) {
  const lines = [];

  lines.push('# Eval Results Summary\n');

  if (currentStats.size === 0) {
    lines.push('_No eval results found in current run._\n');
    return lines.join('\n');
  }

  // Calculate total pass rate for current run
  let totalPass = 0;
  let totalTests = 0;
  for (const stats of currentStats.values()) {
    totalPass += stats.pass;
    totalTests += stats.total;
  }
  const overallPassRate =
    totalTests > 0 ? ((totalPass / totalTests) * 100).toFixed(1) : '0.0';

  lines.push(
    `**Overall Pass Rate:** ${overallPassRate}% (${totalPass}/${totalTests} tests passed)\n`,
  );

  // Build table header
  const historicalRuns = Array.from(historicalStats.keys());
  const { headers, alignments } = buildTableHeader(historicalRuns);

  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${alignments.join(' | ')} |`);

  // Sort test names alphabetically
  const testNames = Array.from(currentStats.keys()).sort();

  for (const testName of testNames) {
    const row = buildTestRow(
      testName,
      currentStats.get(testName),
      historicalRuns,
      historicalStats,
    );
    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('\n');
  lines.push(
    `_For more information about evals, see [evals/README.md](${REPO_URL}/blob/main/evals/README.md)._\n`,
  );

  return lines.join('\n');
}

/**
 * Run aggregation over an artifacts directory. Returns the exit code so the
 * CLI entry point can propagate success/failure.
 *
 * @param {string} artifactsDir - Directory containing downloaded artifacts
 * @param {number[]} expectedAttempts - expected matrix attempt identities
 * @returns {number} 0 when usable results were aggregated, 1 otherwise
 */
function aggregateArtifacts(artifactsDir, expectedAttempts) {
  // First validate the DIRECT TOP-LEVEL artifact directories. The GitHub
  // download-artifact action lays out one directory per artifact, so any extra
  // or stray top-level directory must be rejected even when it carries no
  // report. This runs before report discovery so a stray artifact is caught
  // regardless of whether it happens to contain a report.json.
  const topLevelErrors = validateTopLevelArtifactDirs(
    artifactsDir,
    expectedAttempts,
  );
  if (topLevelErrors.length > 0) {
    for (const error of topLevelErrors) {
      console.error(`Error: ${error}`);
    }
    console.error(
      `Aggregation aborted: ${topLevelErrors.length} top-level artifact cardinality issue(s) under ${artifactsDir} (expected attempts ${JSON.stringify(expectedAttempts)}).`,
    );
    return 1;
  }

  const reports = findReports(artifactsDir);

  if (reports.length === 0) {
    console.log(`No reports found under ${artifactsDir}.`);
    return 1;
  }

  const cardinalityErrors = validateCardinality(reports, expectedAttempts);
  if (cardinalityErrors.length > 0) {
    for (const error of cardinalityErrors) {
      console.error(`Error: ${error}`);
    }
    console.error(
      `Aggregation aborted: ${cardinalityErrors.length} cardinality issue(s) under ${artifactsDir} (expected attempts ${JSON.stringify(expectedAttempts)}).`,
    );
    return 1;
  }

  const aggregated = aggregateReports(reports);

  // Fail closed for ANY malformed current report: a single invalid report
  // means result collection is broken and must not be masked by valid ones.
  if (aggregated.errors.length > 0) {
    for (const error of aggregated.errors) {
      console.error(`Error: ${error}`);
    }
    console.error(
      `Aggregation aborted: ${aggregated.errors.length} malformed current report issue(s) in ${reports.length} report(s) under ${artifactsDir}.`,
    );
    return 1;
  }

  // Defensive backstop: per-report strictness already fails closed on reports
  // with zero usable assertions, so this branch should be unreachable in
  // practice. It is retained as a guard against regressions in that logic.
  if (aggregated.usableAssertions === 0 || aggregated.stats.size === 0) {
    console.log(
      `No usable assertion data found in ${reports.length} report(s) under ${artifactsDir}.`,
    );
    return 1;
  }

  let historicalStats = new Map();
  try {
    historicalStats = fetchHistoricalData();
  } catch (err) {
    console.error(
      `Warning: Could not fetch historical data, continuing with current run only: ${err.message}`,
    );
  }

  const markdown = generateMarkdown(aggregated.stats, historicalStats);
  console.log(markdown);
  return 0;
}

function main() {
  const artifactsDir = process.argv[2] || '.';
  let expectedAttempts;
  try {
    expectedAttempts = resolveExpectedAttempts(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = aggregateArtifacts(artifactsDir, expectedAttempts);
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  main();
}
