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

import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { availableParallelism, tmpdir } from 'node:os';

const TEST_ROOTS = ['src'] as const;

/** Upper bound on file concurrency, regardless of how many cores are present. */
const MAX_CONCURRENCY = 4;

/** Lower bound, so a single-core reporting environment still makes progress. */
const MIN_CONCURRENCY = 2;

/**
 * Number of test files executed at once.
 *
 * Deliberately half the core count, clamped to [2, 4]. Each file is a fresh
 * `bun test` process that re-executes the whole agents module graph, and many
 * suites under `src/api/__tests__/` additionally build a real Agent (tool
 * registry, provider bootstrap, settings) per test. Saturating every core with
 * that work starves individual tests past the 30s budget, which surfaces as a
 * different file failing on each run rather than as an honestly slow run.
 * Leaving headroom matters most on small CI runners, where the core count is
 * roughly the concurrency an unclamped default would pick.
 *
 * `LLXPRT_AGENTS_TEST_CONCURRENCY` overrides this.
 */
function resolveConcurrency(): number {
  const override = process.env.LLXPRT_AGENTS_TEST_CONCURRENCY;
  if (override !== undefined) {
    if (!/^[1-9][0-9]*$/.test(override.trim())) {
      throw new Error(
        `LLXPRT_AGENTS_TEST_CONCURRENCY must be a positive integer, got: ${override}`,
      );
    }
    return Number.parseInt(override.trim(), 10);
  }
  const half = Math.floor(availableParallelism() / 2);
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, half));
}

const CONCURRENCY = resolveConcurrency();

/**
 * Per-test timeout, mirroring the `testTimeout: 30000` this workspace ran under
 * in Vitest.
 *
 * It must be passed on the command line: Bun 1.3.14 ignores a `[test] timeout`
 * key in `bunfig.toml` and silently falls back to its 5s default, which makes
 * the slower suites fail once the machine is under parallel load.
 */
const PER_TEST_TIMEOUT_MS = 30_000;

/**
 * Per-file wall-clock budget. The slowest agents files (streaming chat-session
 * suites) take tens of seconds, so this is generous enough to avoid flaking
 * while still converting a genuine hang into a reported failure.
 */
const PER_FILE_TIMEOUT_MS = 120_000;

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

interface TestResult {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  /** Set when the child was terminated by a signal rather than exiting. */
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

function runTestFile(file: string, reportPath: string): Promise<TestResult> {
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
        String(PER_TEST_TIMEOUT_MS),
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
        file,
      ],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      },
    );

    // Set by the wall-clock timer so the `close` handler can report the real
    // reason. The result is only produced once the process has actually been
    // reaped: settling from the timer itself would free the worker slot while
    // the killed process was still alive, letting the pool exceed its
    // concurrency cap exactly when the machine is already struggling.
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, PER_FILE_TIMEOUT_MS);

    // `close` rather than `exit`: it fires once the child's stdio has been
    // released, so a slot is not reused while the process is still tearing down.
    child.on('close', (code, signal) => {
      settleOnce({
        file,
        passed: !killedByTimeout && code === 0,
        exitCode: code,
        signal,
        timedOut: killedByTimeout,
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
      });
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

function describeFailure(result: TestResult): string {
  if (result.timedOut) {
    return `TIMEOUT after ${PER_FILE_TIMEOUT_MS}ms`;
  }
  if (result.signal !== null) {
    // Distinguishes an external kill (typically the OOM killer on a small CI
    // runner) from a genuine test failure, which would report an exit code.
    return `killed by signal ${result.signal}`;
  }
  return `exit code ${result.exitCode ?? -1}`;
}

/** Totals scraped from the root `<testsuites>` element of a Bun JUnit report. */
interface ReportTotals {
  readonly tests: number;
  readonly failures: number;
  readonly skipped: number;
}

function readIntAttribute(element: string, name: string): number {
  const match = new RegExp(`\\b${name}="([0-9]+)"`).exec(element);
  return match === null ? 0 : Number.parseInt(match[1], 10);
}

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
function extractReportBody(
  xml: string,
): { body: string; totals: ReportTotals } | undefined {
  const openMatch = /<testsuites\b[^>]*>/.exec(xml);
  const closeIndex = xml.lastIndexOf('</testsuites>');
  if (openMatch === null || closeIndex < 0) {
    return undefined;
  }
  const bodyStart = openMatch.index + openMatch[0].length;
  if (closeIndex < bodyStart) {
    return undefined;
  }
  return {
    body: xml.slice(bodyStart, closeIndex).replace(/^\n+|\n+$/g, ''),
    totals: {
      tests: readIntAttribute(openMatch[0], 'tests'),
      failures: readIntAttribute(openMatch[0], 'failures'),
      skipped: readIntAttribute(openMatch[0], 'skipped'),
    },
  };
}

/**
 * Synthesised suite for a file whose process died without writing a report, so
 * that a crash or a wall-clock kill still shows up as a failure instead of
 * silently contributing zero tests to the report.
 */
function unreportedSuite(result: TestResult): string {
  const name = escapeXml(result.file);
  const reason = escapeXml(describeFailure(result));
  return [
    `  <testsuite name="${name}" file="${name}" tests="1" failures="1" skipped="0" time="0">`,
    `    <testcase name="${name} (no test report produced)" classname="${name}" time="0">`,
    `      <failure message="${reason}">The bun test process produced no JUnit report.</failure>`,
    '    </testcase>',
    '  </testsuite>',
  ].join('\n');
}

function generateJUnit(
  results: readonly TestResult[],
  reportPathFor: (file: string) => string,
): string {
  const bodies: string[] = [];
  let tests = 0;
  let failures = 0;
  let skipped = 0;

  for (const result of results) {
    let report: string | undefined;
    try {
      report = readFileSync(reportPathFor(result.file), 'utf-8');
    } catch {
      report = undefined;
    }
    const extracted =
      report === undefined ? undefined : extractReportBody(report);
    if (extracted === undefined) {
      bodies.push(unreportedSuite(result));
      tests += 1;
      failures += 1;
      continue;
    }
    bodies.push(extracted.body);
    tests += extracted.totals.tests;
    failures += extracted.totals.failures;
    skipped += extracted.totals.skipped;
  }

  return (
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites name="agents" tests="${tests}" failures="${failures}" skipped="${skipped}">`,
      ...bodies,
      '</testsuites>',
    ].join('\n') + '\n'
  );
}

async function main(): Promise<void> {
  const testFiles = TEST_ROOTS.flatMap((root) => findTestFiles(root)).sort();
  if (testFiles.length === 0) {
    console.error('No test files found under: ' + TEST_ROOTS.join(', '));
    process.exit(1);
  }

  console.log(
    `Running ${testFiles.length} agents test files with concurrency ${CONCURRENCY}`,
  );

  // Each child writes its own JUnit report here; they are merged into a single
  // workspace-level junit.xml once the run finishes.
  const reportDir = mkdtempSync(join(tmpdir(), 'agents-bun-junit-'));
  const reportPathFor = (file: string): string =>
    join(reportDir, `${file.replace(/[\\/]/g, '__')}.xml`);

  // Sliding worker pool: each worker takes the next unclaimed file as soon as
  // it is free. Fixed-size batches would hold `CONCURRENCY - 1` slots idle
  // while the slowest file in a batch finished, which both lengthens the run
  // and prolongs the contention window that makes slow files slower still.
  const results: TestResult[] = [];
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < testFiles.length) {
      const file = testFiles[nextIndex++];
      try {
        results.push(await runTestFile(file, reportPathFor(file)));
      } catch (error: unknown) {
        // `spawn` can throw synchronously under OS-level resource exhaustion
        // (EMFILE). Record it as a failed file so the run still produces a
        // report and a controlled exit code rather than dying on an unhandled
        // rejection and discarding every result collected so far.
        console.error(
          `Unexpected error running ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        results.push({
          file,
          passed: false,
          exitCode: -1,
          signal: null,
          timedOut: false,
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, testFiles.length) }, worker),
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

  writeFileSync('junit.xml', generateJUnit(results, reportPathFor));
  rmSync(reportDir, { recursive: true, force: true });
  process.exit(failed.length > 0 ? 1 : 0);
}

await main();
