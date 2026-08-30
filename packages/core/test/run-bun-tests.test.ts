/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  generateJUnit,
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
  readonly exitCode: number | null;
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
      { passed: false, timedOut: true, reapFailed: false, exitCode: null },
      { passed: true, timedOut: false, reapFailed: false, exitCode: 0 },
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
      },
      attemptCount: 2,
      logs: ['RETRY (2/2): src/retry.test.ts after per-file timeout'],
    });
  });

  it('returns the second timeout as the final failure', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: true, reapFailed: false, exitCode: null },
      { passed: false, timedOut: true, reapFailed: false, exitCode: null },
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
      },
      attemptCount: 2,
    });
  });

  it('returns a non-timeout failure without a second attempt', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: false, reapFailed: false, exitCode: 1 },
      { passed: true, timedOut: false, reapFailed: false, exitCode: 0 },
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
      },
      attemptCount: 1,
      logs: [],
    });
  });

  it('returns a timed-out attempt that failed to reap without retrying', async () => {
    // The old process tree may still hold the file's resources; only the
    // FATAL reap guard in main() may decide what happens next.
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: true, reapFailed: true, exitCode: null },
      { passed: true, timedOut: false, reapFailed: false, exitCode: 0 },
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
        reapFailed: true,
        exitCode: null,
      },
      attemptCount: 1,
      logs: [],
    });
  });
});
