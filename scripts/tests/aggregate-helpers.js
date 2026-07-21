/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for aggregate_evals behavioral tests. There is ONE helper
 * module so every cohesive test file avoids duplicating temp-dir setup and
 * script invocation. These helpers exercise the script's observable process
 * behavior by spawning it against fixture directories on disk; they do NOT
 * mock the script under test.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/aggregate_evals.js');
const HISTORICAL_SCRIPT = path.join(
  ROOT,
  'scripts/aggregate-evals-historical.js',
);

/**
 * Build a minimal valid Vitest-style report fixture. Default is one passing
 * assertion so a caller can build "happy path" fixtures without extra args.
 *
 * The `fullName` uses the Vitest JSON reporter's SPACE-joined format
 * (`[...ancestorTitles, name].join(" ")`), which is the actual shape the
 * aggregator consumes. The CLI list output uses " > " as a separator, but the
 * JSON report does not.
 *
 * @param {object} [opts]
 * @param {number} [opts.pass=1]
 * @param {number} [opts.fail=0]
 * @param {string} [opts.testName='should save memory']
 * @returns {object}
 */
export function fixtureReport({
  pass = 1,
  fail = 0,
  testName = 'should save memory',
}) {
  // Real Vitest JSON reporter: fullName = [...ancestorTitles, name].join(" ").
  const fullName = `save_memory ${testName}`;
  return {
    testResults: [
      {
        assertionResults: [
          ...Array.from({ length: pass }, () => ({
            title: testName,
            fullName,
            status: 'passed',
          })),
          ...Array.from({ length: fail }, () => ({
            title: testName,
            fullName,
            status: 'failed',
          })),
        ],
      },
    ],
  };
}

/**
 * Run a build callback inside a fresh temp artifacts directory and clean it up
 * afterwards. This is the ONE lifecycle helper every describe block reuses so
 * beforeEach/afterEach temp-dir boilerplate is never duplicated.
 *
 * The temp directory is cleaned up BEFORE this function returns, so the path
 * passed to `build` is no longer valid after the callback returns. This helper
 * intentionally returns void: callers must do all assertions INSIDE the
 * callback while the directory still exists. This avoids leaving a dangling
 * path reference that callers might erroneously reuse after cleanup.
 *
 * @param {(dir: string) => void} build
 * @returns {void}
 */
export function useTempArtifactsDir(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-aggregate-'));
  try {
    build(dir);
  } finally {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      // Cleanup is best-effort; suppress so it never masks a test failure.
    }
  }
}

/**
 * Safely narrow an `unknown` catch-clause value to a string, returning '' when
 * the value is not a string. Used to extract stdout/stderr from a spawnSync
 * result without unsafe property access on `unknown`.
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Spawn scripts/aggregate_evals.js as a child process against `artifactsDir`
 * and capture its observable behavior (stdout, stderr, exit code). Uses
 * spawnSync with separate stdout/stderr pipes so BOTH streams are captured
 * even on the success path (execFileSync returns only stdout on success and
 * cannot surface separate streams). Never throws on nonzero exit so tests can
 * assert on failure behavior directly.
 *
 * @param {string} artifactsDir
 * @param {Record<string, string>} [env={}]
 * @param {string[]} [extraArgs=[]]
 * @returns {{stdout: string, stderr: string, exitCode: number}}
 */
export function runScript(artifactsDir, env = {}, extraArgs = []) {
  const result = spawnSync('node', [SCRIPT, artifactsDir, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    stdout: asString(result.stdout),
    stderr: asString(result.stderr),
    exitCode,
  };
}

/**
 * Dynamically import scripts/aggregate_evals.js as an ESM module so unit tests
 * can exercise its exported helpers (e.g. isWithinRetentionWindow,
 * selectRunsInWindow) directly.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadAggregateModule() {
  const url = pathToFileURL(SCRIPT).href;
  return import(url);
}

/**
 * Write a single `eval-logs-N` artifact directory with a valid report.json.
 * Shared across cardinality/missing-reports/malformed describe blocks so the
 * fixture setup is never duplicated.
 *
 * @param {string} dir - artifacts root directory
 * @param {number} attempt - matrix attempt id (creates eval-logs-<attempt>)
 * @param {object} [report] - report body (defaults to one passing assertion)
 */
export function writeAttempt(
  dir,
  attempt,
  report = fixtureReport({ pass: 1 }),
) {
  const reportDir = path.join(dir, `eval-logs-${attempt}`, 'logs');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report));
}

/**
 * Write a raw string into a single `eval-logs-1` artifact's report.json, for
 * tests that need a non-JSON-stringifiable body (e.g. truncated/malformed
 * JSON). Shared so the fixture setup is never duplicated.
 *
 * @param {string} dir - artifacts root directory
 * @param {string} raw - raw report.json file contents
 */
export function writeReportRaw(dir, raw) {
  const reportDir = path.join(dir, 'eval-logs-1', 'logs');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'report.json'), raw);
}

/**
 * Write a raw report object into a single `eval-logs-1` artifact directory, for
 * schema-validation tests that craft specific report shapes. Shared so the
 * fixture setup is never duplicated across schema describe blocks.
 *
 * @param {string} dir - artifacts root directory
 * @param {object} report - report body
 */
export function writeReport(dir, report) {
  writeReportRaw(dir, JSON.stringify(report));
}

/**
 * Run the aggregator against `dir` with historical fetch skipped and the
 * expected attempts narrowed to `[1]`, so a single-artifact fixture can be
 * exercised through the full process path. Shared across schema describe
 * blocks.
 *
 * @param {string} dir
 * @returns {{stdout: string, stderr: string, exitCode: number}}
 */
export function runWithOneExpected(dir) {
  return runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
    '--expected-attempts',
    '[1]',
  ]);
}

/**
 * Build a GitHub workflow-runs JSON envelope from an array of run entries.
 * The REST endpoint returns `{ total_count, workflow_runs: [...] }`. Shared so
 * test files don't duplicate the envelope builder.
 *
 * @param {object[]} runs
 * @returns {string} JSON envelope string
 */
export function envelope(runs) {
  return JSON.stringify({
    total_count: runs.length,
    workflow_runs: runs,
  });
}

export { ROOT, SCRIPT };

/**
 * Dynamically import scripts/aggregate-evals-historical.js as an ESM module so
 * unit tests can exercise its exported helpers (e.g. listWorkflowRunsInWindow,
 * listRunsPageWithGh) directly. Shared so test files don't duplicate the
 * loader.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadHistoricalModule() {
  const url = pathToFileURL(HISTORICAL_SCRIPT).href;
  return import(url);
}

/**
 * Build a single realistic REST workflow_runs entry, created `daysAgo` days
 * before the fixed test epoch `2026-07-20T02:00:00Z`. Shared so test files
 * don't duplicate the entry builder.
 *
 * @param {number} id - run id
 * @param {number} daysAgo - days before the test epoch
 * @returns {{id: number, conclusion: string, head_sha: string, created_at: string}}
 */
export function runEntry(id, daysAgo) {
  return {
    id,
    conclusion: 'success',
    head_sha: `sha-${id}`,
    created_at: new Date(
      Date.parse('2026-07-20T02:00:00Z') - daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

/**
 * Build a JSON envelope with an explicit GRAND total_count (the real GitHub
 * REST envelope carries the total across all pages, not the per-page length).
 * Shared so test files don't duplicate the envelope builder.
 *
 * @param {object[]} runs - workflow_runs entries
 * @param {number} totalCount - GRAND total_count across all pages
 * @returns {string} JSON envelope string
 */
export function pageEnvelope(runs, totalCount) {
  return JSON.stringify({ total_count: totalCount, workflow_runs: runs });
}

/**
 * Normalize a raw REST entry to the internal run shape consumed by the
 * retention/pagination logic. Shared so test fixtures mirror the production
 * normalization without duplicating the field mapping.
 *
 * @param {{id: number, conclusion: (string|null), head_sha: string, created_at: string}} raw
 * @returns {{databaseId: number, createdAt: string, conclusion: (string|null), headSha: string}}
 */
export function normalizedRun(raw) {
  return {
    databaseId: raw.id,
    createdAt: raw.created_at,
    conclusion: raw.conclusion,
    headSha: raw.head_sha,
  };
}

/**
 * Build a fake `runSync` for the production adapter `listRunsPageWithGh` that
 * serves one JSON envelope page per call from `pages`, in order. Returns a
 * `{runSync, calls}` pair where `calls` is the number of pages consumed.
 * Shared so multi-page adapter tests don't duplicate the fake-runner setup.
 *
 * @param {string[]} pages - JSON envelope strings served in order
 * @returns {{runSync: () => {status: number, stdout: string, stderr: string}, calls: () => number}}
 */
export function fakeEnvelopeRunner(pages) {
  let pageCalls = 0;
  const runSync = () => ({
    status: 0,
    stdout: pages[pageCalls++] ?? '',
    stderr: '',
  });
  return { runSync, calls: () => pageCalls };
}
