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
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const WORKFLOW_NAME = 'evals-nightly.yml';
const MAX_HISTORICAL_RUNS = 10;
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
      const fullPath = join(dir, entry);
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
  } catch (err) {
    // Directory doesn't exist or can't be read
    console.error(`Warning: Could not read directory ${dir}: ${err.message}`);
  }
  return reports;
}

/**
 * Parse a vitest JSON report and extract test statistics.
 * @param {string} reportPath - Path to report.json
 * @returns {Map<string, {pass: number, fail: number, total: number}>}
 */
function getStats(reportPath) {
  const stats = new Map();
  try {
    const content = readFileSync(reportPath, 'utf-8');
    const report = JSON.parse(content);

    if (!report.testResults || !Array.isArray(report.testResults)) {
      console.error(
        `Warning: Invalid report format in ${reportPath}: missing testResults`,
      );
      return stats;
    }

    for (const testResult of report.testResults) {
      if (
        !testResult.assertionResults ||
        !Array.isArray(testResult.assertionResults)
      ) {
        continue;
      }

      for (const assertion of testResult.assertionResults) {
        const testName = assertion.title || assertion.fullName || 'unknown';
        const status = assertion.status || 'unknown';

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
    }
  } catch (err) {
    console.error(`Warning: Could not parse ${reportPath}: ${err.message}`);
  }
  return stats;
}

/**
 * Fetch historical eval data from previous nightly workflow runs.
 * @returns {Map<string, Map<string, {pass: number, fail: number, total: number}>>}
 *   Outer map: run ID -> inner map
 *   Inner map: test name -> stats
 */
function fetchHistoricalData() {
  const historical = new Map();

  try {
    // List completed workflow runs
    const listResult = spawnSync(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        WORKFLOW_NAME,
        '--status',
        'completed',
        '--limit',
        String(MAX_HISTORICAL_RUNS),
        '--json',
        'databaseId,conclusion,headSha',
      ],
      { encoding: 'utf-8' },
    );

    if (listResult.status !== 0) {
      console.error(
        `Warning: Could not list workflow runs: ${listResult.stderr}`,
      );
      return historical;
    }

    const runs = JSON.parse(listResult.stdout);
    if (!Array.isArray(runs) || runs.length === 0) {
      console.error(`Warning: No historical runs found for ${WORKFLOW_NAME}`);
      return historical;
    }

    // Create temporary directory for downloads
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-evals-'));

    try {
      for (const run of runs) {
        const runId = String(run.databaseId);
        const runDir = join(tempDir, runId);

        // Download artifacts for this run
        const downloadResult = spawnSync(
          'gh',
          ['run', 'download', runId, '-D', runDir],
          { encoding: 'utf-8' },
        );

        if (downloadResult.status !== 0) {
          console.error(
            `Warning: Could not download artifacts for run ${runId}: ${downloadResult.stderr}`,
          );
          continue;
        }

        // Find and parse all report.json files in this run's artifacts
        const reports = findReports(runDir);
        const runStats = new Map();

        for (const reportPath of reports) {
          const reportStats = getStats(reportPath);
          for (const [testName, stats] of reportStats) {
            if (!runStats.has(testName)) {
              runStats.set(testName, { pass: 0, fail: 0, total: 0 });
            }
            const aggregated = runStats.get(testName);
            aggregated.pass += stats.pass;
            aggregated.fail += stats.fail;
            aggregated.total += stats.total;
          }
        }

        if (runStats.size > 0) {
          historical.set(runId, runStats);
        }
      }
    } finally {
      // Clean up temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error(
          `Warning: Could not clean up temp directory ${tempDir}: ${err.message}`,
        );
      }
    }
  } catch (err) {
    console.error(`Warning: Could not fetch historical data: ${err.message}`);
  }

  return historical;
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

  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${alignments.join(' | ')} |`);

  // Sort test names alphabetically
  const testNames = Array.from(currentStats.keys()).sort();

  for (const testName of testNames) {
    const row = [];

    // Test name with search link
    const searchUrl = `${REPO_URL}/search?q=${encodeURIComponent(testName)}&type=code`;
    row.push(`[${testName}](${searchUrl})`);

    // Historical pass rates
    if (historicalRuns.length > 0) {
      for (const runId of historicalRuns) {
        const runStats = historicalStats.get(runId);
        const testStats = runStats?.get(testName);
        if (testStats && testStats.total > 0) {
          const passRate = ((testStats.pass / testStats.total) * 100).toFixed(
            0,
          );
          row.push(`${passRate}%`);
        } else {
          row.push('—');
        }
      }
    }

    // Current run pass rate
    const currentTestStats = currentStats.get(testName);
    if (currentTestStats && currentTestStats.total > 0) {
      const passRate = (
        (currentTestStats.pass / currentTestStats.total) *
        100
      ).toFixed(0);
      row.push(`**${passRate}%**`);
    } else {
      row.push('**—**');
    }

    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('\n');
  lines.push(
    `_For more information about evals, see [evals/README.md](${REPO_URL}/blob/main/evals/README.md)._\n`,
  );

  return lines.join('\n');
}

/**
 * Main entry point
 */
function main() {
  const artifactsDir = process.argv[2] || '.';

  // Find all report.json files in the artifacts directory
  const reports = findReports(artifactsDir);

  if (reports.length === 0) {
    console.log('No reports found.');
    return;
  }

  // Aggregate current run stats
  const currentStats = new Map();
  for (const reportPath of reports) {
    const reportStats = getStats(reportPath);
    for (const [testName, stats] of reportStats) {
      if (!currentStats.has(testName)) {
        currentStats.set(testName, { pass: 0, fail: 0, total: 0 });
      }
      const aggregated = currentStats.get(testName);
      aggregated.pass += stats.pass;
      aggregated.fail += stats.fail;
      aggregated.total += stats.total;
    }
  }

  // Fetch historical data
  let historicalStats = new Map();
  try {
    historicalStats = fetchHistoricalData();
  } catch (err) {
    console.error(
      `Warning: Could not fetch historical data, continuing with current run only: ${err.message}`,
    );
  }

  // Generate and output markdown
  const markdown = generateMarkdown(currentStats, historicalStats);
  console.log(markdown);
}

main();
