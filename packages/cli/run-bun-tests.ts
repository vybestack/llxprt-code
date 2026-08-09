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
import { readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  DEFAULT_PER_FILE_TIMEOUT_MS,
  DEFAULT_PER_TEST_TIMEOUT_MS,
  resolveTestConcurrency,
} from '../../scripts/lib/bun-test-policy.js';

process.env.LLXPRT_RUNNING_TESTS = 'true';

const PER_FILE_TIMEOUT_MS = DEFAULT_PER_FILE_TIMEOUT_MS;
const PER_INTEGRATION_FILE_TIMEOUT_MS = 900_000;
/**
 * Per-test timeout. Bun defaults to 5s, which the tests that spawn the real
 * CLI exceed once the suite runs with concurrency. Passed as a flag because
 * the bunfig.toml key is not picked up for a single-file invocation.
 *
 * Raised from 30s to the shared budget for issue #3139: this workspace was the
 * worst-failing CI shard (5/15 first attempts) because it combined the tight
 * bound with a pool that saturated every core.
 */
const PER_TEST_TIMEOUT_MS = DEFAULT_PER_TEST_TIMEOUT_MS;

/**
 * Integration tests spawn the built CLI, which cold-starts from TypeScript
 * source and is far slower than an in-process test — especially on a loaded CI
 * runner. They get a larger per-test budget so a slow boot is not reported as a
 * failure.
 *
 * Expressed as a multiple of the shared budget rather than a fixed 120s: once
 * the unit budget rose to 180s for issue #3139 a fixed value silently became
 * the *smaller* of the two, which would have given the slowest tests in the
 * workspace the tightest bound. It stays well inside
 * PER_INTEGRATION_FILE_TIMEOUT_MS, which remains the hang backstop.
 */
const PER_INTEGRATION_TEST_TIMEOUT_MS = DEFAULT_PER_TEST_TIMEOUT_MS * 2;

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
  return file.startsWith('./') || file.startsWith('/') ? file : `./${file}`;
}

export function timeoutForFile(file: string): number {
  return INTEGRATION_FILE_PATTERN.test(file)
    ? PER_INTEGRATION_TEST_TIMEOUT_MS
    : PER_TEST_TIMEOUT_MS;
}

/**
 * Whole-file budget. An integration file runs many cases that each spawn the
 * CLI, and on CI a single spawn costs roughly ten seconds against well under a
 * second locally — so a file that finishes in seconds on a developer machine
 * needs minutes there. The budget is a hang guard, so it is sized to admit a
 * slow-but-progressing file rather than to bound total runtime.
 */
export function fileTimeoutForFile(file: string): number {
  return INTEGRATION_FILE_PATTERN.test(file)
    ? PER_INTEGRATION_FILE_TIMEOUT_MS
    : PER_FILE_TIMEOUT_MS;
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

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const child = spawn(
      process.execPath,
      ['test', '--timeout', String(timeoutForFile(file)), toPathArgument(file)],
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

    // Set by the timer so the exit handler can report the real reason. The
    // result is only produced once the process has actually exited: killing a
    // tree only signals it, so resolving from the timer would free this worker
    // slot while the tree was still winding down. The pool would then exceed
    // its concurrency cap exactly when the machine is already struggling —
    // which is how a timeout on one file turns into timeouts on others.
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      killProcessTree(child);
    }, fileTimeoutForFile(file));

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        passed: !killedByTimeout && code === 0,
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
 *
 * On Windows there is no process group to signal, so the fallback kills only
 * the direct child and grandchildren can survive the timeout. The suite runs
 * on Linux in CI, so this is a documented limitation rather than a silent one.
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
/**
 * Removes CSI escape sequences so summary parsing does not depend on whether
 * the runner decided to emit colour.
 */
export function stripAnsi(value: string): string {
  // Built from a char code rather than written as a regex literal: an escape
  // character in a literal trips no-control-regex, and suppressing a lint rule
  // is not an acceptable way to pass it.
  const csi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
  return value.replace(csi, '');
}

export function parseCaseCounts(output: string): {
  pass: number;
  fail: number;
  skip: number;
  todo: number;
} {
  // Bun disables colour when stdout is a pipe, but FORCE_COLOR (or a future
  // default) would wrap these summary lines in escape sequences and every
  // count would silently read zero — the worst outcome for a parity check.
  const plain = stripAnsi(output);
  const read = (label: string): number => {
    const pattern = ['^[ \\t]*(\\d+)[ \\t]+', label, '[ \\t]*$'].join('');
    const match = plain.match(new RegExp(pattern, 'm'));
    return match ? Number.parseInt(match[1], 10) : 0;
  };
  return {
    pass: read('pass'),
    fail: read('fail'),
    skip: read('skip'),
    todo: read('todo'),
  };
}

/**
 * React's "not wrapped in act(...)" warning is a fixed ~10-line block that can
 * repeat dozens of times in a single React/Ink test file. A naive tail of the
 * output is then entirely warning text, and the assertion failures that
 * actually failed the file are unrecoverable from the log. This collapses each
 * warning block to a one-line count before taking the excerpt, so the failures
 * stay visible within the budget. (issue #3149)
 */
const ACT_WARNING_START =
  /^An update to .* inside a test was not wrapped in act\(\.\.\.\)/;
const ACT_WARNING_END =
  /Learn more at https:\/\/react\.dev\/link\/wrap-tests-with-act/;
const NEWLINE = String.fromCharCode(10);

function collapseActWarnings(output: string): {
  body: string;
  elidedWarnings: number;
} {
  const kept: string[] = [];
  let elided = 0;
  let skipping = false;
  // Cap lines consumed after a warning start whose end marker never arrives
  // (truncated at the source). The standard block is ~10 lines.
  let skipLineCount = 0;
  const MAX_WARNING_BODY_LINES = 15;
  for (const line of output.split(NEWLINE)) {
    if (!skipping) {
      if (ACT_WARNING_START.test(line)) {
        elided += 1;
        skipLineCount = 1;
        skipping = !ACT_WARNING_END.test(line);
      } else {
        kept.push(line);
      }
    } else {
      skipLineCount++;
      if (ACT_WARNING_END.test(line)) {
        skipping = false;
      } else if (ACT_WARNING_START.test(line)) {
        elided += 1;
        skipLineCount = 1;
        skipping = !ACT_WARNING_END.test(line);
      } else if (skipLineCount > MAX_WARNING_BODY_LINES) {
        skipping = false;
        kept.push(line);
      }
    }
  }
  return { body: kept.join(NEWLINE), elidedWarnings: elided };
}

/**
 * Keeps an initial run and a final run of `text` so both the first failures
 * and the trailing summary stay visible when the content exceeds the budget.
 */
function headTail(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const marker = `
[... output elided ...]
`;
  const budget = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  // Guard tail === 0: String.prototype.slice(-0) returns the whole string.
  const tailSlice = tail > 0 ? text.slice(-tail) : '';
  return `${text.slice(0, head)}${marker}${tailSlice}`;
}

/**
 * Returns a bounded excerpt of a failing file's output that keeps assertion
 * failures visible even when repetitive diagnostic noise would otherwise crowd
 * them out of a fixed-size slice.
 */
export function failureExcerpt(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output;
  }
  const { body, elidedWarnings } = collapseActWarnings(output);
  const banner =
    elidedWarnings > 0
      ? `[${elidedWarnings} React "not wrapped in act(...)" warning block(s) elided]
`
      : '';
  const excerpt = headTail(body, maxChars - banner.length);
  return (banner + excerpt).slice(0, maxChars);
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
              fileTimeoutForFile(result.file) / 1000
            }s">TIMEOUT</failure>`
          : `<failure message="Exit code ${
              result.exitCode ?? -1
            }">${escapeXml(failureExcerpt(stripAnsi(result.output), 4000))}</failure>`;
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

export function exitCodeForRun(
  failedTestFileCount: number,
  junitWriteFailed: boolean,
): 0 | 1 {
  return failedTestFileCount > 0 || junitWriteFailed ? 1 : 0;
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
  process.exit(exitCodeForRun(failed.length, junitWriteFailed));
}

if (import.meta.main) {
  await main();
}
