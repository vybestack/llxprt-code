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

import {
  resolveRunnerTimeouts,
  classifyAttempt,
  runCoreTimeoutRetry,
  renderJUnitReport,
  buildCoreJUnitCases,
  cleanupAttemptDirectory,
  observeChildClose,
  killChildTreeAndWait,
  junitReportContainsPerTestTimeout,
  JUNIT_SCAN_CHUNK_BYTES,
} from '../../scripts/lib/bun-test-retry.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  DEFAULT_PER_TEST_TIMEOUT_MS,
  resolveTestConcurrency,
} from '../../scripts/lib/bun-test-policy.js';
import {
  assertRunnerActive,
  createBespokeRunnerIsolation,
  throwWorkerFailures,
  installRunnerSignalHandlers,
  trackRunnerChild,
} from '../../scripts/lib/bespoke-runner-isolation.js';

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
  /**
   * Env the test process is spawned with (issue #3622): main() passes the
   * session env with the fake HOME/TMPDIR/XDG root. Defaults to the runner's
   * own environment.
   */
  readonly env?: NodeJS.ProcessEnv;
}

function cleanupFailureMessage(
  file: string,
  attemptDir: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `attempt cleanup failed for ${file}: could not remove ${attemptDir}: ${detail}`;
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
  return runCoreTimeoutRetry(file, runAttempt, logRetry);
}

export function runTestFile(
  file: string,
  options: RunTestFileOptions = {},
): Promise<TestResult> {
  assertRunnerActive();
  const timeoutMs = resolveRunnerTimeouts({
    runner: 'core',
    timeoutMs: options.timeoutMs,
  }).perFileMs;
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
      void cleanupAttemptDirectory(attemptDir, options).then(
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
        env: options.env ?? process.env,
        // POSIX: put the test child in its own process group so a timeout
        // can kill the entire per-test process tree by negative PID.
        // Windows ignores detached for process-group purposes; the Windows
        // path uses taskkill /T instead.
        detached: process.platform !== 'win32',
      },
    );
    trackRunnerChild(child);
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
        ...classifyAttempt({
          runner: 'core',
          spawnFailed: false,
          killedByTimer: true,
          exitCode: null,
          perTestTimeout: false,
          fileTimeoutMs: timeoutMs,
        }),
        exitCode: null,
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
          ...classifyAttempt({
            runner: 'core',
            spawnFailed: spawnError !== null,
            killedByTimer: false,
            exitCode: code,
            perTestTimeout,
            fileTimeoutMs: timeoutMs,
          }),
          exitCode: spawnError === null ? code : -1,
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
      void cleanupAttemptDirectory(attemptDir, options).then(
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

function timeoutExceededLabel(result: TestResult): string {
  return result.timeoutMs === null
    ? 'per-test timeout'
    : `${result.timeoutMs / 1000}s`;
}

export function generateJUnit(results: TestResult[]): string {
  const totalFiles = results.length;
  const failedCount = results.filter((result) => !result.passed).length;
  return renderJUnitReport({
    kind: 'workspace-summary',
    workspace: 'core',
    cases: buildCoreJUnitCases(results),
    totalFiles,
    failedCount,
  });
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

  // Session-scoped fake system root (issue #3622): every spawned test process
  // gets HOME/TMPDIR/XDG_* inside a throwaway root while this runner keeps
  // its real environment for the sentinel guard.
  const isolation = createBespokeRunnerIsolation(process.env);
  const removeSignalHandlers = installRunnerSignalHandlers(() => {
    isolation.finalize();
  });
  let exitCode = 1;
  let failFast = false;
  try {
    const results: TestResult[] = [];

    for (let i = 0; i < testFiles.length; i += CONCURRENCY) {
      const batch = testFiles.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((file) =>
          isolation.runFile(file, () =>
            runTestFileWithTimeoutRetry(file, () =>
              runTestFile(file, { env: isolation.sessionEnv }),
            ),
          ),
        ),
      );
      const batchResults = throwWorkerFailures(settled);
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
        failFast = true;
        break;
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

    exitCode = failFast || failed.length > 0 ? 1 : 0;
  } finally {
    try {
      if (isolation.finalize() > 0 && exitCode === 0) exitCode = 1;
    } catch (error) {
      console.error(`Test runner cleanup failed: ${String(error)}`);
      if (exitCode === 0) exitCode = 1;
    } finally {
      removeSignalHandlers();
    }
    process.exitCode = exitCode;
  }
  if (failFast) process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}

export {
  observeChildClose,
  killChildTreeAndWait,
  junitReportContainsPerTestTimeout,
  JUNIT_SCAN_CHUNK_BYTES,
};
