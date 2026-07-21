/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Historical eval run retrieval and processing. Handles:
 *   - retention-window age filtering (conservative run-created-at based);
 *   - paginated workflow-run listing via an injectable `gh` lister;
 *   - strict per-run download, cardinality validation, and parsing of
 *     historical run artifacts. A historical run that is incomplete or
 *     malformed is OMITTED in its entirety (never retaining partial stats) so
 *     historical pass rates are never misleading.
 *
 * Extracted from aggregate_evals.js so the retrieval/pagination concerns are
 * cohesive and independently testable. The strict current-report schema/parser
 * lives in aggregate-evals-schema.js; this module imports the strict parser
 * from it (one source of truth for parsing policy). The cardinality validators
 * come from aggregate-evals-cardinality.js so historical runs are validated
 * against the SAME artifact identity rules as the current run.
 */

import { readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  parseCurrentReport,
  aggregateStats,
} from './aggregate-evals-schema.js';
import {
  DEFAULT_EXPECTED_ATTEMPTS,
  validateTopLevelArtifactDirs,
  validateCardinality,
} from './aggregate-evals-cardinality.js';

const WORKFLOW_NAME = 'evals-nightly.yml';
// The GitHub repository (owner/name) for REST API calls. In GitHub Actions the
// runner sets GITHUB_REPOSITORY to "owner/name"; GH_REPO overrides it for local
// runs. Falls back to the canonical repo. The REST
// `repos/:owner/:name/actions/runs` path requires an explicit owner/name.
const GH_REPO =
  process.env.GH_REPO ||
  process.env.GITHUB_REPOSITORY ||
  'vybestack/llxprt-code';
// Match the artifact retention window (7 days, see _evals-run.yml). Historical
// runs older than this window have expired artifacts and would always produce
// empty downloads. The run lister paginates through completed runs and keeps
// only those whose `createdAt` is within the retention window (and not in the
// future), so only runs whose artifacts can still be downloaded are requested.
export const HISTORICAL_RETENTION_DAYS = 7;
// Page size for `gh run list`. The gh CLI caps a single page at 100 entries.
// Pagination continues until a page contains a run older than the retention
// window (results are newest-first, so no further in-window runs are possible)
// or until the safety bound below is reached.
const GH_RUN_LIST_PAGE_SIZE = 100;
// Safety bound on the number of pages fetched, so a pathological run list
// cannot loop indefinitely. 100 pages * 100 per page = 10,000 runs, far beyond
// any plausible 7-day window.
const GH_RUN_LIST_MAX_PAGES = 100;
const GH_LIST_TIMEOUT_MS = 60 * 1000;
const GH_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Thin wrapper over `spawnSync` that normalizes the result to a plain
 * `{status, stdout, stderr}` object with string outputs. This is the default
 * `runSync` used by {@link listRunsPageWithGh}; tests inject their own.
 *
 * @type {RunSync}
 */
function spawnSyncBound(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    timeout: GH_LIST_TIMEOUT_MS,
  });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/**
 * Whether a workflow run created at `createdAt` is still within the artifact
 * retention window relative to `now`. Pure and exported for testing.
 *
 * NOTE on retention accuracy: artifact downloadability is governed by the
 * artifact's own expiration (retention-days from artifact creation), not by
 * the workflow run's `createdAt`. The run's `createdAt` is used here as a
 * conservative approximation because `gh run list` does not expose artifact
 * expiration metadata. This filter is deliberately conservative
 * (run-created-at based) so it does not overclaim downloadable status;
 * expired-artifact downloads are handled by whole-run omission in
 * processHistoricalRun.
 *
 * A run with a future `createdAt` (relative to `now`) is rejected: a future
 * run timestamp is suspicious and its artifacts may not yet exist, so it must
 * not be treated as in-window.
 *
 * @param {string} createdAt - ISO 8601 timestamp from `gh run list --json createdAt`
 * @param {number} now - epoch milliseconds representing "now"
 * @param {number} retentionDays - retention window in days
 * @returns {boolean}
 */
export function isWithinRetentionWindow(
  createdAt,
  now,
  retentionDays = HISTORICAL_RETENTION_DAYS,
) {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) {
    // An unparseable timestamp cannot be trusted to be within the window;
    // exclude it so a malformed field cannot pull in expired/empty runs.
    return false;
  }
  // A future-dated run is suspicious (clock skew or malformed data) and its
  // artifacts may not yet be downloadable, so exclude it.
  if (createdMs > now) {
    return false;
  }
  return now - createdMs <= retentionDays * MS_PER_DAY;
}

/**
 * Select runs whose `createdAt` falls within the retention window. Pure and
 * exported for testing. Uses {@link isWithinRetentionWindow} so an
 * unparseable or future timestamp excludes a run. Operates on an
 * already-fetched list; {@link listWorkflowRunsInWindow} is the paginating
 * entry point that fetches pages and accumulates in-window runs.
 * @param {Array<{createdAt: string}>} runs
 * @param {number} now - epoch milliseconds representing "now"
 * @param {number} retentionDays
 * @returns {Array<typeof runs[number]>}
 */
export function selectRunsInWindow(runs, now, retentionDays) {
  if (!Array.isArray(runs)) {
    return [];
  }
  const days = retentionDays ?? HISTORICAL_RETENTION_DAYS;
  return runs.filter((run) =>
    isWithinRetentionWindow(run.createdAt, now, days),
  );
}

/**
 * Classify a single run's age relative to the retention window into one of
 * three states:
 *   - `'in-window'` : the run was created within the retention window (kept);
 *   - `'older'`     : the run was created before the window (excluded, and
 *                     signals the pagination cutoff because results are
 *                     newest-first, so no later run can be in-window);
 *   - `'excluded'`  : the run has an unparseable or future timestamp (excluded
 *                     but does NOT signal the cutoff, because such a timestamp
 *                     does not prove the run list has reached older runs).
 *
 * Tri-state classification prevents a single malformed/future run from
 * prematurely truncating historical retrieval.
 *
 * @param {string} createdAt - ISO 8601 timestamp
 * @param {number} now - epoch milliseconds representing "now"
 * @param {number} retentionDays - retention window in days
 * @returns {'in-window'|'older'|'excluded'}
 */
export function classifyRunAge(createdAt, now, retentionDays) {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) {
    return 'excluded';
  }
  if (createdMs > now) {
    return 'excluded';
  }
  if (now - createdMs > retentionDays * MS_PER_DAY) {
    return 'older';
  }
  return 'in-window';
}

/**
 * Classify the runs on a single page into in-window and whether a definitely
 * older run was seen. Results are newest-first, so the first older run signals
 * that no later run can be in-window. A run with an unparseable or future
 * timestamp is excluded from the in-window set but does NOT signal the cutoff
 * (see {@link classifyRunAge}).
 *
 * @param {Array<{createdAt: string}>} runs - runs on one page (newest-first)
 * @param {number} now - epoch milliseconds representing "now"
 * @param {number} retentionDays - retention window in days
 * @returns {{inWindow: Array<typeof runs[number]>, sawOutOfWindow: boolean}}
 */
export function classifyRunsPage(runs, now, retentionDays) {
  const inWindow = [];
  let sawOutOfWindow = false;
  for (const run of runs) {
    const age = classifyRunAge(run.createdAt, now, retentionDays);
    if (age === 'in-window') {
      inWindow.push(run);
    } else if (age === 'older') {
      sawOutOfWindow = true;
    }
    // 'excluded' (future/unparseable) is neither kept nor a cutoff signal.
  }
  return { inWindow, sawOutOfWindow };
}

/**
 * Page through completed workflow runs, keeping only those whose `createdAt`
 * falls within the retention window (and is not in the future). Pagination
 * stops as soon as a page contains a run older than the window (results are
 * newest-first, so no later page can contain an in-window run), or when an
 * empty/short RAW page is returned, or when the safety page bound is reached.
 *
 * The `listRunsPage` callback returns `{runs, rawCount, totalCount}`: `runs`
 * are the normalized valid records; `rawCount` is the number of entries in the
 * RAW `workflow_runs` array (before normalization); `totalCount` is the
 * envelope `total_count`. Termination uses rawCount (NOT the filtered
 * runs.length), so a page with invalid entries that drop the normalized length
 * below the page size does NOT prematurely stop pagination. This is the fix
 * for the pagination finding: a 100-entry raw page with one invalid record and
 * total_count=101 must still consume page 2.
 *
 * The `listRunsPage` callback is injectable so tests can prove multiple pages
 * and more than 100 in-window runs are consumed without invoking `gh`.
 *
 * @param {(page: number) => {runs: Array<{createdAt: string, databaseId?: number}>, rawCount: number, totalCount: number}} listRunsPage -
 *   callback returning the normalized runs plus raw count metadata for a
 *   1-based page (newest-first)
 * @param {number} now - epoch milliseconds representing "now"
 * @param {number} retentionDays - retention window in days
 * @returns {Array<{createdAt: string}>} all in-window runs across all pages
 */
export function listWorkflowRunsInWindow(listRunsPage, now, retentionDays) {
  const inWindow = [];
  const seenIds = new Set();
  let totalRawSeen = 0;
  for (let page = 1; page <= GH_RUN_LIST_MAX_PAGES; page++) {
    const raw = listRunsPage(page);
    // Support BOTH contracts: the canonical `{runs, rawCount, totalCount}`
    // object and a bare array of runs (rawCount falls back to runs.length).
    const pageResult = Array.isArray(raw) ? { runs: raw } : (raw ?? {});
    const runs = Array.isArray(pageResult.runs) ? pageResult.runs : [];
    // rawCount is the RAW page size (before normalization). When absent (e.g.
    // a bare-array lister), fall back to runs.length.
    const rawCount =
      typeof pageResult.rawCount === 'number'
        ? pageResult.rawCount
        : runs.length;
    const totalCount =
      typeof pageResult.totalCount === 'number' ? pageResult.totalCount : 0;
    totalRawSeen += rawCount;
    const isEmpty = runs.length === 0 && rawCount === 0;
    const classified = isEmpty
      ? { inWindow: [], sawOutOfWindow: false }
      : classifyRunsPage(runs, now, retentionDays);
    // Dedupe by databaseId so a run straddling a page boundary is not
    // processed twice.
    for (const run of classified.inWindow) {
      const id = run.databaseId;
      if (id !== undefined && !seenIds.has(id)) {
        seenIds.add(id);
        inWindow.push(run);
      } else if (id === undefined) {
        inWindow.push(run);
      }
    }
    // Terminate on the RAW count, NOT the filtered runs.length: a full raw
    // page (rawCount >= page size) means more pages may exist even when some
    // entries were filtered out as invalid. An empty/short raw page stops.
    const reachedLastPage = isEmpty || rawCount < GH_RUN_LIST_PAGE_SIZE;
    // Also stop when the RAW total_count has been fully consumed: once all
    // raw entries across pages equal totalCount, no further page can contain
    // data (GitHub's total_count is the raw count for the whole result set).
    const consumedTotal = totalCount > 0 && totalRawSeen >= totalCount;
    if (reachedLastPage || consumedTotal || classified.sawOutOfWindow) {
      break;
    }
  }
  return inWindow;
}

/**
 * Build the `gh api` arguments for fetching a single page of completed workflow
 * runs (newest-first) for {@link WORKFLOW_NAME}. Uses the GitHub REST API
 * WORKFLOW-SPECIFIC endpoint
 * `repos/:owner/:name/actions/workflows/:workflow_id/runs` with
 * `page`/`per_page`/`status` query params. Each page request returns a distinct
 * slice (unlike `gh run list --limit`, which always returns the same first
 * page). Pure and exported so tests can prove the command builder emits the
 * workflow-specific path and distinct page params without spawning `gh`.
 *
 * No `--jq` projection is used. The endpoint returns an envelope of the shape
 * `{ total_count, workflow_runs: [...] }`; a jq projection against the
 * top-level object (`.id`, `.conclusion`, ...) would yield `null` because those
 * fields only exist on each entry inside `workflow_runs`. Parsing the whole
 * envelope in JS (see {@link parseRunListEnvelope}) is robust and testable at
 * the production process-runner boundary.
 *
 * The workflow-specific endpoint is used (rather than the repository-wide
 * `actions/runs` endpoint) because the repository-wide endpoint does NOT
 * support filtering by workflow: it ignores an unsupported `workflow` query
 * field and returns runs for ALL workflows. The workflow file name is therefore
 * embedded in the path, not sent as a query field.
 *
 * @param {number} page - 1-based page number
 * @returns {string[]} argv for `spawnSync('gh', ...)`
 */
export function buildRunListArgs(page) {
  return [
    'api',
    `repos/${GH_REPO}/actions/workflows/${WORKFLOW_NAME}/runs`,
    '--method',
    'GET',
    '--field',
    'status=completed',
    '--field',
    `page=${page}`,
    '--field',
    `per_page=${GH_RUN_LIST_PAGE_SIZE}`,
  ];
}

/**
 * Synchronously run a command, returning its stdout/stderr/status. The default
 * implementation uses `spawnSync`; tests inject a fake `runSync` so the
 * production adapter can be exercised against realistic gh output without
 * spawning the real gh CLI.
 *
 * @typedef {(cmd: string, args: string[]) => {status: number, stdout: string, stderr: string}} RunSync
 */

/**
 * Options for {@link listRunsPageWithGh}.
 *
 * @typedef {Object} ListRunsPageOptions
 * @property {RunSync} [runSync] - injectable process runner (defaults to
 *   `spawnSync`)
 */

/**
 * Validate and normalize a single `workflow_runs` entry. Returns null when the
 * entry is structurally invalid so the caller skips it. Only validated IDs
 * reach downloads. The nonfuture classification of `created_at` happens
 * downstream in the retention-window filter.
 *
 * @param {unknown} entry - a single workflow_runs entry (REST fields)
 * @returns {{databaseId: number, createdAt: string, conclusion: string|null, headSha: string}|null}
 */
export function normalizeRunEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const src = /** @type {Record<string, unknown>} */ (entry);
  const id = src['id'];
  if (!Number.isInteger(id) || id <= 0 || !Number.isSafeInteger(id)) {
    return null;
  }
  const createdAt = src['created_at'];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    return null;
  }
  const conclusion = src['conclusion'];
  if (conclusion !== null && typeof conclusion !== 'string') {
    return null;
  }
  const headSha = src['head_sha'];
  if (typeof headSha !== 'string' || headSha.length === 0) {
    return null;
  }
  return {
    databaseId: id,
    createdAt,
    conclusion,
    headSha,
  };
}

/**
 * Parse the stdout of `gh api .../runs` (no `--jq`). The endpoint returns a
 * single JSON envelope of the shape `{ total_count, workflow_runs: [...] }`,
 * where each entry has the REST fields `id`, `conclusion`, `head_sha`, and
 * `created_at`. This parser JSON-parses the whole envelope, then validates and
 * normalizes each `workflow_runs` entry via {@link normalizeRunEntry}. Invalid
 * entries are skipped with a warning so only validated IDs reach downloads.
 *
 * Returns `{runs, rawCount, totalCount}` so the paginator can terminate on the
 * RAW API count rather than the filtered/normalized length. rawCount is the
 * number of entries in the raw `workflow_runs` array (before normalization);
 * totalCount is the envelope `total_count`. A full raw page has rawCount equal
 * to the page size even when some entries were filtered out as invalid, so the
 * paginator correctly fetches the next page.
 *
 * Robustness:
 *   - Unparseable JSON logs a warning and yields an empty result (never throws).
 *   - A non-object envelope (e.g. a JSON array or primitive) is rejected.
 *   - A missing or non-array `workflow_runs` field yields an empty result.
 *   - Entries that fail validation are skipped with a warning.
 *
 * @param {string} stdout
 * @returns {{runs: Array<{databaseId: number, createdAt: string, conclusion: string|null, headSha: string}>, rawCount: number, totalCount: number}}
 */
function parseRunListEnvelope(stdout) {
  const empty = { runs: [], rawCount: 0, totalCount: 0 };
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return empty;
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    console.error(
      `Warning: Could not parse workflow run envelope: ${err instanceof Error ? err.message : String(err)}`,
    );
    return empty;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('Warning: workflow run envelope is not a JSON object');
    return empty;
  }
  const src = /** @type {Record<string, unknown>} */ (parsed);
  const runs = src['workflow_runs'];
  if (!Array.isArray(runs)) {
    console.error('Warning: workflow run envelope has no workflow_runs array');
    return empty;
  }
  /** @type {Array<{databaseId: number, createdAt: string, conclusion: string|null, headSha: string}>} */
  const records = [];
  for (const entry of runs) {
    const normalized = normalizeRunEntry(entry);
    if (normalized === null) {
      console.error('Warning: skipped an invalid workflow_runs entry');
      continue;
    }
    records.push(normalized);
  }
  const rawTotalCount = src['total_count'];
  const totalCount =
    typeof rawTotalCount === 'number' &&
    Number.isFinite(rawTotalCount) &&
    rawTotalCount >= 0
      ? rawTotalCount
      : 0;
  return { runs: records, rawCount: runs.length, totalCount };
}

/**
 * Default run-listing page fetcher using the `gh` CLI. Fetches one page of
 * completed workflow runs (newest-first) for {@link WORKFLOW_NAME} via the
 * GitHub REST API (`gh api`) with real offset pagination. The endpoint returns
 * a `{ total_count, workflow_runs: [...] }` JSON envelope, which
 * {@link parseRunListEnvelope} parses into normalized run records. Returns
 * `{runs, rawCount, totalCount}` (empty on failure) so pagination terminates
 * gracefully.
 *
 * rawCount is the number of entries in the raw `workflow_runs` array (before
 * normalization); totalCount is the envelope `total_count`. The paginator uses
 * rawCount (NOT the filtered runs.length) to decide whether a full page was
 * returned, so a page with invalid entries that drop the normalized length
 * below the page size does NOT prematurely terminate pagination.
 *
 * An injectable `runSync` lets tests prove multiple records are returned from
 * a realistic envelope WITHOUT spawning the real `gh` CLI.
 *
 * @param {number} page - 1-based page number
 * @param {ListRunsPageOptions} [options]
 * @returns {{runs: Array<{databaseId: number, createdAt: string, conclusion: string|null, headSha: string}>, rawCount: number, totalCount: number}}
 */
export function listRunsPageWithGh(page, options = {}) {
  const runner = options.runSync ?? spawnSyncBound;
  const result = runner('gh', buildRunListArgs(page));

  if (result.status !== 0) {
    console.error(`Warning: Could not list workflow runs: ${result.stderr}`);
    return { runs: [], rawCount: 0, totalCount: 0 };
  }

  return parseRunListEnvelope(result.stdout);
}

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
    console.error(
      `Warning: Could not read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    console.error(
      `Warning: Could not read ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
/**
 * Strictly parse each historical report using the SAME strict parser as a
 * current report ({@link parseCurrentReport}). A historical run is only usable
 * when EVERY report independently satisfies the strict schema: structural
 * validity, at least one usable passed/failed assertion, no contradictory
 * counters, and no unrepresented suite/report-level failures. When any report
 * fails, NO stats from that report (nor from any other report in the run) are
 * retained — the caller omits the entire run so historical pass rates cannot
 * be corrupted by one bad report. Returns the accumulated stats (empty when
 * any report failed) and the accumulated error list.
 *
 * Extracted from {@link processHistoricalRun} so the loop body stays under the
 * lint nesting bound.
 *
 * @param {string[]} reports - discovered report.json paths
 * @returns {{runStats: Map<string, {pass: number, fail: number, total: number}>, reportErrors: string[]}}
 */
function parseHistoricalReportsStrict(reports) {
  const runStats = new Map();
  const reportErrors = [];
  for (const reportPath of reports) {
    const parsed = parseCurrentReport(reportPath);
    if (!parsed.valid || parsed.stats.size === 0) {
      reportErrors.push(...parsed.errors);
      if (parsed.errors.length === 0) {
        reportErrors.push(
          `${reportPath}: report is malformed or has no usable assertions`,
        );
      }
      continue;
    }
    aggregateStats(runStats, parsed.stats);
  }
  return { runStats, reportErrors };
}

/**
 * Default artifact-download adapter used by {@link processHistoricalRun} in
 * production. Mirrors `gh run download <runId> -D <dir>`: writes one top-level
 * directory per artifact into `dir` and returns a normalized
 * `{status, stdout, stderr}`. Injectable so tests can simulate `gh run download`
 * writing a real on-disk artifact tree without spawning `gh`.
 *
 * @param {string|number} runId
 * @param {string} dir - destination directory (created by the caller)
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function downloadRunWithGh(runId, dir) {
  const result = spawnSync(
    'gh',
    ['run', 'download', String(runId), '-D', dir],
    {
      encoding: 'utf-8',
      timeout: GH_DOWNLOAD_TIMEOUT_MS,
    },
  );
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/**
 * Result of {@link processHistoricalRun}.
 *
 * @typedef {Object} HistoricalRunResult
 * @property {string} runId - the processed run's databaseId (as a string)
 * @property {Map<string, {pass: number, fail: number, total: number}>} stats -
 *   per-test pass/fail/total. EMPTY when the run is omitted (no partial stats
 *   are ever retained from a malformed/incomplete run).
 * @property {boolean} omitted - true when the run was excluded in its entirety
 * @property {string} [reason] - human-readable reason when omitted
 */

/**
 * Strictly download, validate, and parse artifacts for a single historical run.
 *
 * A historical run is INCLUDED only when ALL of the following hold:
 *   - the download succeeds (status 0);
 *   - the top-level downloaded directories are EXACTLY the expected set of
 *     `eval-logs-N` directories (validated by the REAL
 *     {@link validateTopLevelArtifactDirs} from the cardinality module — the
 *     same artifact-identity rules used for the current run);
 *   - the discovered report.json files correspond EXACTLY to the expected
 *     attempts: one report per attempt, no missing/duplicate/unexpected
 *     (validated by the REAL {@link validateCardinality});
 *   - EVERY report is structurally valid AND contributes at least one usable
 *     passed/failed assertion.
 *
 * If ANY of these fails, the ENTIRE run is OMITTED with a concise reason. No
 * partial stats are retained from a malformed/incomplete run, so a single bad
 * report cannot produce misleading historical pass rates.
 *
 * Accepts an injectable `downloadRun` callback (default {@link downloadRunWithGh})
 * so tests can simulate `gh run download` writing a real on-disk artifact tree
 * while still exercising the REAL filesystem cardinality validators. The
 * callback receives the temp directory the function created; it mirrors `gh run
 * download` by writing one top-level dir per artifact into it.
 *
 * @param {{databaseId: number|string}} run - the workflow run to process
 * @param {(runId: string|number, dir: string) => {status: number, stdout: string, stderr: string}} [downloadRun] -
 *   injectable artifact downloader (defaults to {@link downloadRunWithGh})
 * @param {{expectedAttempts?: number[]}} [options] - optional expected attempts
 *   (defaults to {@link DEFAULT_EXPECTED_ATTEMPTS})
 * @returns {HistoricalRunResult}
 */
export function processHistoricalRun(run, downloadRun, options = {}) {
  const runId = String(run.databaseId);
  const expectedAttempts =
    options.expectedAttempts ?? DEFAULT_EXPECTED_ATTEMPTS;
  const downloader = downloadRun ?? downloadRunWithGh;
  const empty = { runId, stats: new Map(), omitted: true };

  const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-evals-'));
  try {
    return processHistoricalRunBody(
      runId,
      tempDir,
      downloader,
      expectedAttempts,
      empty,
    );
  } catch (err) {
    // Per-run exception isolation: an unexpected error during download,
    // cardinality validation, or parsing must NOT propagate. The run is
    // omitted in its entirety so historical retrieval remains best-effort
    // and one bad run cannot abort the remaining runs in the fetcher loop.
    console.error(
      `Warning: Omitting historical run ${runId}: unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...empty, reason: 'unexpected error during processing' };
  } finally {
    try {
      rmSync(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch (err) {
      console.error(
        `Warning: Could not clean up temp directory ${tempDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Body of {@link processHistoricalRun}, extracted so the outer function can
 * wrap the entire body in a single try/catch for per-run exception isolation.
 * See {@link processHistoricalRun} for the full contract.
 *
 * @param {string} runId
 * @param {string} tempDir
 * @param {(runId: string|number, dir: string) => {status: number, stdout: string, stderr: string}} downloader
 * @param {number[]} expectedAttempts
 * @param {{runId: string, stats: Map<string, {pass: number, fail: number, total: number}>, omitted: boolean}} empty
 * @returns {HistoricalRunResult}
 */
function processHistoricalRunBody(
  runId,
  tempDir,
  downloader,
  expectedAttempts,
  empty,
) {
  const downloadResult = downloader(runId, tempDir);
  if (downloadResult.status !== 0) {
    console.error(
      `Warning: Could not download artifacts for run ${runId}: ${downloadResult.stderr}`,
    );
    return {
      ...empty,
      reason: `download failed (status ${downloadResult.status})`,
    };
  }

  // Validate the DIRECT top-level directories: exactly the expected
  // eval-logs-N set, no extras (dot-dirs, stray artifacts, etc.).
  const dirErrors = validateTopLevelArtifactDirs(tempDir, expectedAttempts);
  if (dirErrors.length > 0) {
    const reason = `cardinality: ${dirErrors.join('; ')}`;
    console.error(`Warning: Omitting historical run ${runId}: ${reason}`);
    return { ...empty, reason };
  }

  // Find all report.json files, then validate they map EXACTLY to the
  // expected attempts (no missing/duplicate/unexpected).
  const reports = findReports(tempDir);
  if (reports.length === 0) {
    const reason = 'no reports found in downloaded artifacts';
    console.error(`Warning: Omitting historical run ${runId}: ${reason}`);
    return { ...empty, reason };
  }
  const cardinalityErrors = validateCardinality(reports, expectedAttempts);
  if (cardinalityErrors.length > 0) {
    const reason = `cardinality: ${cardinalityErrors.join('; ')}`;
    console.error(`Warning: Omitting historical run ${runId}: ${reason}`);
    return { ...empty, reason };
  }

  // Parse each report with the SAME strict parser used for current reports
  // (parseCurrentReport). A historical run is only usable when EVERY report
  // independently satisfies all of:
  //   - structural validity (testResults array, recognized assertion
  //     statuses, no mixed valid+malformed assertions);
  //   - at least one usable passed/failed assertion;
  //   - no contradictory counters (numPassedTests etc. must equal the
  //     represented assertions);
  //   - no unrepresented suite/report-level failures.
  // A single malformed, contradictory, or failure-unrepresenting report omits
  // the ENTIRE run (never partial stats), so historical pass rates cannot be
  // corrupted by one bad report. This is the one source of truth for parsing
  // policy shared with current reports.
  const { runStats, reportErrors } = parseHistoricalReportsStrict(reports);
  if (reportErrors.length > 0) {
    const reason = `malformed report: ${reportErrors.join('; ')}`;
    console.error(`Warning: Omitting historical run ${runId}: ${reason}`);
    return { ...empty, reason };
  }

  if (runStats.size === 0) {
    return { ...empty, reason: 'no usable assertions in any report' };
  }
  return { runId, stats: runStats, omitted: false };
}

/**
 * Fetch historical eval data from previous nightly workflow runs. Downloads,
 * validates, and parses each in-window run via {@link processHistoricalRun}; a
 * run that is incomplete or malformed is OMITTED in its entirety with a warning.
 *
 * @param {(page: number) => (Array<object>|{runs: Array<object>, rawCount: number, totalCount: number})} [listRunsPage] -
 *   injectable run lister (defaults to the `gh` CLI); used by tests to prove
 *   pagination. The bare-array form is retained for test/custom-lister compatibility.
 * @param {(run: {databaseId: number|string}) => HistoricalRunResult} [processRun] -
 *   injectable per-run processor (defaults to {@link processHistoricalRun}).
 *   Tests inject a processor that throws for one run to prove loop-level
 *   exception isolation: one bad run cannot abort the remaining runs.
 * @returns {Map<string, Map<string, {pass: number, fail: number, total: number}>>}
 *   Outer map: run ID -> inner map
 *   Inner map: test name -> stats
 */
export function fetchHistoricalData(
  listRunsPage = listRunsPageWithGh,
  processRun = processHistoricalRun,
) {
  const historical = new Map();

  if (process.env.AGGREGATE_SKIP_HISTORICAL === '1') {
    return historical;
  }

  try {
    const now = Date.now();
    const inWindow = listWorkflowRunsInWindow(
      listRunsPage,
      now,
      HISTORICAL_RETENTION_DAYS,
    );

    if (inWindow.length === 0) {
      console.error(
        `Warning: No historical runs within the ${HISTORICAL_RETENTION_DAYS}-day retention window for ${WORKFLOW_NAME}`,
      );
      return historical;
    }

    for (const run of inWindow) {
      // Per-run isolation: an unexpected exception from processRun (despite
      // processHistoricalRun's own try/catch) must not abort processing of
      // remaining runs. History is best-effort: one bad run cannot erase all
      // trends. The injected processor defaults to processHistoricalRun in
      // production so the API stays simple for real callers.
      let result;
      try {
        result = processRun(run);
      } catch (err) {
        console.error(
          `Warning: Unexpected error processing historical run ${String(run.databaseId)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (!result.omitted && result.stats.size > 0) {
        historical.set(result.runId, result.stats);
      }
    }
  } catch (err) {
    console.error(
      `Warning: Could not fetch historical data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return historical;
}
