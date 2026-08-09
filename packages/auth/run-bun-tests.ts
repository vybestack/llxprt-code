/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the auth workspace that discovers all test files
 * and runs them in isolated bun test processes with bounded parallelism.
 *
 * See packages/core/run-bun-tests.ts for rationale (Bun 1.3.x Linux hang).
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const WORKSPACE_ROOT = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(WORKSPACE_ROOT, 'bun-preload.ts');
const JUNIT_PATH = join(WORKSPACE_ROOT, 'junit.xml');
const CONCURRENCY = resolveTestConcurrency({
  envVar: 'LLXPRT_AUTH_TEST_CONCURRENCY',
});
const PER_FILE_TIMEOUT_MS = DEFAULT_PER_FILE_TIMEOUT_MS;

const TEST_ROOTS = ['src'] as const;

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
 * Root scanned: `src`. Files match `*.test.ts` / `*.test.tsx` / `*.spec.ts` /
 * `*.spec.tsx` (`.d.ts` excluded); `dist`, `node_modules`, `coverage` and
 * dot-prefixed entries are skipped.
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
  signal: NodeJS.Signals | null;
}

export function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(
      process.execPath,
      [
        'test',
        // Bun 1.3.14 ignores a `[test] timeout` key in bunfig.toml and falls
        // back to 5s, so this flag is the only thing that sets the budget.
        '--timeout',
        String(DEFAULT_PER_TEST_TIMEOUT_MS),
        '--preload',
        PRELOAD,
        file,
      ],
      {
        cwd: WORKSPACE_ROOT,
        stdio: 'inherit',
        env: process.env,
      },
    );

    // Set by the timer so the exit handler can report the real reason. The
    // result is only produced once the process has actually been reaped:
    // `kill()` only sends a signal and returns, so resolving from the timer
    // would free the worker slot while the killed process was still running,
    // letting the pool exceed its concurrency cap exactly when the machine is
    // already struggling. This mattered less under the old fixed batches; with
    // a worker pool the freed slot is filled immediately.
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, PER_FILE_TIMEOUT_MS);

    child.on('exit', (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        file,
        passed: !killedByTimeout && code === 0,
        exitCode: killedByTimeout ? null : code,
        timedOut: killedByTimeout,
        signal: killedByTimeout ? null : (signal ?? null),
      });
    });

    child.on('error', (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      console.error(`Error spawning test for ${file}: ${err.message}`);
      resolve({
        file,
        passed: false,
        exitCode: -1,
        timedOut: false,
        signal: null,
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

export function formatFailureReason(result: TestResult): string {
  if (result.timedOut) {
    return `Timed out after ${PER_FILE_TIMEOUT_MS / 1000}s`;
  }
  if (result.signal !== null) {
    return `Killed by signal ${result.signal}`;
  }
  return `Exit code ${result.exitCode ?? -1}`;
}

export function generateJUnit(
  results: TestResult[],
  totalFiles: number,
  failedCount: number,
): string {
  const newlines = '\n';
  const testCases = results
    .map((r) => {
      const className = escapeXml(
        r.file.replace(/^src\//, '').replace(/\.(test|spec)\.tsx?$/, ''),
      );
      const failureXml = r.passed
        ? ''
        : `<failure message="${formatFailureReason(r)}">FAILED</failure>`;
      const timeAttr = r.passed ? '' : ' time="0"';
      return `    <testcase classname="${className}" name="${className}"${timeAttr}>${failureXml}</testcase>`;
    })
    .join(newlines);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totalFiles}" failures="${failedCount}">`,
    `  <testsuite name="auth" tests="${totalFiles}" failures="${failedCount}">`,
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

  // A worker pool rather than fixed batches: a batch only advances when its
  // slowest file finishes, so one slow file leaves CONCURRENCY - 1 slots idle
  // exactly when the machine has work queued behind it.
  const results: TestResult[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < testFiles.length) {
      const file = testFiles[nextIndex++];
      results.push(await runTestFile(file));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, testFiles.length) }, worker),
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  for (const result of failed) {
    console.error(`FAILED: ${result.file} (${formatFailureReason(result)})`);
  }

  console.log(
    `Passed ${passed}/${testFiles.length} test files` +
      (failed.length > 0 ? ` (${failed.length} failed)` : ''),
  );

  writeFileSync(
    JUNIT_PATH,
    generateJUnit(results, testFiles.length, failed.length),
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
