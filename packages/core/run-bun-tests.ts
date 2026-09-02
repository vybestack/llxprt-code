/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the core workspace that discovers all test files
 * and runs them in isolated bun test processes with bounded parallelism.
 *
 * This avoids a Bun 1.3.x runtime bug on Linux where `bun test --parallel`
 * hangs during process teardown after all tests have passed. Running each
 * file as a separate `bun test <file>` invocation avoids the multi-file
 * process management that triggers the hang.
 *
 * Concurrency and both timeout budgets come from
 * scripts/lib/bun-test-policy.ts, shared with the other runners (issue #3139).
 * This workspace keeps its own lower concurrency cap because its files are
 * unusually heavy; the budgets are the shared ones. If a file exceeds the
 * per-file budget the process is killed, so a single hanging file cannot block
 * the suite.
 *
 * Exit code is 0 if all files pass, 1 if any file fails.
 */

import { Buffer } from 'node:buffer';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  DEFAULT_PER_FILE_TIMEOUT_MS,
  DEFAULT_PER_TEST_TIMEOUT_MS,
  resolveTestConcurrency,
} from '../../scripts/lib/bun-test-policy.js';

process.env.LLXPRT_RUNNING_TESTS = 'true';

/**
 * Every path this runner touches — discovery, the child's working directory,
 * the preload and the JUnit report — is anchored here rather than at
 * `process.cwd()`, so the runner behaves identically no matter where it is
 * invoked from.
 */
const WORKSPACE_ROOT = import.meta.dir;
const PRELOAD = join(WORKSPACE_ROOT, 'bun-preload.ts');
const JUNIT_PATH = join(WORKSPACE_ROOT, 'junit.xml');
// PowerShell/taskkill-heavy suites leave Windows log handles pending when Bun
// children overlap. POSIX retains bounded parallelism without saturating shared
// CI runners, where event-loop starvation can trip otherwise healthy test files.
const MAX_CONCURRENCY = process.platform === 'win32' ? 1 : 2;
const CONCURRENCY = resolveTestConcurrency({
  envVar: 'LLXPRT_CORE_TEST_CONCURRENCY',
  maxConcurrency: MAX_CONCURRENCY,
});
const PER_TEST_TIMEOUT_MS = DEFAULT_PER_TEST_TIMEOUT_MS;
const PER_FILE_TIMEOUT_MS = DEFAULT_PER_FILE_TIMEOUT_MS;

const TEST_ROOTS = ['src', 'test'] as const;

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (
      entry === 'dist' ||
      entry === 'node_modules' ||
      entry === 'coverage' ||
      entry.startsWith('.')
    ) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (
      (entry.endsWith('.test.ts') ||
        entry.endsWith('.test.tsx') ||
        entry.endsWith('.spec.ts') ||
        entry.endsWith('.spec.tsx')) &&
      !entry.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * Returns the absolute paths of every test file this runner would execute for
 * the given absolute workspace `root`. The script entry point calls this same
 * function (see `main`), so the two can never diverge.
 *
 * Roots scanned: `src` and `test`. Files match `*.test.ts` / `*.test.tsx` /
 * `*.spec.ts` / `*.spec.tsx` (`.d.ts` excluded); `dist`, `node_modules`,
 * `coverage` and dot-prefixed entries are skipped.
 */
export function discoverTestFiles(root: string): string[] {
  const results: string[] = [];
  for (const testRoot of TEST_ROOTS) {
    results.push(...findTestFiles(join(root, testRoot)));
  }
  return results;
}

export interface TestResult {
  file: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  // Null when the timeout originated inside a single test: that budget
  // belongs to the individual test (it may override Bun's per-test timeout),
  // so no file-level number applies.
  timeoutMs: number | null;
  reapFailed: boolean;
  reapError: string | null;
}

export interface RunTestFileOptions {
  readonly timeoutMs?: number;
  readonly reapTimeoutMs?: number;
  readonly taskkillTimeoutMs?: number;
  readonly cleanupAttempts?: number;
  readonly cleanupRetryDelayMs?: number;
  readonly removeAttemptDir?: (attemptDir: string) => void;
  readonly reapTimedOutChild?: (
    child: ChildProcess,
    childClosed: Promise<void>,
  ) => Promise<void>;
  readonly scanJUnitReport?: (reportPath: string) => boolean;
}

const REAP_TIMEOUT_MS = 10_000;
const TASKKILL_TIMEOUT_MS = 10_000;

// Windows can transiently refuse removal of a directory whose report file
// was just closed (AV scanners, search indexers, reporter teardown still
// holding handles), reporting EBUSY/EPERM/EACCES/ENOTEMPTY. Removal gets a
// bounded number of retries for exactly those errors; anything else
// propagates immediately.
const RETRYABLE_CLEANUP_ERROR_CODES: ReadonlySet<string> = new Set([
  'EBUSY',
  'EPERM',
  'EACCES',
  'ENOTEMPTY',
]);
const DEFAULT_CLEANUP_ATTEMPTS = 3;
const DEFAULT_CLEANUP_RETRY_DELAY_MS = 100;

function isRetryableCleanupError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    RETRYABLE_CLEANUP_ERROR_CODES.has(error.code)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cleanupAttemptDir(
  attemptDir: string,
  options: RunTestFileOptions,
): Promise<void> {
  const remove =
    options.removeAttemptDir ??
    ((dir: string) => {
      rmSync(dir, { recursive: true, force: true });
    });
  const attempts = options.cleanupAttempts ?? DEFAULT_CLEANUP_ATTEMPTS;
  const retryDelayMs =
    options.cleanupRetryDelayMs ?? DEFAULT_CLEANUP_RETRY_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      remove(attemptDir);
      return;
    } catch (error) {
      if (!isRetryableCleanupError(error)) throw error;
      lastError = error;
      if (attempt < attempts) {
        await delay(retryDelayMs);
      }
    }
  }
  const lastDetail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`removal failed after ${attempts} attempts: ${lastDetail}`, {
    cause: lastError,
  });
}

function cleanupFailureMessage(
  file: string,
  attemptDir: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `attempt cleanup failed for ${file}: could not remove ${attemptDir}: ${detail}`;
}

const BUN_JUNIT_TIMEOUT_MARKER = '<failure type="TimeoutError"';
export const JUNIT_SCAN_CHUNK_BYTES = 64 * 1024;
const JUNIT_SCAN_OVERLAP_CHARS = BUN_JUNIT_TIMEOUT_MARKER.length - 1;

function isNoSuchFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function junitReportContainsPerTestTimeout(reportPath: string): boolean {
  const chunk = Buffer.alloc(JUNIT_SCAN_CHUNK_BYTES);
  let overlap = '';
  let descriptor: number | undefined;
  try {
    descriptor = openSync(reportPath, 'r');
    for (;;) {
      const bytesRead = readSync(
        descriptor,
        chunk,
        0,
        JUNIT_SCAN_CHUNK_BYTES,
        null,
      );
      if (bytesRead === 0) return false;
      // A chunk edge can split a multi-byte UTF-8 sequence; continuation
      // bytes never decode to ASCII, so the split can neither fabricate nor
      // destroy the ASCII marker.
      const text = overlap + chunk.toString('utf8', 0, bytesRead);
      if (text.includes(BUN_JUNIT_TIMEOUT_MARKER)) return true;
      overlap =
        text.length > JUNIT_SCAN_OVERLAP_CHARS
          ? text.slice(-JUNIT_SCAN_OVERLAP_CHARS)
          : text;
    }
  } catch (error) {
    // An absent report is the killed-before-writing case, not a read failure.
    if (isNoSuchFileError(error)) return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function observeChildClose(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });
}

export async function killChildTreeAndWait(
  child: ChildProcess,
  childClosed: Promise<void>,
  options: Pick<RunTestFileOptions, 'reapTimeoutMs' | 'taskkillTimeoutMs'> = {},
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('Cannot reap test process without a PID');
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    let taskkillError: Error | null = null;
    killer.once('error', (error: Error) => {
      taskkillError = error;
    });
    const killerClosed = new Promise<number | null>((resolve) => {
      killer.once('close', resolve);
    });
    let taskkillCode: number | null;
    try {
      taskkillCode = await withTimeout(
        killerClosed,
        options.taskkillTimeoutMs ?? TASKKILL_TIMEOUT_MS,
        `taskkill for test process ${pid}`,
      );
    } catch (error) {
      let forcedKillError: Error | null = null;
      const recordForcedKillError = (killError: Error): void => {
        forcedKillError = killError;
      };
      killer.once('error', recordForcedKillError);
      try {
        if (killer.exitCode === null && killer.signalCode === null) {
          killer.kill('SIGKILL');
        }
        await withTimeout(
          killerClosed,
          options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
          `Timed-out taskkill (pid ${killer.pid ?? 'unknown'}) close lifecycle`,
        );
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          `taskkill for test process ${pid} failed and did not close`,
        );
      } finally {
        killer.off('error', recordForcedKillError);
      }
      if (forcedKillError !== null) {
        throw new AggregateError(
          [error, forcedKillError],
          `taskkill for test process ${pid} timed out and could not be terminated`,
        );
      }
      throw error;
    }
    if (taskkillError !== null) {
      throw taskkillError;
    }
    // A nonzero taskkill code is not by itself a reap failure: the usual cause
    // is that the tree already exited between the timeout firing and taskkill
    // running, which is the POSIX ESRCH case handled below. What matters is
    // the invariant — that nothing is left alive holding the child's pipes —
    // so verify that directly by waiting for close, and report the code only
    // if the tree genuinely outlives the reap.
    if (taskkillCode !== 0) {
      try {
        await withTimeout(
          childClosed,
          options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
          `Timed-out child (pid ${pid}) close lifecycle`,
        );
      } catch (closeError) {
        throw new AggregateError(
          [
            new Error(
              `taskkill /T /F /PID ${pid} exited with code ${taskkillCode}`,
            ),
            closeError,
          ],
          `taskkill for test process ${pid} reported failure and its tree did not close`,
        );
      }
      return;
    }
  } else {
    // POSIX: kill the entire per-test process group by negative PID. The
    // child was spawned with detached: true (see runTestFile) so it leads
    // its own group; this sends SIGKILL to every descendant that inherited
    // it (e.g. grandchildren spawned via Bun.spawn), which child.kill()
    // alone would orphan.
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ESRCH') {
        throw error;
      }
    }
  }

  await withTimeout(
    childClosed,
    options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
    `Timed-out child (pid ${pid}) close lifecycle`,
  );
}

export async function runTestFileWithTimeoutRetry<
  T extends {
    readonly passed: boolean;
    readonly timedOut: boolean;
    readonly timeoutMs: number | null;
    readonly reapFailed: boolean;
    readonly reapError?: string | null;
  },
>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void = (message) => console.log(message),
): Promise<T> {
  const firstAttempt = await runAttempt();
  if (!firstAttempt.timedOut) {
    return firstAttempt;
  }

  // Retry on every timeout, including one whose reap failed: the second
  // attempt's outcome decides whether the run can continue. The freeze class
  // this guards against (issue #3439) kills the child on one attempt and
  // behaves normally on the next; a first-attempt reap failure is frequently
  // just taskkill losing a race with an already-dying tree.
  const timeoutOrigin =
    firstAttempt.timeoutMs === null ? 'per-test' : 'per-file';
  logRetry(`RETRY (2/2): ${file} after ${timeoutOrigin} timeout`);
  const secondAttempt = await runAttempt();

  // First attempt failed to reap but the retry reaped cleanly: the suspect
  // tree is gone. Keep the file red — it genuinely timed out — and carry the
  // first attempt's reapError so the summary can explain the retry, but let
  // the shard continue instead of aborting.
  if (firstAttempt.reapFailed && !secondAttempt.reapFailed) {
    return {
      ...secondAttempt,
      passed: false,
      timedOut: true,
      reapFailed: false,
      reapError: firstAttempt.reapError ?? null,
    };
  }
  return secondAttempt;
}

export function runTestFile(
  file: string,
  options: RunTestFileOptions = {},
): Promise<TestResult> {
  const timeoutMs = options.timeoutMs ?? PER_FILE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let resolved = false;
    let spawnError: Error | null = null;
    const attemptDir = mkdtempSync(join(tmpdir(), 'llxprt-runner-junit-'));
    const reportPath = join(attemptDir, 'junit.xml');

    // Settlement always goes through cleanup, so a removal failure can
    // never strand this promise: the cleanup outcome is folded into the
    // result and surfaced through main()'s fail-fast path instead of
    // throwing out of an ignored callback.
    const settleAfterCleanup = (
      classified: Omit<TestResult, 'reapFailed' | 'reapError'>,
      reapFailed: boolean,
      reapError: string | null,
    ): void => {
      void cleanupAttemptDir(attemptDir, options).then(
        () => {
          resolve({ ...classified, reapFailed, reapError });
        },
        (cleanupError: unknown) => {
          const cleanupDetail = cleanupFailureMessage(
            file,
            attemptDir,
            cleanupError,
          );
          resolve({
            ...classified,
            reapFailed: true,
            reapError:
              reapError === null
                ? cleanupDetail
                : `${reapError}; ${cleanupDetail}`,
          });
        },
      );
    };
    const child = spawn(
      process.execPath,
      [
        'test',
        '--timeout',
        String(PER_TEST_TIMEOUT_MS),
        '--preload',
        PRELOAD,
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
        file,
      ],
      {
        cwd: WORKSPACE_ROOT,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: process.env,
        // POSIX: put the test child in its own process group so a timeout
        // can kill the entire per-test process tree by negative PID.
        // Windows ignores detached for process-group purposes; the Windows
        // path uses taskkill /T instead.
        detached: process.platform !== 'win32',
      },
    );
    const childClosed = observeChildClose(child);
    // Test seam mirroring removeAttemptDir: replaces the timed-out-child
    // reap so a test can force its failure deterministically instead of
    // racing SIGKILL-to-close latency against a millisecond budget.
    const reapTimedOutChild =
      options.reapTimedOutChild ??
      ((childToReap: ChildProcess, closed: Promise<void>) =>
        killChildTreeAndWait(childToReap, closed, options));
    // Test seam mirroring removeAttemptDir and reapTimedOutChild: replaces
    // the report scan so a test can force its failure deterministically.
    const scanReport =
      options.scanJUnitReport ?? junitReportContainsPerTestTimeout;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const classified: Omit<TestResult, 'reapFailed' | 'reapError'> = {
        file,
        passed: false,
        exitCode: null,
        timedOut: true,
        timeoutMs,
      };
      void reapTimedOutChild(child, childClosed).then(
        () => settleAfterCleanup(classified, false, null),
        (error: unknown) => {
          const reapErrorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `Failed to reap timed-out test process for ${file}: ${reapErrorMessage}`,
          );
          settleAfterCleanup(classified, true, reapErrorMessage);
        },
      );
    }, timeoutMs);

    child.on('error', (error: Error) => {
      spawnError = error;
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;
      if (spawnError !== null) {
        console.error(`Error spawning test for ${file}: ${spawnError.message}`);
      }
      let classified: Omit<TestResult, 'reapFailed' | 'reapError'> | undefined;
      let scanError: unknown;
      try {
        const perTestTimeout =
          spawnError === null && code !== 0 && scanReport(reportPath);
        classified = {
          file,
          passed: spawnError === null && code === 0,
          exitCode: spawnError === null ? code : -1,
          timedOut: perTestTimeout,
          timeoutMs: perTestTimeout ? null : timeoutMs,
        };
      } catch (error) {
        scanError = error;
      }
      if (classified !== undefined) {
        settleAfterCleanup(classified, false, null);
        return;
      }
      // Report-scan errors stay fail-fast: they are infrastructure
      // failures, not test outcomes. Cleanup runs exactly once before the
      // rejection, and a cleanup failure is preserved alongside the scan
      // error instead of surfacing as an unhandled rejection.
      void cleanupAttemptDir(attemptDir, options).then(
        () => {
          reject(scanError);
        },
        (cleanupError: unknown) => {
          reject(
            new AggregateError(
              [scanError, cleanupError],
              `report scan and attempt cleanup both failed for ${file}: could not remove ${attemptDir}`,
            ),
          );
        },
      );
    });
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeoutExceededLabel(result: TestResult): string {
  return result.timeoutMs === null
    ? 'per-test timeout'
    : `${result.timeoutMs / 1000}s`;
}

function buildFailureXml(result: TestResult): string {
  if (result.passed) {
    return '';
  }
  if (result.timedOut && result.reapFailed) {
    const message = escapeXml(
      result.reapError ?? 'Process tree reaping failed',
    );
    return `<failure message="${message}">TIMEOUT+REAP_FAILED</failure>`;
  }
  if (result.timedOut) {
    // A per-test timeout has no file-level number to cite: the test that
    // timed out may have overridden Bun's per-test budget.
    const message =
      result.timeoutMs === null
        ? 'Timed out: per-test timeout'
        : `Timed out after ${result.timeoutMs / 1000}s`;
    return `<failure message="${message}">TIMEOUT</failure>`;
  }
  return `<failure message="Exit code ${result.exitCode ?? -1}">FAILED</failure>`;
}

export function generateJUnit(results: TestResult[]): string {
  const newlines = '\n';
  const totalFiles = results.length;
  const failedCount = results.filter((result) => !result.passed).length;
  const testCases = results
    .map((r) => {
      const className = escapeXml(
        r.file.replace(/^src\//, '').replace(/\.(test|spec)\.tsx?$/, ''),
      );
      const failureXml = buildFailureXml(r);
      const timeAttr = r.passed ? '' : ' time="0"';
      return `    <testcase classname="${className}" name="${className}"${timeAttr}>${failureXml}</testcase>`;
    })
    .join(newlines);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totalFiles}" failures="${failedCount}">`,
    `  <testsuite name="core" tests="${totalFiles}" failures="${failedCount}">`,
    testCases,
    '  </testsuite>',
    '</testsuites>',
  ].join(newlines);
}

async function main(): Promise<void> {
  const testFiles = discoverTestFiles(WORKSPACE_ROOT).map((file) =>
    relative(WORKSPACE_ROOT, file),
  );
  if (testFiles.length === 0) {
    console.error('No test files found');
    process.exit(1);
  }

  console.log(
    `Running ${testFiles.length} test files with concurrency ${CONCURRENCY}`,
  );

  const results: TestResult[] = [];

  for (let i = 0; i < testFiles.length; i += CONCURRENCY) {
    const batch = testFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((file) =>
        runTestFileWithTimeoutRetry(file, () => runTestFile(file)),
      ),
    );
    results.push(...batchResults);

    // Fail fast: only an unrecovered reap or attempt-cleanup failure aborts
    // the run. A failure on the first attempt that the retry outlived
    // (reapFailed=false on the returned result) means the suspect tree is
    // gone and the file is already marked failed; subsequent files are safe
    // to run. A failure on the final attempt means the old process tree may
    // still be alive and holding resources (log handles, ports) that would
    // corrupt subsequent results.
    if (batchResults.some((r) => r.reapFailed)) {
      for (const result of batchResults) {
        if (result.reapFailed && result.reapError !== null) {
          console.error(`  ${result.file}: ${result.reapError}`);
        }
      }
      console.error(
        'FATAL: failed to reap a timed-out test process tree or clean up ' +
          'its attempt directory; aborting to avoid running subsequent files ' +
          'against leaked resources.',
      );
      writeFileSync(JUNIT_PATH, generateJUnit(results));
      process.exit(1);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  for (const result of failed) {
    if (result.timedOut) {
      console.error(
        `TIMEOUT: ${result.file} (exceeded ${timeoutExceededLabel(result)})` +
          (result.reapFailed
            ? ' [REAP FAILED]'
            : result.reapError
              ? ' [REAP FAILED (recovered on retry)]'
              : ''),
      );
    } else {
      console.error(
        `FAILED: ${result.file} (exit code ${result.exitCode ?? -1})`,
      );
    }
  }

  console.log(
    `Passed ${passed}/${testFiles.length} test files` +
      (failed.length > 0 ? ` (${failed.length} failed)` : ''),
  );

  writeFileSync(JUNIT_PATH, generateJUnit(results));

  process.exit(failed.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
