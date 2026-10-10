/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the CLI workspace.
 *
 * Discovers every test file in the workspace and runs each one in its own
 * `bun test` process with bounded parallelism. A process per file is required
 * because Bun's `mock.module` registry is process-wide, so sharing a process
 * would leak mocks between files.
 *
 * Discovery is purely structural: there is no manifest, allow-list or exclude
 * list. The Vitest setup this replaced carried both a large `baseExclude` glob
 * list and a separate integration-only command, and files matching either were
 * silently never run — they drifted out of sync with the product without any
 * signal. Every test file in the workspace runs here.
 *
 * Exit code is 0 when every file passes and 1 when any file fails.
 */

import {
  resolveRunnerTimeouts,
  classifyAttempt,
  runTimeoutRetry,
  killTimedOutChild,
  renderJUnitReport,
  buildCliJUnitCases,
  escapeCliXml as escapeXml,
  stripAnsi,
  parseCaseCounts,
  failureExcerpt,
} from '../../scripts/lib/bun-test-retry.js';
import { spawn } from 'node:child_process';
import { readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, win32 } from 'node:path';
import {
  acceptancePolicyForFile,
  envPerFileTimeoutMs,
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

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '__snapshots__',
]);
const TEST_ROOTS = ['src', 'test', 'test-bun', 'test-utils'];
/**
 * Test files use three naming conventions in this workspace: `*.test.*`,
 * `*.spec.*`, and `*.bun.*` for suites that import `bun:test` directly rather
 * than through the Vitest shim. All three must be discovered — the `.bun.*`
 * suites were previously reachable only through the shared manifest, so
 * matching just `.test`/`.spec` would silently stop running eleven files.
 */
const TEST_FILE_PATTERN = /\.(test|spec|bun)\.(ts|tsx)$/;

/**
 * Matches the `*.integration.test.*` / `*.integration.spec.*` naming used by
 * tests that drive the CLI as a subprocess. These files are still discovered
 * and run; the pattern only selects the larger per-test budget.
 */
const INTEGRATION_FILE_PATTERN = /\.integration\.(test|spec)\.(ts|tsx)$/;

/**
 * Bun treats a bare argument as a name *filter* and only as a path when it is
 * explicitly relative. A `.bun.ts` suite contains neither `.test` nor `.spec`,
 * so passing it bare matched nothing and the file silently did not run.
 */
export function toPathArgument(file: string): string {
  // win32.isAbsolute also accepts drive-letter paths, so a Windows-style path
  // survives as-is regardless of which OS the runner is on.
  return isAbsolute(file) || win32.isAbsolute(file) || file.startsWith('./')
    ? file
    : `./${file}`;
}

export function timeoutForFile(file: string): number {
  return (
    acceptancePolicyForFile(import.meta.dir, file)?.perTestTimeoutMs ??
    resolveRunnerTimeouts({
      runner: 'cli',
      integration: INTEGRATION_FILE_PATTERN.test(file),
      env: {},
    }).perTestMs
  );
}

export function runTestFiles<T>(
  files: readonly string[],
  concurrency: number,
  runFile: (file: string) => Promise<T>,
): Promise<T[]> {
  return scheduleTestFiles(import.meta.dir, files, concurrency, runFile);
}

/**
 * Whole-file budget. An integration file runs many cases that each spawn the
 * CLI, and on CI a single spawn costs roughly ten seconds against well under a
 * second locally — so a file that finishes in seconds on a developer machine
 * needs minutes there. The budget is a hang guard, so it is sized to admit a
 * slow-but-progressing file rather than to bound total runtime.
 */
export function fileTimeoutForFile(file: string): number {
  const runnerEnv = process.env;
  const ordinary = resolveRunnerTimeouts({
    runner: 'cli',
    integration: INTEGRATION_FILE_PATTERN.test(file),
    env: runnerEnv,
  });
  return (
    acceptancePolicyForFile(import.meta.dir, file)?.perFileTimeoutMs ??
    ordinary.perFileMs
  );
}

function parseConcurrency(): number {
  const flagIndex = process.argv.indexOf('--concurrency');
  if (flagIndex >= 0) {
    const parsed = Number.parseInt(process.argv[flagIndex + 1] ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return resolveTestConcurrency({ envVar: 'LLXPRT_CLI_TEST_CONCURRENCY' });
}

export function isTestFile(fileName: string): boolean {
  return TEST_FILE_PATTERN.test(fileName);
}

// ---------------------------------------------------------------------------
// Partition selection (issue #3185)
// ---------------------------------------------------------------------------

/**
 * Environment variable consumed by this runner for partition selection.
 * Exported so the workflow wiring test can assert the YAML env key matches,
 * preventing string drift between the runner and the workflow.
 */
export const PARTITION_ENV_VAR = 'LLXPRT_CLI_TEST_PARTITION';

/**
 * A one-based partition identity parsed from the canonical `NofM` form
 * (e.g. `2of3`). `null` from {@link parsePartitionIdentity} means "no
 * partition" — run the full discovered inventory.
 */
export interface PartitionIdentity {
  /** One-based partition index (1..count). */
  readonly index: number;
  /** Number of partitions (positive integer ≥ 1). */
  readonly count: number;
}

/**
 * Canonical form: one-or-more digits, literal `of`, one-or-more digits. The
 * first digit must be 1-9 so leading zeros (`01of3`) are rejected as
 * noncanonical.
 */
const PARTITION_RE = /^([1-9][0-9]*)of([1-9][0-9]*)$/;

/**
 * Parses an optional partition identity from the canonical `NofM` form (e.g.
 * `2of3`). Returns `null` when the input is absent or blank, meaning the full
 * discovered inventory should run.
 *
 * Throws on any noncanonical, zero, negative, unsafe, or out-of-range value so
 * a misconfigured {@link PARTITION_ENV_VAR} never silently runs a partial
 * suite. The variable name appears in every error so the cause is obvious.
 *
 * Blank semantics: undefined, empty, and whitespace-only values are treated as
 * "no partition" (full run). Every nonblank value must match canonical `NofM`
 * exactly — the raw string is validated, not a trimmed copy — so surrounding
 * whitespace (` 1of3 `) is rejected rather than silently starting a partial run.
 */
export function parsePartitionIdentity(
  raw: string | undefined,
): PartitionIdentity | null {
  if (raw === undefined || raw.trim() === '') return null;
  const match = PARTITION_RE.exec(raw);
  if (match === null) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${raw}' is not a canonical partition identity (expected NofM, e.g. 2of3)`,
    );
  }
  const indexStr = match[1];
  const countStr = match[2];
  const index = Number.parseInt(indexStr, 10);
  const count = Number.parseInt(countStr, 10);
  // Number.isSafeInteger rejects values outside [-(2^53 - 1), 2^53 - 1],
  // including 2^53 which round-trips through String() without precision loss
  // but is still not safely representable.
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count)) {
    throw new Error(`${PARTITION_ENV_VAR}='${raw}' contains an unsafe integer`);
  }
  if (index > count) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${raw}' has index ${index} greater than count ${count}`,
    );
  }
  return { index, count };
}

/**
 * Selects one partition from a sorted list by round-robin: file position
 * modulo partition count equals partition index minus one. This maps every
 * array position to exactly one partition and preserves relative order.
 *
 * Returns the full list (a copy) when there is no partition (`null`) or when
 * the identity is `1of1`. Throws when a well-formed partitioned identity
 * (count > 1) selects no files, so an empty explicit selection fails fast
 * rather than producing a green no-op run.
 */
export function selectPartition(
  files: readonly string[],
  identity: PartitionIdentity | null,
): readonly string[] {
  if (identity === null || identity.count === 1) {
    return [...files];
  }
  const selected = files.filter(
    (_, i) => i % identity.count === identity.index - 1,
  );
  if (selected.length === 0) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${identity.index}of${identity.count}' selected 0 of ${files.length} discovered test files`,
    );
  }
  return selected;
}

function collectTestFiles(
  dir: string,
  results: string[],
  visited: Set<string> = new Set(),
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) {
      continue;
    }
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      // statSync follows symlinks, so a cycle such as src/utils -> src would
      // recurse until the process dies. Descend by real path and only once.
      const realPath = realpathSync(fullPath);
      if (visited.has(realPath)) {
        continue;
      }
      visited.add(realPath);
      collectTestFiles(fullPath, results, visited);
    } else if (isTestFile(entry)) {
      results.push(fullPath);
    }
  }
}

export function discoverTestFiles(root: string): string[] {
  const results: string[] = [];
  const visited = new Set<string>();
  for (const testRoot of TEST_ROOTS) {
    collectTestFiles(join(root, testRoot), results, visited);
  }
  return results
    .map((file) => relative(root, file).split('\\').join('/'))
    .sort();
}

interface TestResult {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
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

export async function runTestFile(
  file: string,
  env: NodeJS.ProcessEnv = { ...process.env },
  onTimeout?: () => void,
): Promise<TestResult> {
  assertRunnerActive();
  // Resolve the budget before spawning so an invalid override fails fast
  // instead of stranding an already-started child without a timeout.
  const timeoutMs = fileTimeoutForFile(file);
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawn(
      process.execPath,
      ['test', '--timeout', String(timeoutForFile(file)), toPathArgument(file)],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        // Own process group so a timeout can take down the whole tree. Tests
        // that spawn the real CLI leave grandchildren which would otherwise
        // survive the kill and hold pipes open into later files.
        detached: process.platform !== 'win32',
      },
    );
    trackRunnerChild(child);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    // Set by the timer so the exit handler can report the real reason. The
    // result is only produced once the process has actually exited: killing a
    // tree only signals it, so resolving from the timer would free this worker
    // slot while the tree was still winding down. The pool would then exceed
    // its concurrency cap exactly when the machine is already struggling —
    // which is how a timeout on one file turns into timeouts on others.
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      killTimedOutChild({ runner: 'cli', child });
      try {
        onTimeout?.();
      } catch (error) {
        console.error(`Test timeout callback failed: ${String(error)}`);
      }
    }, timeoutMs);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        passed: classifyAttempt({
          runner: 'cli',
          killedByTimer: killedByTimeout,
          exitCode: code,
        }).passed,
        exitCode: killedByTimeout ? null : code,
        timedOut: killedByTimeout,
        output,
      });
    });

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        passed: false,
        exitCode: -1,
        timedOut: false,
        output: `${output}\nFailed to spawn bun test: ${error.message}`,
      });
    });
  });
}

export function generateJUnit(results: readonly TestResult[]): string {
  const totalFiles = results.length;
  const failedCount = results.filter((result) => !result.passed).length;
  return renderJUnitReport({
    kind: 'workspace-summary',
    workspace: 'cli',
    cases: buildCliJUnitCases(results, fileTimeoutForFile),
    totalFiles,
    failedCount,
  });
}

export function exitCodeForRun(
  failedTestFileCount: number,
  junitWriteFailed: boolean,
): 0 | 1 {
  return failedTestFileCount > 0 || junitWriteFailed ? 1 : 0;
}

function printRunSummary(
  results: readonly TestResult[],
  failed: readonly TestResult[],
): void {
  for (const result of failed) {
    console.error(`
----- ${result.file} -----`);
    console.error(failureExcerpt(stripAnsi(result.output), 6000));
  }
  const cases = results.reduce(
    (total, result) => {
      const counts = parseCaseCounts(result.output);
      return {
        pass: total.pass + counts.pass,
        fail: total.fail + counts.fail,
        skip: total.skip + counts.skip,
        todo: total.todo + counts.todo,
      };
    },
    { pass: 0, fail: 0, skip: 0, todo: 0 },
  );
  console.log(
    `Passed ${results.length - failed.length}/${results.length} CLI test files` +
      (failed.length > 0 ? ` (${failed.length} failed)` : ''),
  );
  console.log(
    `Test cases: ${cases.pass} passed, ${cases.fail} failed, ` +
      `${cases.skip} skipped, ${cases.todo} todo ` +
      `(${cases.pass + cases.fail + cases.skip + cases.todo} total)`,
  );
}

async function main(): Promise<void> {
  const root = import.meta.dir;
  // Fail fast on an invalid per-file budget before any worker spawns, so a
  // misconfiguration cannot kill the run mid-flight without a JUnit report.
  envPerFileTimeoutMs(process.env, 'LLXPRT_TEST_FILE_TIMEOUT_MS');
  const testFiles = discoverTestFiles(root);
  if (testFiles.length === 0) {
    console.error('No CLI test files were discovered.');
    process.exit(1);
  }

  // Partition selection (issue #3185): apply only AFTER full discovery so the
  // test-file coverage guard always inspects the complete inventory. Discovery
  // itself never reads this env var.
  const partitionIdentity = parsePartitionIdentity(
    process.env[PARTITION_ENV_VAR],
  );
  const selectedFiles = selectPartition(testFiles, partitionIdentity);

  const concurrency = parseConcurrency();
  if (partitionIdentity !== null && partitionIdentity.count > 1) {
    console.log(
      `Running ${selectedFiles.length}/${testFiles.length} CLI test files with concurrency ${concurrency} (${PARTITION_ENV_VAR}=${partitionIdentity.index}of${partitionIdentity.count})`,
    );
  } else {
    console.log(
      `Running ${testFiles.length} CLI test files with concurrency ${concurrency}`,
    );
  }

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
    let completed = 0;
    const results = await runTestFiles(
      selectedFiles,
      concurrency,
      async (file) => {
        const result = await isolation.runFile(file, () =>
          runTestFileWithTimeoutRetry(file, () =>
            runTestFile(file, isolation.sessionEnv, () => {
              failFast = true;
            }),
          ),
        );
        completed++;
        if (!result.passed) {
          console.error(
            `FAIL (${completed}/${selectedFiles.length}) ${result.file}${
              result.timedOut ? ' [timeout]' : ''
            }`,
          );
        }
        return result;
      },
    );

    results.sort((a, b) => a.file.localeCompare(b.file));
    const failed = results.filter((result) => !result.passed);

    printRunSummary(results, failed);

    // A write failure must not replace the run's verdict with an unhandled
    // exception, but losing the required CI artifact is still a failed run.
    let junitWriteFailed = false;
    try {
      writeFileSync(join(root, 'junit.xml'), generateJUnit(results));
    } catch (error) {
      junitWriteFailed = true;
      console.error(
        `Failed to write junit.xml: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    exitCode = exitCodeForRun(failed.length, junitWriteFailed);
  } finally {
    try {
      if (isolation.finalize() > 0) exitCode = 1;
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

export { escapeXml, stripAnsi, parseCaseCounts, failureExcerpt };
