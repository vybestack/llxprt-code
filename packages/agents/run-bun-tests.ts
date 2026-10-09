/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the agents workspace (issue #2845).
 *
 * Discovers every test file under `src/` and runs each one in its own
 * `bun test <file>` process with bounded parallelism.
 *
 * Per-file processes are required, not merely preferred:
 *
 * 1. Bun's `mock.module` registry is process-wide, unlike Vitest's per-file
 *    module graph. 69 agents test files register module mocks; sharing a
 *    process would let one file's mocks leak into another's imports.
 * 2. `bun test --parallel` hits a Bun 1.3.x teardown hang on Linux (see
 *    packages/core/run-bun-tests.ts for the original diagnosis).
 *
 * Preloads (the Bun/Vitest compatibility shim and Storage-root isolation) come
 * from `bunfig.toml`, which Bun reads from the working directory of each child.
 *
 * There is deliberately no test-exclusion list: issue #2845 requires that every
 * test file in this workspace runs under Bun. A file that cannot pass must be
 * fixed, not skipped. Discovery prunes only build and dependency output — see
 * `PRUNED_DIRECTORIES`.
 *
 * Exit code is 0 when every file passes and 1 when any file fails.
 */

import {
  resolveRunnerTimeouts,
  classifyAttempt,
  runTimeoutRetry,
  killTimedOutChild,
  renderJUnitReport,
  formatAgentsFailureReason,
} from '../../scripts/lib/bun-test-retry.js';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import {
  acceptancePolicyForFile,
  envPerFileTimeoutMs,
  MAX_TEST_CONCURRENCY,
  resolveTestConcurrency,
  scheduleTestFiles,
} from '../../scripts/lib/bun-test-policy.js';
import {
  assertRunnerActive,
  createBespokeRunnerIsolation,
  installRunnerSignalHandlers,
  trackRunnerChild,
} from '../../scripts/lib/bespoke-runner-isolation.js';

process.env.LLXPRT_RUNNING_TESTS = 'true';

/**
 * Every path this runner touches — discovery, the child's working directory
 * and the JUnit report — is anchored here rather than at `process.cwd()`, so
 * the runner behaves identically no matter where it is invoked from.
 */
const WORKSPACE_ROOT = import.meta.dir;
const JUNIT_PATH = join(WORKSPACE_ROOT, 'junit.xml');

const TEST_ROOTS = ['src'] as const;

/**
 * Upper bound on file concurrency, regardless of how many cores are present.
 *
 * Kept as a named constant because the JUnit summary reports it.
 */
const MAX_CONCURRENCY = MAX_TEST_CONCURRENCY;

/**
 * Number of test files executed at once.
 *
 * The half-the-cores policy this workspace arrived at by measurement now lives
 * in scripts/lib/bun-test-policy.ts, so the other runners inherit it instead of
 * rediscovering it (issue #3139). `LLXPRT_AGENTS_TEST_CONCURRENCY` overrides.
 */
const CONCURRENCY = resolveTestConcurrency({
  envVar: 'LLXPRT_AGENTS_TEST_CONCURRENCY',
  maxConcurrency: MAX_CONCURRENCY,
});

/**
 * Per-test timeout, mirroring the `testTimeout: 30000` this workspace ran under
 * in Vitest.
 *
 * It must be passed on the command line: Bun 1.3.14 ignores a `[test] timeout`
 * key in `bunfig.toml` and silently falls back to its 5s default, which makes
 * the slower suites fail once the machine is under parallel load.
 *
 * Raised from 30s against measurement. subagentOrchestrator-loadBalancer runs
 * a real load-balancer activation: ~430ms per launch in isolation, but with
 * the pool saturated a single launch was timed at 78.6s while consuming 0.8s
 * of user CPU, so it is waiting on something rather than computing. Failure
 * rate for that file across repeated runs at this pool's concurrency: 4/24 at
 * 30s, 0/24 at 60s, 0/16 at 200s. The work completes; the old bound simply
 * cut it off.
 *
 * This covers slow suites only. A suite that never completes is still caught
 * by the per-file budget below, which is what should happen - a raised per-test
 * bound must not turn a hang into a longer hang.
 */
export function timeoutForFile(file: string): number {
  return (
    acceptancePolicyForFile(WORKSPACE_ROOT, file)?.perTestTimeoutMs ??
    resolveRunnerTimeouts({ runner: 'agents', env: {} }).perTestMs
  );
}

export function fileTimeoutForFile(file: string): number {
  const ordinary = resolveRunnerTimeouts({
    runner: 'agents',
    env: process.env,
  });
  return (
    acceptancePolicyForFile(WORKSPACE_ROOT, file)?.perFileTimeoutMs ??
    ordinary.perFileMs
  );
}

export function runTestFiles<T>(
  files: readonly string[],
  concurrency: number,
  runFile: (file: string) => Promise<T>,
): Promise<T[]> {
  return scheduleTestFiles(WORKSPACE_ROOT, files, concurrency, runFile);
}

/**
 * Directories that are pruned during discovery.
 *
 * This is NOT a test-exclusion list — issue #2845 requires that every test file
 * in this workspace runs, and no source test file may be filtered out. These
 * entries are build and dependency output that must never be traversed:
 *
 * - `node_modules` contains third-party packages that ship their own tests.
 * - `dist` and `coverage` contain generated copies of this workspace's sources;
 *   traversing them would execute duplicate, stale builds of the same tests.
 *
 * Dot-prefixed directories are pruned for the same reason, most importantly
 * `.stryker-tmp`: the mutation gate runs `inPlace`, leaving a pristine copy of
 * the project under `.stryker-tmp/backup-<id>/`. Discovering that copy would
 * double-count every test. The Vitest config this runner replaces pruned the
 * same set (`configDefaults.exclude` plus an explicit `.stryker-tmp` exclude),
 * so discovery is unchanged from the pre-migration behaviour.
 */
const PRUNED_DIRECTORIES: ReadonlySet<string> = new Set([
  'coverage',
  'dist',
  'node_modules',
]);

const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
] as const;

function isTestFile(entry: string): boolean {
  return TEST_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix));
}

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (PRUNED_DIRECTORIES.has(entry) || entry.startsWith('.')) {
      continue;
    }
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (isTestFile(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Returns the absolute paths of every test file this runner would execute for
 * the given absolute workspace `root`. The script entry point calls this same
 * function (see `main`), so the two can never diverge.
 *
 * Root scanned: `src`. Files match the `TEST_FILE_SUFFIXES` conventions and
 * the `PRUNED_DIRECTORIES` entries (build/dependency output) plus dot-prefixed
 * directories are skipped.
 */
export function discoverTestFiles(root: string): string[] {
  return TEST_ROOTS.flatMap((testRoot) =>
    findTestFiles(join(root, testRoot)),
  ).sort();
}

interface TestResult {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  /** Set when the child was terminated by a signal rather than exiting. */
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly timeoutMs: number;
}

export async function runTestFileWithTimeoutRetry<
  T extends { readonly timedOut: boolean },
>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void = (message) => console.log(message),
): Promise<T> {
  return runTimeoutRetry(file, runAttempt, logRetry);
}

export function runTestFile(
  file: string,
  reportPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TestResult> {
  assertRunnerActive();
  const timeoutMs = fileTimeoutForFile(file);
  rmSync(reportPath, { force: true });
  return new Promise((resolve) => {
    let settled = false;
    const settleOnce = (result: TestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // process.execPath is the Bun binary: this script is launched with `bun`.
    const child = spawn(
      process.execPath,
      [
        'test',
        '--timeout',
        String(timeoutForFile(file)),
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
        file,
      ],
      {
        cwd: WORKSPACE_ROOT,
        stdio: 'inherit',
        env,
        detached: process.platform !== 'win32',
      },
    );
    trackRunnerChild(child);

    // Set by the wall-clock timer so the `close` handler can report the real
    // reason. The result is only produced once the process has actually been
    // reaped: settling from the timer itself would free the worker slot while
    // the killed process was still alive, letting the pool exceed its
    // concurrency cap exactly when the machine is already struggling.
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        killTimedOutChild({ runner: 'agents', child });
      } catch (error) {
        console.error(
          `Failed to kill timed-out test child ${child.pid}: ${String(error)}`,
        );
      }
    }, timeoutMs);

    // `close` rather than `exit`: it fires once the child's stdio has been
    // released, so a slot is not reused while the process is still tearing down.
    child.on('close', (code, signal) => {
      settleOnce({
        file,
        passed: classifyAttempt({
          runner: 'agents',
          killedByTimer: killedByTimeout,
          exitCode: code,
        }).passed,
        exitCode: code,
        signal,
        timedOut: killedByTimeout,
        timeoutMs,
      });
    });

    child.on('error', (error: Error) => {
      console.error(`Error spawning test for ${file}: ${error.message}`);
      settleOnce({
        file,
        passed: false,
        exitCode: -1,
        signal: null,
        timedOut: false,
        timeoutMs,
      });
    });
  });
}

function describeFailure(result: TestResult): string {
  return formatAgentsFailureReason(result);
}

/** Totals scraped from the root `<testsuites>` element of a Bun JUnit report. */

/**
 * Extracts the suite body and totals from one child's JUnit report.
 *
 * Bun writes a single root `<testsuites>` element wrapping nested `<testsuite>`
 * elements that carry the real test cases, names and durations. Splicing those
 * bodies into one root preserves every individual test record, which is what
 * the `dorny/test-reporter` CI step consumes — a file-level summary would lose
 * the per-test detail the Vitest reporter used to publish.
 *
 * Returns `undefined` when the child produced no usable report, i.e. it crashed
 * or was killed before writing one.
 */

/**
 * Synthesised suite for a file whose process died without writing a report, so
 * that a crash or a wall-clock kill still shows up as a failure instead of
 * silently contributing zero tests to the report.
 */

function generateJUnit(
  results: readonly TestResult[],
  reportPathFor: (file: string) => string,
): string {
  return renderJUnitReport({
    kind: 'agents-detail',
    files: results.map((result) => ({
      file: result.file,
      failureReason: describeFailure(result),
      reportPath: reportPathFor(result.file),
    })),
  });
}

async function main(): Promise<void> {
  // Fail fast on an invalid per-file budget before any worker spawns, so the
  // EMFILE catch-all in the worker cannot swallow a misconfiguration into a
  // generic failed-file result. The validated value also feeds the catch-all
  // so spawn failures report the budget that was actually in effect.
  envPerFileTimeoutMs(process.env, 'LLXPRT_TEST_FILE_TIMEOUT_MS');
  const testFiles = discoverTestFiles(WORKSPACE_ROOT).map((file) =>
    relative(WORKSPACE_ROOT, file),
  );
  if (testFiles.length === 0) {
    console.error('No test files found under: ' + TEST_ROOTS.join(', '));
    process.exit(1);
  }

  console.log(
    `Running ${testFiles.length} agents test files with concurrency ${CONCURRENCY}`,
  );

  // Session-scoped fake system root (issue #3622): every spawned test process
  // gets HOME/TMPDIR/XDG_* inside a throwaway root while this runner keeps
  // its real environment for the sentinel guard.
  const isolation = createBespokeRunnerIsolation(process.env);
  const removeSignalHandlers = installRunnerSignalHandlers(() => {
    isolation.finalize();
  });
  let exitCode = 1;
  try {
    // Each child writes its own JUnit report here; they are merged into a single
    // workspace-level junit.xml once the run finishes.
    const reportDir = mkdtempSync(join(tmpdir(), 'agents-bun-junit-'));
    const reportPathFor = (file: string): string =>
      join(reportDir, `${file.replace(/[\\/]/g, '__')}.xml`);

    // Sliding worker pool: each worker takes the next unclaimed file as soon as
    // it is free. Fixed-size batches would hold `CONCURRENCY - 1` slots idle
    // while the slowest file in a batch finished, which both lengthens the run
    // and prolongs the contention window that makes slow files slower still.
    const results = await runTestFiles<TestResult>(
      testFiles,
      CONCURRENCY,
      async (file) => {
        try {
          const reportPath = reportPathFor(file);
          return await isolation.runFile(file, () =>
            runTestFileWithTimeoutRetry(file, () =>
              runTestFile(file, reportPath, isolation.sessionEnv),
            ),
          );
        } catch (error: unknown) {
          // OS-level spawn exhaustion must remain a failed file in the report.
          console.error(
            `Unexpected error running ${file}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            file,
            passed: false,
            exitCode: -1,
            signal: null,
            timedOut: false,
            timeoutMs: fileTimeoutForFile(file),
          };
        }
      },
    );

    results.sort((left, right) => left.file.localeCompare(right.file));

    const failed = results.filter((result) => !result.passed);
    for (const result of failed) {
      console.error(`FAILED: ${result.file} (${describeFailure(result)})`);
    }

    console.log(
      `Passed ${results.length - failed.length}/${testFiles.length} test files` +
        (failed.length > 0 ? ` (${failed.length} failed)` : ''),
    );

    writeFileSync(JUNIT_PATH, generateJUnit(results, reportPathFor));
    rmSync(reportDir, { recursive: true, force: true });

    exitCode = failed.length > 0 ? 1 : 0;
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
}

if (import.meta.main) {
  await main();
}
