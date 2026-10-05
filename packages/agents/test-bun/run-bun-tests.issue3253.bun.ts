/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTestFile, runTestFileWithTimeoutRetry } from '../run-bun-tests.js';
import {
  buildSessionEnv,
  createTestSessionRoot,
  removeSessionRoot,
} from '../../../scripts/lib/test-session-isolation.js';

interface RetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
}

interface AttemptSequence<T extends { readonly timedOut: boolean }> {
  readonly run: () => Promise<T>;
  readonly count: () => number;
}

function createAttemptSequence<T extends { readonly timedOut: boolean }>(
  outcomes: readonly T[],
): AttemptSequence<T> {
  let attempts = 0;
  return {
    run: async (): Promise<T> => {
      const outcome = outcomes.at(attempts);
      attempts++;
      if (outcome === undefined) {
        throw new Error('Unexpected extra test-file attempt');
      }
      return outcome;
    },
    count: () => attempts,
  };
}

async function withShortPerFileTimeout<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
  // 4s leaves headroom for child Bun startup under CI load while staying far
  // below the child's 30s sleep, so attempt 1 is killed mid-sleep, not at
  // spawn.
  process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '4000';
  try {
    return await run();
  } finally {
    if (saved === undefined) {
      delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
    } else {
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = saved;
    }
  }
}

function writeFlakyThenPassTest(dir: string): string {
  const file = join(dir, 'flakyThenPass.test.ts');
  const marker = join(dir, 'first-attempt.marker');
  writeFileSync(
    file,
    `import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';

const marker = ${JSON.stringify(marker)};

test('passes after the timed-out first attempt', async () => {
  if (!existsSync(marker)) {
    writeFileSync(marker, String(process.pid));
    await Bun.sleep(30_000);
  } else {
    expect(true).toBe(true);
  }
});
`,
  );
  return file;
}

function writeAlwaysTimesOutTest(dir: string): string {
  const file = join(dir, 'alwaysTimesOut.test.ts');
  writeFileSync(
    file,
    `import { test } from 'bun:test';

test('sleeps past the runner budget', async () => {
  await Bun.sleep(30_000);
});
`,
  );
  return file;
}

describe('runTestFileWithTimeoutRetry', () => {
  it('returns a passing retry and logs it after the first attempt times out', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: true, exitCode: null },
      { passed: true, timedOut: false, exitCode: 0 },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/retry.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: { passed: true, timedOut: false, exitCode: 0 },
      attemptCount: 2,
      logs: ['RETRY (2/2): src/retry.test.ts after per-file timeout'],
    });
  });

  it('returns the second timeout as the final failure', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: true, exitCode: null },
      { passed: false, timedOut: true, exitCode: null },
    ]);

    const result = await runTestFileWithTimeoutRetry(
      'src/retry.test.ts',
      attempts.run,
      () => undefined,
    );

    expect({ result, attemptCount: attempts.count() }).toEqual({
      result: { passed: false, timedOut: true, exitCode: null },
      attemptCount: 2,
    });
  });

  it('returns a non-timeout failure without a second attempt', async () => {
    const attempts = createAttemptSequence<RetryOutcome>([
      { passed: false, timedOut: false, exitCode: 1 },
      { passed: true, timedOut: false, exitCode: 0 },
    ]);
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/assertion.test.ts',
      attempts.run,
      (message) => logs.push(message),
    );

    expect({ result, attemptCount: attempts.count(), logs }).toEqual({
      result: { passed: false, timedOut: false, exitCode: 1 },
      attemptCount: 1,
      logs: [],
    });
  });
});

describe('real agents test-file child retries', () => {
  it('kills a timed-out child, retries the file, and keeps the passing-attempt JUnit report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-runner-retry-'));
    try {
      const file = writeFlakyThenPassTest(dir);
      const marker = join(dir, 'first-attempt.marker');
      const reportPath = join(dir, 'report.xml');
      const logs: string[] = [];

      const result = await withShortPerFileTimeout(() =>
        runTestFileWithTimeoutRetry(
          file,
          () => runTestFile(file, reportPath),
          (message) => logs.push(message),
        ),
      );
      const report = readFileSync(reportPath, 'utf8');

      expect({
        passed: result.passed,
        timedOut: result.timedOut,
        logs,
      }).toEqual({
        passed: true,
        timedOut: false,
        logs: [`RETRY (2/2): ${file} after per-file timeout`],
      });
      expect(report).toContain('tests="1"');
      expect(report).toContain('failures="0"');

      // Attempt 1 recorded its pid before being killed: prove the runner
      // actually reaped the timed-out child rather than orphaning it. On
      // Windows a freshly-reused pid can already belong to an unrelated live
      // process, so only POSIX asserts liveness.
      const firstChildPid = Number.parseInt(readFileSync(marker, 'utf8'), 10);
      expect(Number.isInteger(firstChildPid)).toBe(true);
      if (process.platform !== 'win32') {
        expect(() => process.kill(firstChildPid, 0)).toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('returns the second real timeout and leaves no stale JUnit report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-runner-timeout-'));
    try {
      const file = writeAlwaysTimesOutTest(dir);
      const reportPath = join(dir, 'report.xml');

      const result = await withShortPerFileTimeout(() =>
        runTestFileWithTimeoutRetry(
          file,
          () => runTestFile(file, reportPath),
          () => undefined,
        ),
      );

      expect({
        timedOut: result.timedOut,
        reportExists: existsSync(reportPath),
      }).toEqual({ timedOut: true, reportExists: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});

describe('external signal classification', () => {
  it.skipIf(process.platform === 'win32')(
    'retains a real SIGTERM close and does not timeout-retry it',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'agents-signal-policy-'));
      try {
        const file = join(root, 'signal.test.ts');
        const marker = join(root, 'attempts');
        writeFileSync(
          file,
          `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(marker)}, 'attempt'); process.kill(process.pid, 'SIGTERM');`,
        );
        const logs: string[] = [];
        const result = await runTestFileWithTimeoutRetry(
          file,
          () => runTestFile(file, join(root, 'junit.xml')),
          (line) => logs.push(line),
        );
        expect(result.passed).toBe(false);
        expect(result.timedOut).toBe(false);
        expect(result.signal).toBe('SIGTERM');
        expect(readFileSync(marker, 'utf8')).toBe('attempt');
        expect(logs).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe('runner timeout environment', () => {
  it('uses the runner budget rather than a supplied child override', async () => {
    const session = createTestSessionRoot();
    const root = session.root;
    const runnerHome = process.env.HOME;
    const marker = join(root, 'child-env.json');
    const childEnv = buildSessionEnv(
      { ...process.env, LLXPRT_TEST_FILE_TIMEOUT_MS: '0' },
      session,
    );
    try {
      const file = join(root, 'passes.test.ts');
      writeFileSync(
        file,
        `import { it } from 'bun:test';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ home: process.env.HOME, tmp: process.env.TMPDIR }));
it('passes', async () => { await Bun.sleep(50); });`,
      );
      const result = await withShortPerFileTimeout(() =>
        runTestFile(file, join(root, 'junit.xml'), childEnv),
      );
      expect(result.passed).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.timeoutMs).toBe(4000);
      expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
        home: session.homeDir,
        tmp: session.tmpDir,
      });
      expect(process.env.HOME).toBe(runnerHome);
      expect(readFileSync(join(root, 'junit.xml'), 'utf8')).toContain(
        'tests="1"',
      );
      rmSync(marker);
      const saved = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '0';
      try {
        expect(() =>
          runTestFile(file, join(root, 'junit.xml'), childEnv),
        ).toThrow('LLXPRT_TEST_FILE_TIMEOUT_MS');
        expect(existsSync(marker)).toBe(false);
      } finally {
        if (saved === undefined) delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
        else process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = saved;
      }
    } finally {
      removeSessionRoot(session);
    }
  });
});
