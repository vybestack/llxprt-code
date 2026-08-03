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
 * There is deliberately no exclusion list: issue #2845 requires that every test
 * file in this workspace runs under Bun. A file that cannot pass must be fixed,
 * not skipped.
 *
 * Exit code is 0 when every file passes and 1 when any file fails.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';

const TEST_ROOTS = ['src'] as const;

/**
 * Number of test files executed at once.
 *
 * Capped well below the core count on purpose. Many suites under
 * `src/api/__tests__/` build a real Agent (tool registry, provider bootstrap,
 * settings) per test, so they are far heavier than a typical unit test. Running
 * too many of those concurrently pushes individual tests past the 30s budget on
 * a loaded machine, which shows up as non-deterministic failures rather than as
 * a slow run. `LLXPRT_AGENTS_TEST_CONCURRENCY` overrides the default.
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
  return Math.max(1, Math.min(4, availableParallelism()));
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

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
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
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) {
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
  readonly timedOut: boolean;
}

function runTestFile(file: string): Promise<TestResult> {
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
      ['test', '--timeout', String(PER_TEST_TIMEOUT_MS), file],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      },
    );

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settleOnce({ file, passed: false, exitCode: null, timedOut: true });
    }, PER_FILE_TIMEOUT_MS);

    child.on('exit', (code) => {
      settleOnce({ file, passed: code === 0, exitCode: code, timedOut: false });
    });

    child.on('error', (error: Error) => {
      console.error(`Error spawning test for ${file}: ${error.message}`);
      settleOnce({ file, passed: false, exitCode: -1, timedOut: false });
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
  return result.timedOut
    ? `TIMEOUT after ${PER_FILE_TIMEOUT_MS}ms`
    : `exit code ${result.exitCode ?? -1}`;
}

function generateJUnit(results: readonly TestResult[]): string {
  const NL = '\n';
  const failedCount = results.filter((result) => !result.passed).length;
  const testCases = results
    .map((result) => {
      const className = escapeXml(
        result.file.replace(/\.(test|spec)\.tsx?$/, ''),
      );
      const failureXml = result.passed
        ? ''
        : `<failure message="${escapeXml(describeFailure(result))}">FAILED</failure>`;
      return `    <testcase classname="${className}" name="${className}" time="0">${failureXml}</testcase>`;
    })
    .join(NL);

  return (
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites tests="${results.length}" failures="${failedCount}">`,
      `  <testsuite name="agents" tests="${results.length}" failures="${failedCount}">`,
      testCases,
      '  </testsuite>',
      '</testsuites>',
    ].join(NL) + NL
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

  // Sliding worker pool: each worker takes the next unclaimed file as soon as
  // it is free. Fixed-size batches would hold `CONCURRENCY - 1` slots idle
  // while the slowest file in a batch finished, which both lengthens the run
  // and prolongs the contention window that makes slow files slower still.
  const results: TestResult[] = [];
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < testFiles.length) {
      const file = testFiles[nextIndex++];
      results.push(await runTestFile(file));
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

  writeFileSync('junit.xml', generateJUnit(results));
  process.exit(failed.length > 0 ? 1 : 0);
}

await main();
