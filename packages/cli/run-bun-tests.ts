/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the CLI workspace.
 *
 * Discovers every unit test file in the workspace and runs each one in its own
 * `bun test` process with bounded parallelism. A process per file is required
 * because Bun's `mock.module` registry is process-wide (unlike Vitest's
 * per-file module graph), so sharing a process would leak mocks between files.
 *
 * Integration tests (`*.integration.test.ts`) are excluded here; they are
 * selected by `test:integration`, exactly as under the Vitest configuration.
 *
 * Exit code is 0 when every file passes and 1 when any file fails.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { availableParallelism } from 'node:os';

const PER_FILE_TIMEOUT_MS = 120_000;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '__snapshots__',
]);
const TEST_ROOTS = ['src', 'test', 'test-bun', 'test-utils'];
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;
const INTEGRATION_FILE_PATTERN = /\.integration\.(test|spec)\.(ts|tsx)$/;

function parseConcurrency(): number {
  const flagIndex = process.argv.indexOf('--concurrency');
  if (flagIndex >= 0) {
    const parsed = Number.parseInt(process.argv[flagIndex + 1] ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return Math.max(1, Math.min(8, availableParallelism()));
}

export function isUnitTestFile(fileName: string): boolean {
  return (
    TEST_FILE_PATTERN.test(fileName) && !INTEGRATION_FILE_PATTERN.test(fileName)
  );
}

function collectTestFiles(dir: string, results: string[]): void {
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
      collectTestFiles(fullPath, results);
    } else if (isUnitTestFile(entry)) {
      results.push(fullPath);
    }
  }
}

export function discoverTestFiles(root: string): string[] {
  const results: string[] = [];
  for (const testRoot of TEST_ROOTS) {
    collectTestFiles(join(root, testRoot), results);
  }
  return results.map((file) => relative(root, file).split('\\').join('/')).sort();
}

interface TestResult {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
}

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawn(process.execPath, ['test', file], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ file, passed: false, exitCode: null, timedOut: true, output });
    }, PER_FILE_TIMEOUT_MS);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        passed: code === 0,
        exitCode: code,
        timedOut: false,
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateJUnit(results: readonly TestResult[]): string {
  const failedCount = results.filter((result) => !result.passed).length;
  const testCases = results
    .map((result) => {
      const className = escapeXml(result.file.replace(/\.(test|spec)\.tsx?$/, ''));
      const failure = result.passed
        ? ''
        : result.timedOut
          ? `<failure message="Timed out after ${
              PER_FILE_TIMEOUT_MS / 1000
            }s">TIMEOUT</failure>`
          : `<failure message="Exit code ${
              result.exitCode ?? -1
            }">${escapeXml(result.output.slice(-4000))}</failure>`;
      return `    <testcase classname="${className}" name="${className}">${failure}</testcase>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${results.length}" failures="${failedCount}">`,
    `  <testsuite name="cli" tests="${results.length}" failures="${failedCount}">`,
    testCases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

async function main(): Promise<void> {
  const root = import.meta.dir;
  const testFiles = discoverTestFiles(root);
  if (testFiles.length === 0) {
    console.error('No CLI test files were discovered.');
    process.exit(1);
  }

  const concurrency = parseConcurrency();
  console.log(
    `Running ${testFiles.length} CLI test files with concurrency ${concurrency}`,
  );

  const results: TestResult[] = [];
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= testFiles.length) return;
      const result = await runTestFile(testFiles[index]);
      results.push(result);
      completed++;
      if (!result.passed) {
        console.error(
          `FAIL (${completed}/${testFiles.length}) ${result.file}${
            result.timedOut ? ' [timeout]' : ''
          }`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, testFiles.length) }, worker),
  );

  results.sort((a, b) => a.file.localeCompare(b.file));
  const failed = results.filter((result) => !result.passed);

  for (const result of failed) {
    console.error(`\n----- ${result.file} -----`);
    console.error(result.output.slice(-6000));
  }

  console.log(
    `Passed ${results.length - failed.length}/${results.length} CLI test files` +
      (failed.length > 0 ? ` (${failed.length} failed)` : ''),
  );

  writeFileSync(join(root, 'junit.xml'), generateJUnit(results));
  process.exit(failed.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
