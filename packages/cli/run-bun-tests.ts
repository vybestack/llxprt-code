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

import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { availableParallelism } from 'node:os';

const PER_FILE_TIMEOUT_MS = 120_000;
/**
 * Per-test timeout, matching the testTimeout the removed vitest.config.ts set.
 * Bun defaults to 5s, which the tests that spawn the real CLI exceed once the
 * suite runs with concurrency. Passed as a flag because the bunfig.toml key is
 * not picked up for a single-file invocation.
 */
const PER_TEST_TIMEOUT_MS = 30_000;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '__snapshots__',
]);
const TEST_ROOTS = ['src', 'test', 'test-bun', 'test-utils'];
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

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

export function isTestFile(fileName: string): boolean {
  return TEST_FILE_PATTERN.test(fileName);
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
    } else if (isTestFile(entry)) {
      results.push(fullPath);
    }
  }
}

export function discoverTestFiles(root: string): string[] {
  const results: string[] = [];
  for (const testRoot of TEST_ROOTS) {
    collectTestFiles(join(root, testRoot), results);
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

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawn(
      process.execPath,
      ['test', '--timeout', String(PER_TEST_TIMEOUT_MS), file],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        // Own process group so a timeout can take down the whole tree. Tests
        // that spawn the real CLI leave grandchildren which would otherwise
        // survive the kill and hold pipes open into later files.
        detached: process.platform !== 'win32',
      },
    );

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
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

/**
 * XML 1.0 forbids most C0 control characters outright, and Bun test output
 * routinely contains ANSI escapes (U+001B). Emitting them produces a document
 * that a strict parser rejects, which matters because CI feeds this file to a
 * test reporter. Strip the disallowed code points before escaping.
 */
function stripInvalidXmlChars(value: string): string {
  // Filtered by code point rather than a regex so no control-character escape
  // appears in a pattern literal. Allowed C0 characters are tab (0x09), line
  // feed (0x0A) and carriage return (0x0D).
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
    const isForbidden = code < 0x20 || code === 0x7f;
    if (!isForbidden || isAllowedControl) {
      out += char;
    }
  }
  return out;
}

/**
 * Kills a timed-out child and anything it spawned. On POSIX the child leads its
 * own process group, so a negative PID signals the whole group; killing only
 * the direct child would strand grandchildren such as a spawned CLI.
 */
function killProcessTree(child: {
  pid?: number;
  kill: (s: NodeJS.Signals) => boolean;
}): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Group already gone, or the child never became a group leader.
    }
  }
  child.kill('SIGKILL');
}

export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Reads the per-file case tallies out of Bun's summary lines, e.g.
 * " 12 pass", " 1 fail", " 2 skip". Reported so the migration's test-count
 * parity with Vitest can be checked mechanically rather than by eye.
 */
export function parseCaseCounts(output: string): {
  pass: number;
  fail: number;
  skip: number;
  todo: number;
} {
  const read = (label: string): number => {
    const pattern = ['^[ \\t]*(\\d+)[ \\t]+', label, '[ \\t]*$'].join('');
    const match = output.match(new RegExp(pattern, 'm'));
    return match ? Number.parseInt(match[1], 10) : 0;
  };
  return {
    pass: read('pass'),
    fail: read('fail'),
    skip: read('skip'),
    todo: read('todo'),
  };
}

export function generateJUnit(results: readonly TestResult[]): string {
  const failedCount = results.filter((result) => !result.passed).length;
  const testCases = results
    .map((result) => {
      const className = escapeXml(
        result.file.replace(/\.(test|spec)\.tsx?$/, ''),
      );
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

  writeFileSync(join(root, 'junit.xml'), generateJUnit(results));
  process.exit(failed.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
