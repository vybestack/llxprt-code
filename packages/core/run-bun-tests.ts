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
 * Each child process has a per-file timeout (default 60s). If a file's
 * tests take longer, the process is killed to prevent a single slow/hanging
 * file from blocking the entire suite.
 *
 * Exit code is 0 if all files pass, 1 if any file fails.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { availableParallelism } from 'node:os';

const PRELOAD = './bun-preload.ts';
const CONCURRENCY = Math.min(8, availableParallelism());
const PER_FILE_TIMEOUT_MS = 60_000;

// Test files excluded from Bun native execution because they depend on
// vitest-only APIs (@fast-check/vitest's it.prop/itProp, process.platform
// assertions). They run under vitest via `npm run test:vitest` instead.
const EXCLUDE: ReadonlySet<string> = new Set([
  'src/recording/SessionRecordingService.test.ts',
  'src/recording/resumeSession.test.ts',
  'src/recording/sessionCleanupUtils.test.ts',
  'src/recording/sessionManagement.test.ts',
  'src/hooks/hookRunner.consoleIsolation.test.ts',
  'src/utils/retry.quota.test.ts',
]);

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === 'dist' || entry === 'node_modules' || entry === 'coverage') {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (
      (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !EXCLUDE.has(fullPath.split(sep).join('/'))
    ) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

interface TestResult {
  file: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(
      process.execPath,
      ['test', '--preload', PRELOAD, file],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      },
    );

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill('SIGKILL');
      resolve({ file, passed: false, exitCode: null, timedOut: true });
    }, PER_FILE_TIMEOUT_MS);

    child.on('exit', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({ file, passed: code === 0, exitCode: code, timedOut: false });
    });

    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({ file, passed: false, exitCode: -1, timedOut: false });
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

function generateJUnit(
  results: TestResult[],
  totalFiles: number,
  failedCount: number,
): string {
  const newlines = '\n';
  const testCases = results
    .map((r) => {
      const className = escapeXml(
        r.file.replace(/^src\//, '').replace(/\.test\.tsx?$/, ''),
      );
      const exitCode = r.exitCode ?? -1;
      const failureXml = r.passed
        ? ''
        : r.timedOut
          ? `<failure message="Timed out after ${PER_FILE_TIMEOUT_MS / 1000}s">TIMEOUT</failure>`
          : `<failure message="Exit code ${exitCode}">FAILED</failure>`;
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
  const testFiles = [...findTestFiles('src'), ...findTestFiles('test')];
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
    const batchResults = await Promise.all(batch.map(runTestFile));
    results.push(...batchResults);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  for (const result of failed) {
    if (result.timedOut) {
      console.error(
        `TIMEOUT: ${result.file} (exceeded ${PER_FILE_TIMEOUT_MS / 1000}s)`,
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

  writeFileSync(
    'junit.xml',
    generateJUnit(results, testFiles.length, failed.length),
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
