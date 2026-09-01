/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  generateJUnit,
  JUNIT_SCAN_CHUNK_BYTES,
  junitReportContainsPerTestTimeout,
  killChildTreeAndWait,
  observeChildClose,
  runTestFile,
  runTestFileWithTimeoutRetry,
  type TestResult,
} from '../run-bun-tests.js';

const tempDirs: string[] = [];
const processIds = new Set<number>();

function requirePositivePid(value: string, description: string): number {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid ${description}: ${JSON.stringify(value)}`);
  }
  return pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeJunitReport(
  reportName: string,
  lines: readonly string[],
): string {
  const dir = mkdtempSync(join(import.meta.dir, 'runner-junit-report-'));
  tempDirs.push(dir);
  const reportPath = join(dir, reportName);
  writeFileSync(reportPath, lines.join('\n'));
  return reportPath;
}

async function settleWithin<T>(
  promise: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`promise did not settle within ${deadlineMs}ms`)),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

// The runner creates its attempt directory under os.tmpdir(), so redirecting
// TMPDIR to a suite-owned root makes that directory discoverable and lockable
// without racing sibling sessions that share the real tmpdir.
function isolateRunnerAttemptRoot(): { root: string; restore: () => void } {
  const root = mkdtempSync(join(import.meta.dir, 'runner-attempt-root-'));
  tempDirs.push(root);
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = root;
  return {
    root,
    restore: () => {
      if (previousTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = previousTmpdir;
      }
    },
  };
}

async function awaitRunnerAttemptDir(root: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const attempt = readdirSync(root).find((entry) =>
      entry.startsWith('llxprt-runner-junit-'),
    );
    if (attempt !== undefined) {
      return join(root, attempt);
    }
    if (Date.now() > deadline) {
      throw new Error('runner attempt directory never appeared');
    }
    await Bun.sleep(10);
  }
}

// POSIX: removing an entry requires write permission on its containing
// directory, so a read-only directory with a file inside cannot be removed.
function lockAttemptDirForRemoval(attemptDir: string): void {
  writeFileSync(join(attemptDir, 'parent-lock.txt'), 'locked');
  chmodSync(attemptDir, 0o555);
}

afterEach(async () => {
  const cleanupErrors: Error[] = [];
  for (const pid of processIds) {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (isProcessAlive(pid)) {
          cleanupErrors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }
  }
  await Promise.all(
    Array.from(processIds, async (pid) => {
      const deadline = Date.now() + 5000;
      while (isProcessAlive(pid) && Date.now() < deadline) {
        await Bun.sleep(25);
      }
      if (isProcessAlive(pid)) {
        cleanupErrors.push(
          new Error(`Timed-out runner fixture pid ${pid} survived cleanup`),
        );
      }
    }),
  );
  processIds.clear();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Runner fixture cleanup failed');
  }
});

describe('core Bun test runner process lifecycle', () => {
  it('observes close separately when a descendant retains the parent pipe', async () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-close-fixture-'));
    tempDirs.push(dir);
    const descendantPidFile = join(dir, 'descendant.pid');
    const descendantScript = [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(descendantPidFile)}, String(process.pid));`,
      'await Bun.sleep(350);',
    ].join('\n');
    const parentScript = [
      `Bun.spawn([process.execPath, '-e', ${JSON.stringify(descendantScript)}], {`,
      "  stdout: 'inherit',",
      "  stderr: 'inherit',",
      '});',
      `while (!(await Bun.file(${JSON.stringify(descendantPidFile)}).exists())) {`,
      '  await Bun.sleep(5);',
      '}',
    ].join('\n');
    const child = spawn(process.execPath, ['-e', parentScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) {
      processIds.add(child.pid);
    }
    const childClosed = observeChildClose(child);
    let closeObserved = false;
    void childClosed.then(() => {
      closeObserved = true;
    });

    await once(child, 'exit');
    const descendantPidDeadline = Date.now() + 5000;
    while (
      !existsSync(descendantPidFile) &&
      Date.now() < descendantPidDeadline
    ) {
      await Bun.sleep(25);
    }
    const descendantPid = requirePositivePid(
      readFileSync(descendantPidFile, 'utf8'),
      'runner descendant pid',
    );
    processIds.add(descendantPid);
    expect(closeObserved).toBe(false);
    await childClosed;
    expect(closeObserved).toBe(true);
    if (child.pid !== undefined) {
      processIds.delete(child.pid);
    }
    processIds.delete(descendantPid);
  });

  it('does not resolve a timed-out file until its Bun process has closed', async () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-fixture-'));
    tempDirs.push(dir);
    const pidFile = join(dir, 'pid.txt');
    const fixture = join(dir, 'hang.test.ts');
    writeFileSync(
      fixture,
      [
        "import { it } from 'bun:test';",
        "import { writeFileSync } from 'node:fs';",
        `it('hangs', async () => {`,
        `  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        '  await new Promise(() => undefined);',
        '});',
      ].join('\n'),
    );

    const resultPromise = runTestFile(fixture, {
      timeoutMs: 1500,
      reapTimeoutMs: 5000,
      taskkillTimeoutMs: 5000,
    });
    const pidDeadline = Date.now() + 5000;
    while (!existsSync(pidFile) && Date.now() < pidDeadline) {
      await Bun.sleep(25);
    }
    if (!existsSync(pidFile)) {
      await resultPromise;
      throw new Error('Timed-out runner fixture did not publish its pid');
    }
    const pid = requirePositivePid(
      readFileSync(pidFile, 'utf8'),
      'timed-out runner pid',
    );
    processIds.add(pid);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.timeoutMs).toBe(1500);
    expect(result.reapFailed).toBe(false);
    expect(result.reapError).toBeNull();
    expect(isProcessAlive(pid)).toBe(false);
  }, 15_000);

  it('reports only test files represented in an early-abort JUnit result', () => {
    const results: TestResult[] = [
      {
        file: 'src/first.test.ts',
        passed: false,
        exitCode: null,
        timedOut: true,
        timeoutMs: 3000,
        reapFailed: true,
        reapError: 'child did not close',
      },
    ];

    const junit = generateJUnit(results);

    expect(junit).toContain('<testsuites tests="1" failures="1">');
    expect(junit).toContain('<testsuite name="core" tests="1" failures="1">');
    expect(junit.match(/<testcase /g)).toHaveLength(1);
  });

  it('reports the effective per-file timeout in JUnit', () => {
    const results: TestResult[] = [
      {
        file: 'src/custom-timeout.test.ts',
        passed: false,
        exitCode: null,
        timedOut: true,
        timeoutMs: 3000,
        reapFailed: false,
        reapError: null,
      },
    ];

    expect(generateJUnit(results)).toContain('Timed out after 3s');
  });

  it('reports a per-test timeout with an accurate nonnumeric JUnit label', () => {
    const results: TestResult[] = [
      {
        file: 'src/per-test-timeout.test.ts',
        passed: false,
        exitCode: 1,
        timedOut: true,
        timeoutMs: null,
        reapFailed: false,
        reapError: null,
      },
    ];

    const junit = generateJUnit(results);

    expect(junit).toContain('Timed out: per-test timeout');
    expect(junit).not.toMatch(/Timed out after \d/);
  });

  // taskkill reports a nonzero code for a pid it cannot find, which is the
  // normal outcome when the tree exits between the timeout firing and the
  // reap running. That is the Windows analogue of POSIX ESRCH: the invariant
  // the reap exists to establish — nothing left alive holding the pipes — is
  // already satisfied, so it must succeed rather than abort the whole run.
  it.skipIf(process.platform !== 'win32')(
    'treats an already-exited Windows root process as successfully reaped',
    async () => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        stdio: 'ignore',
      });
      const childClosed = observeChildClose(child);
      await childClosed;

      await expect(
        killChildTreeAndWait(child, childClosed, {
          reapTimeoutMs: 5000,
          taskkillTimeoutMs: 5000,
        }),
      ).resolves.toBeUndefined();
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'reaps the process group after the direct child exits',
    async () => {
      const dir = mkdtempSync(
        join(import.meta.dir, 'runner-tree-reap-fixture-'),
      );
      tempDirs.push(dir);
      const parentPidFile = join(dir, 'parent.pid');
      const descendantPidFile = join(dir, 'descendant.pid');
      const descendantScript = [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(descendantPidFile)}, String(process.pid));`,
        'await new Promise(() => undefined);',
      ].join('\n');
      const parentScript = [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid));`,
        `const descendant = Bun.spawn([process.execPath, '-e', ${JSON.stringify(descendantScript)}], {`,
        "  stdout: 'ignore',",
        "  stderr: 'ignore',",
        '});',
        'descendant.unref();',
        `while (!(await Bun.file(${JSON.stringify(descendantPidFile)}).exists())) {`,
        '  await Bun.sleep(5);',
        '}',
      ].join('\n');
      const child = spawn(process.execPath, ['-e', parentScript], {
        detached: true,
        stdio: 'ignore',
      });
      const childClosed = observeChildClose(child);
      const parentPid = child.pid;
      if (parentPid === undefined) {
        throw new Error('Tree-reap fixture did not receive a parent pid');
      }
      processIds.add(parentPid);

      const descendantDeadline = Date.now() + 8000;
      while (
        !existsSync(descendantPidFile) &&
        Date.now() < descendantDeadline
      ) {
        await Bun.sleep(25);
      }
      if (!existsSync(descendantPidFile)) {
        await childClosed;
        throw new Error(
          'Tree-reap fixture did not publish its descendant pid within 8s',
        );
      }
      const descendantPid = requirePositivePid(
        readFileSync(descendantPidFile, 'utf8'),
        'tree-reap descendant pid',
      );
      processIds.add(descendantPid);

      await childClosed;
      expect(isProcessAlive(parentPid)).toBe(false);
      expect(isProcessAlive(descendantPid)).toBe(true);

      await killChildTreeAndWait(child, childClosed, { reapTimeoutMs: 8000 });
      const reapedDeadline = Date.now() + 5000;
      while (isProcessAlive(descendantPid) && Date.now() < reapedDeadline) {
        await Bun.sleep(25);
      }

      expect(isProcessAlive(descendantPid)).toBe(false);
      processIds.delete(parentPid);
      processIds.delete(descendantPid);
    },
    30_000,
  );
});

interface RetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly reapFailed: boolean;
  readonly reapError?: string | null;
  readonly exitCode: number | null;
  readonly timeoutMs: number | null;
}

function createAttemptSequence<T extends RetryOutcome>(
  outcomes: readonly T[],
): {
  run: () => Promise<T>;
  count: () => number;
} {
  let attempts = 0;
  return {
    run: async () => {
      const outcome = outcomes[attempts];
      if (outcome === undefined) {
        throw new Error(`unexpected attempt ${attempts + 1}`);
      }
      attempts++;
      return outcome;
    },
    count: () => attempts,
  };
}

describe('runTestFileWithTimeoutRetry', () => {
  it('returns a passing retry and logs it after the first attempt times out', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: null,
        timeoutMs: 3000,
      },
      {
        passed: true,
        timedOut: false,
        reapFailed: false,
        exitCode: 0,
        timeoutMs: 3000,
      },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/retry.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: {
        passed: true,
        timedOut: false,
        reapFailed: false,
        exitCode: 0,
        timeoutMs: 3000,
      },
      attemptCount: 2,
      logs: ['RETRY (2/2): src/retry.test.ts after per-file timeout'],
    });
  });

  it('logs a per-test retry message when the first attempt was a per-test timeout', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: null,
      },
      {
        passed: true,
        timedOut: false,
        reapFailed: false,
        exitCode: 0,
        timeoutMs: 3000,
      },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/per-test-retry.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: {
        passed: true,
        timedOut: false,
        reapFailed: false,
        exitCode: 0,
        timeoutMs: 3000,
      },
      attemptCount: 2,
      logs: ['RETRY (2/2): src/per-test-retry.test.ts after per-test timeout'],
    });
  });

  it('returns the second timeout as the final failure', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: null,
        timeoutMs: 3000,
      },
      {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: null,
        timeoutMs: 3000,
      },
    ]);

    const result = await runTestFileWithTimeoutRetry(
      'src/retry.test.ts',
      attempts.run,
      () => undefined,
    );

    expect({ result, attemptCount: attempts.count() }).toEqual({
      result: {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: null,
        timeoutMs: 3000,
      },
      attemptCount: 2,
    });
  });

  it('returns the retry assertion failure without a stale timeout classification', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: 3000,
      },
      {
        passed: false,
        timedOut: false,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: 3000,
      },
    ]);

    const result = await runTestFileWithTimeoutRetry(
      'src/timeout-then-assert.test.ts',
      attempts.run,
      () => undefined,
    );

    expect({ result, attemptCount: attempts.count() }).toEqual({
      result: {
        passed: false,
        timedOut: false,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: 3000,
      },
      attemptCount: 2,
    });
  });

  it('returns a non-timeout failure without a second attempt', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: false,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: 3000,
      },
      {
        passed: true,
        timedOut: false,
        reapFailed: false,
        exitCode: 0,
        timeoutMs: 3000,
      },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/assertion.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: {
        passed: false,
        timedOut: false,
        reapFailed: false,
        exitCode: 1,
        timeoutMs: 3000,
      },
      attemptCount: 1,
      logs: [],
    });
  });

  it('retries after a reap failure and keeps the file failed when the retry reaps cleanly', async () => {
    // The exact issue #3439 core-shard scenario: attempt 1 times out and
    // taskkill loses the race, attempt 2 passes with a clean reap. The file
    // stays red (it did time out) and carries the first attempt's reap
    // error, but the returned reapFailed=false lets main() continue the
    // shard instead of FATAL-aborting.
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: true,
        reapError: 'taskkill reported failure and tree did not close',
        exitCode: null,
        timeoutMs: 3000,
      },
      {
        passed: true,
        timedOut: false,
        reapFailed: false,
        reapError: null,
        exitCode: 0,
        timeoutMs: 3000,
      },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/reap.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: {
        passed: false,
        timedOut: true,
        reapFailed: false,
        reapError: 'taskkill reported failure and tree did not close',
        exitCode: 0,
        timeoutMs: 3000,
      },
      attemptCount: 2,
      logs: ['RETRY (2/2): src/reap.test.ts after per-file timeout'],
    });
  });

  it('returns the second attempt when both attempts fail to reap, so main() aborts', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      {
        passed: false,
        timedOut: true,
        reapFailed: true,
        reapError: 'first attempt reap error',
        exitCode: null,
        timeoutMs: 3000,
      },
      {
        passed: false,
        timedOut: true,
        reapFailed: true,
        reapError: 'second attempt reap error',
        exitCode: null,
        timeoutMs: 3000,
      },
    ]);

    const result = await runTestFileWithTimeoutRetry(
      'src/reap.test.ts',
      attempts.run,
      () => undefined,
    );

    expect({ result, attemptCount: attempts.count() }).toEqual({
      result: {
        passed: false,
        timedOut: true,
        reapFailed: true,
        reapError: 'second attempt reap error',
        exitCode: null,
        timeoutMs: 3000,
      },
      attemptCount: 2,
    });
  });
});
describe('junitReportContainsPerTestTimeout', () => {
  // Fixture bodies below are exact Bun 1.3.14 `--reporter=junit` output
  // captured from a hanging test with a per-test timeout, an assertion
  // failure, and a passing file (tmp/issue3472/probe/junit-*.xml).
  it('classifies a per-test timeout from Bun junit reporter output', () => {
    const reportPath = writeJunitReport('junit-timeout.xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="bun test" tests="1" failures="1" skipped="0">',
      '  <testsuite name="hang.test.ts" file="hang.test.ts" tests="1" failures="1" skipped="0">',
      '    <testcase name="hangs" classname="" time="0.303" file="hang.test.ts" line="2" assertions="0">',
      '      <failure type="TimeoutError" />',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ]);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(true);
  });

  it('does not classify an assertion failure as a per-test timeout', () => {
    const reportPath = writeJunitReport('junit-assertion.xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="bun test" tests="1" failures="1" skipped="0">',
      '  <testsuite name="fail.test.ts" file="fail.test.ts" tests="1" failures="1" skipped="0">',
      '    <testcase name="fails" classname="" time="0.0001" file="fail.test.ts" line="2" assertions="1">',
      '      <failure type="AssertionError" />',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ]);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
  });

  it('does not classify a passing file as a per-test timeout', () => {
    const reportPath = writeJunitReport('junit-pass.xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="bun test" tests="1" failures="0" skipped="0">',
      '  <testsuite name="pass.test.ts" file="pass.test.ts" tests="1" failures="0" skipped="0">',
      '    <testcase name="passes" classname="" time="0.00001" file="pass.test.ts" line="2" assertions="0" />',
      '  </testsuite>',
      '</testsuites>',
    ]);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
  });

  it('does not classify other error types as a per-test timeout', () => {
    const reportPath = writeJunitReport('junit-error.xml', [
      '    <testcase name="throws" classname="" time="0.1" file="t.test.ts" line="2" assertions="0">',
      '      <failure type="Error" message="boom" />',
      '    </testcase>',
    ]);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
  });

  it('does not classify a reordered failure element as a per-test timeout', () => {
    const reportPath = writeJunitReport('junit-reordered.xml', [
      '    <testcase name="hangs" classname="" time="0.3" file="t.test.ts" line="2" assertions="0">',
      '      <failure message="timed out" type="TimeoutError" />',
      '    </testcase>',
    ]);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
  });

  it('returns false for empty reporter output', () => {
    const reportPath = writeJunitReport('junit-empty.xml', []);

    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
  });

  it('returns false when no report file exists', () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-junit-absent-'));
    tempDirs.push(dir);

    expect(junitReportContainsPerTestTimeout(join(dir, 'junit.xml'))).toBe(
      false,
    );
  });

  it('detects the timeout marker split across read chunk boundaries', () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-junit-split-'));
    tempDirs.push(dir);
    const openTag = '<testsuites>';
    const timeoutFailure = '<failure type="TimeoutError" />';
    const assertionFailure = '<failure type="AssertionError" />';
    for (let split = 0; split <= timeoutFailure.length; split++) {
      const prefix = `${openTag}${'a'.repeat(JUNIT_SCAN_CHUNK_BYTES - split - openTag.length)}`;
      const timeoutPath = join(dir, `junit-timeout-split-${split}.xml`);
      writeFileSync(timeoutPath, `${prefix}${timeoutFailure}</testsuites>`);
      const assertionPath = join(dir, `junit-assertion-split-${split}.xml`);
      writeFileSync(assertionPath, `${prefix}${assertionFailure}</testsuites>`);

      expect(junitReportContainsPerTestTimeout(timeoutPath)).toBe(true);
      expect(junitReportContainsPerTestTimeout(assertionPath)).toBe(false);
    }
  });

  it('scans a multi-chunk report without reading the whole file into memory', () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-junit-large-'));
    tempDirs.push(dir);
    const reportPath = join(dir, 'junit.xml');
    const filler = Buffer.alloc(1024 * 1024, 0x61);
    const writeDescriptor = openSync(reportPath, 'w');
    try {
      for (let megabytes = 0; megabytes < 128; megabytes++) {
        writeSync(writeDescriptor, filler);
      }
    } finally {
      closeSync(writeDescriptor);
    }

    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(false);
    const rssAfterFullScan = process.memoryUsage().rss;

    const appendDescriptor = openSync(reportPath, 'a');
    try {
      writeSync(appendDescriptor, '<failure type="TimeoutError" />');
    } finally {
      closeSync(appendDescriptor);
    }
    expect(junitReportContainsPerTestTimeout(reportPath)).toBe(true);
    const rssAfterMarkerScan = process.memoryUsage().rss;

    expect(rssAfterFullScan - rssBefore).toBeLessThan(96 * 1024 * 1024);
    expect(rssAfterMarkerScan - rssBefore).toBeLessThan(96 * 1024 * 1024);
  }, 60_000);
});

describe('runTestFile: per-test timeout classification (AC3)', () => {
  it('classifies a Bun per-test timeout that exits 1 as timedOut', async () => {
    const dir = mkdtempSync(
      join(import.meta.dir, 'runner-per-test-timeout-fixture-'),
    );
    tempDirs.push(dir);
    const fixture = join(dir, 'hang.test.ts');
    writeFileSync(
      fixture,
      [
        "import { it } from 'bun:test';",
        "it('hangs', async () => {",
        '  await new Promise(() => undefined);',
        '}, 300);',
      ].join('\n'),
    );

    const result = await runTestFile(fixture, {
      timeoutMs: 30_000,
      reapTimeoutMs: 5000,
      taskkillTimeoutMs: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(true);
    expect(result.timeoutMs).toBeNull();
    expect(result.reapFailed).toBe(false);
    expect(result.reapError).toBeNull();
  }, 30_000);

  it('classifies an ordinary assertion failure that exits 1 as not timedOut', async () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-assert-fixture-'));
    tempDirs.push(dir);
    const fixture = join(dir, 'fail.test.ts');
    writeFileSync(
      fixture,
      [
        "import { it, expect } from 'bun:test';",
        "it('fails', () => {",
        '  expect(1).toBe(2);',
        '});',
      ].join('\n'),
    );

    const result = await runTestFile(fixture, {
      timeoutMs: 30_000,
      reapTimeoutMs: 5000,
      taskkillTimeoutMs: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.timeoutMs).toBe(30_000);
    expect(result.reapFailed).toBe(false);
    expect(result.reapError).toBeNull();
  }, 30_000);
});

describe('runTestFile: attempt directory cleanup', () => {
  // Real-filesystem removal failure via POSIX directory permissions: the
  // Windows analogue (a locked report handle) cannot be produced
  // deterministically off-Windows, so the injected-removal tests below cover
  // the Windows lock retry behavior on every platform.
  it.skipIf(process.platform === 'win32')(
    'settles a passing file with a fail-fast cleanup failure when real removal is exhausted',
    async () => {
      const attemptRoot = isolateRunnerAttemptRoot();
      let attemptDir: string | undefined;
      try {
        const fixture = join(attemptRoot.root, 'pass.test.ts');
        writeFileSync(
          fixture,
          ["import { it } from 'bun:test';", "it('passes', () => {});"].join(
            '\n',
          ),
        );
        const resultPromise = runTestFile(fixture, {
          timeoutMs: 30_000,
          reapTimeoutMs: 5000,
          taskkillTimeoutMs: 5000,
          cleanupAttempts: 2,
          cleanupRetryDelayMs: 1,
        });
        attemptDir = await awaitRunnerAttemptDir(attemptRoot.root);
        lockAttemptDirForRemoval(attemptDir);

        const result = await settleWithin(resultPromise, 15_000);

        expect(result.passed).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(result.reapFailed).toBe(true);
        expect(result.reapError).toContain('attempt cleanup failed');
        expect(existsSync(attemptDir)).toBe(true);
      } finally {
        if (attemptDir !== undefined && existsSync(attemptDir)) {
          chmodSync(attemptDir, 0o755);
        }
        attemptRoot.restore();
      }
    },
    30_000,
  );

  it.skipIf(process.platform === 'win32')(
    'settles a per-file timeout with a fail-fast cleanup failure when real removal is exhausted',
    async () => {
      const attemptRoot = isolateRunnerAttemptRoot();
      let attemptDir: string | undefined;
      try {
        const fixture = join(attemptRoot.root, 'hang.test.ts');
        writeFileSync(
          fixture,
          [
            "import { it } from 'bun:test';",
            "it('hangs', async () => {",
            '  await new Promise(() => undefined);',
            '});',
          ].join('\n'),
        );
        const resultPromise = runTestFile(fixture, {
          timeoutMs: 1500,
          reapTimeoutMs: 5000,
          taskkillTimeoutMs: 5000,
          cleanupAttempts: 2,
          cleanupRetryDelayMs: 1,
        });
        attemptDir = await awaitRunnerAttemptDir(attemptRoot.root);
        lockAttemptDirForRemoval(attemptDir);

        const result = await settleWithin(resultPromise, 15_000);

        expect(result.timedOut).toBe(true);
        expect(result.timeoutMs).toBe(1500);
        expect(result.reapFailed).toBe(true);
        expect(result.reapError).toContain('attempt cleanup failed');
      } finally {
        if (attemptDir !== undefined && existsSync(attemptDir)) {
          chmodSync(attemptDir, 0o755);
        }
        attemptRoot.restore();
      }
    },
    30_000,
  );

  it.skipIf(process.platform === 'win32')(
    'settles with both the reap and cleanup failures surfaced when the reap times out and removal is exhausted',
    async () => {
      const attemptRoot = isolateRunnerAttemptRoot();
      let attemptDir: string | undefined;
      let reapedPid: number | undefined;
      try {
        const fixture = join(attemptRoot.root, 'hang.test.ts');
        writeFileSync(
          fixture,
          [
            "import { it } from 'bun:test';",
            "it('hangs', async () => {",
            '  await new Promise(() => undefined);',
            '});',
          ].join('\n'),
        );
        const resultPromise = runTestFile(fixture, {
          timeoutMs: 1500,
          // The reap is injected to fail deterministically with the close
          // lifecycle timeout the real reap reports when a killed tree does
          // not close in time; racing real SIGKILL-to-close latency against
          // a 1ms timer cannot force that outcome. The child deliberately
          // stays alive, which is what a failed reap means; afterEach reaps
          // it through processIds.
          reapTimedOutChild: (child) => {
            reapedPid = child.pid;
            if (child.pid !== undefined) {
              processIds.add(child.pid);
            }
            return Promise.reject(
              new Error(
                `Timed-out child (pid ${child.pid ?? 'unknown'}) close lifecycle did not complete within 1ms`,
              ),
            );
          },
          cleanupAttempts: 2,
          cleanupRetryDelayMs: 1,
        });
        attemptDir = await awaitRunnerAttemptDir(attemptRoot.root);
        lockAttemptDirForRemoval(attemptDir);

        const result = await settleWithin(resultPromise, 15_000);

        expect(result.timedOut).toBe(true);
        expect(result.reapFailed).toBe(true);
        expect(result.reapError).toContain(
          'close lifecycle did not complete within 1ms',
        );
        expect(result.reapError).toContain('attempt cleanup failed');
        if (reapedPid === undefined) {
          throw new Error('injected reap never observed the child');
        }
        expect(isProcessAlive(reapedPid)).toBe(true);
      } finally {
        if (attemptDir !== undefined && existsSync(attemptDir)) {
          chmodSync(attemptDir, 0o755);
        }
        attemptRoot.restore();
      }
    },
    30_000,
  );

  it('recovers a transient lock failure within the bounded retry budget and stays scoped to the attempt directory', async () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-cleanup-fixture-'));
    tempDirs.push(dir);
    const fixture = join(dir, 'pass.test.ts');
    writeFileSync(
      fixture,
      ["import { it } from 'bun:test';", "it('passes', () => {});"].join('\n'),
    );
    const removals: string[] = [];

    const result = await runTestFile(fixture, {
      timeoutMs: 30_000,
      reapTimeoutMs: 5000,
      taskkillTimeoutMs: 5000,
      cleanupAttempts: 3,
      cleanupRetryDelayMs: 1,
      removeAttemptDir: (attemptDir) => {
        removals.push(attemptDir);
        if (removals.length < 2) {
          throw Object.assign(
            new Error('simulated Windows file lock (EBUSY)'),
            { code: 'EBUSY' },
          );
        }
        rmSync(attemptDir, { recursive: true, force: true });
      },
    });

    expect(removals).toHaveLength(2);
    const attemptDir = removals[0];
    expect(basename(attemptDir).startsWith('llxprt-runner-junit-')).toBe(true);
    expect(dirname(attemptDir)).toBe(tmpdir());
    expect(existsSync(attemptDir)).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.reapFailed).toBe(false);
    expect(result.reapError).toBeNull();
  }, 30_000);

  it('does not retry a non-lock removal failure and surfaces it through the fail-fast path', async () => {
    const dir = mkdtempSync(join(import.meta.dir, 'runner-cleanup-fixture-'));
    tempDirs.push(dir);
    const fixture = join(dir, 'pass.test.ts');
    writeFileSync(
      fixture,
      ["import { it } from 'bun:test';", "it('passes', () => {});"].join('\n'),
    );
    const removals: string[] = [];
    let result: TestResult | undefined;

    try {
      result = await runTestFile(fixture, {
        timeoutMs: 30_000,
        reapTimeoutMs: 5000,
        taskkillTimeoutMs: 5000,
        cleanupAttempts: 3,
        cleanupRetryDelayMs: 1,
        removeAttemptDir: (attemptDir) => {
          removals.push(attemptDir);
          throw Object.assign(
            new Error('simulated non-lock removal failure (EINVAL)'),
            { code: 'EINVAL' },
          );
        },
      });
    } finally {
      for (const attemptDir of removals) {
        rmSync(attemptDir, { recursive: true, force: true });
      }
    }

    expect(removals).toHaveLength(1);
    expect(result?.passed).toBe(true);
    expect(result?.reapFailed).toBe(true);
    expect(result?.reapError).toContain('attempt cleanup failed');
    expect(result?.reapError).toContain('simulated non-lock removal failure');
  }, 30_000);
});
