/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  spawnRun,
  spawnRunWithTimeout,
  type RunCapture,
  type RunContext,
} from './process-run.js';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import {
  clearQuotaGuard,
  getQuotaGuardTrip,
  tripQuotaGuard,
} from './quota-guard.js';

const tempDirs: string[] = [];
const SPAWN_TIMEOUT_MS = 5000;
const QUOTA_SIGNAL_TIMEOUT_MS = 2000;

/**
 * Stub a fresh, isolated guard state directory and disable both the
 * fake-responses short-circuit and CI annotations so each test exercises the
 * real guard behaviour.
 */
function activateGuard(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-run-test-guard-'));
  tempDirs.push(dir);
  setEnv('INTEGRATION_TEST_FILE_DIR', dir);
  setEnv('GITHUB_ACTIONS', 'false');
  setEnv('LLXPRT_FAKE_RESPONSES', undefined);
  setEnv('LLXPRT_QUOTA_GUARD_DISABLED', undefined);
  clearQuotaGuard();
  return dir;
}

/**
 * Like {@link activateGuard} but with the global disable switch flipped on.
 * A configured state dir proves the ONLY thing suppressing the guard is
 * `LLXPRT_QUOTA_GUARD_DISABLED=true`, so failure classification must fall back
 * to the ordinary (non-quota) error even on quota-looking output.
 */
function activateDisabledGuard(): string {
  const dir = activateGuard();
  setEnv('LLXPRT_QUOTA_GUARD_DISABLED', 'true');
  return dir;
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-run-test-'));
  tempDirs.push(dir);
  return dir;
}

function bunContext(code: string, cwd: string): RunContext {
  return {
    command: 'bun',
    commandArgs: ['-e', code],
    testDir: cwd,
  };
}

const identityTransform = (stdout: string): string => stdout;

/**
 * Narrow an unknown rejection value to an Error without a type assertion so
 * we can make behavioural assertions against its message.
 */
function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  throw new Error(
    `Expected rejection to be an Error, received: ${String(value)}`,
  );
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return asError(error);
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

describe('process run capture', () => {
  afterEach(() => {
    clearQuotaGuard();
    restoreEnv();
    const dirs = tempDirs.slice();
    tempDirs.length = 0;
    const errors: unknown[] = [];
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'Failed to clean process-run test directories',
      );
    }
  });

  it('reports separate stdout and stderr before resolving JSON output', async () => {
    let capture: RunCapture | undefined;
    const result = await spawnRun(
      bunContext(
        'process.stdout.write("hello out"); process.stderr.write("hello err");',
        makeTempDir(),
      ),
      {},
      true,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    expect(result).toBe('hello out');
    expect(capture).toStrictEqual({
      stdout: 'hello out',
      stderr: 'hello err',
      exitCode: 0,
      timedOut: false,
    });
  });

  it('preserves the existing plain-text stderr append behavior', async () => {
    const result = await spawnRun(
      bunContext('process.stderr.write("warn line");', makeTempDir()),
      {},
      false,
      identityTransform,
    );

    expect(result).toContain('warn line');
    expect(result).toMatch(/StdErr:/);
  });

  it('reports partial streams for a nonzero exit', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRun(
      bunContext(
        'process.stdout.write("partial out"); process.stderr.write("partial err"); process.exit(3);',
        makeTempDir(),
      ),
      {},
      false,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    expect((await captureRejection(run)).message).toMatch(/code 3/);
    expect(capture).toStrictEqual({
      stdout: 'partial out',
      stderr: 'partial err',
      exitCode: 3,
      timedOut: false,
    });
  });

  it.skipIf(process.platform === 'win32')(
    'captures a timed-out run that exits gracefully after SIGTERM',
    async () => {
      let capture: RunCapture | undefined;
      const run = spawnRunWithTimeout(
        bunContext(
          [
            'process.on("SIGTERM", () => {',
            '  process.stdout.write(" graceful-out");',
            '  process.stderr.write("graceful-err");',
            '  process.exit(0);',
            '});',
            'process.stdout.write("started");',
            'setInterval(() => {}, 1000);',
          ].join('\n'),
          makeTempDir(),
        ),
        {},
        false,
        identityTransform,
        SPAWN_TIMEOUT_MS,
        (value) => {
          capture = value;
        },
      );

      expect((await captureRejection(run)).message).toMatch(/timed out/);
      expect(capture).toStrictEqual({
        stdout: 'started graceful-out',
        stderr: 'graceful-err',
        exitCode: 0,
        timedOut: true,
      });
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'captures shutdown output and force-kills a run that ignores SIGTERM',
    async () => {
      let capture: RunCapture | undefined;
      const run = spawnRunWithTimeout(
        bunContext(
          [
            'process.on("SIGTERM", () => {',
            '  process.stdout.write(" shutdown-out");',
            '  process.stderr.write("shutdown-err");',
            '});',
            'process.stdout.write("started");',
            'setInterval(() => {}, 1000);',
          ].join('\n'),
          makeTempDir(),
        ),
        {},
        false,
        identityTransform,
        SPAWN_TIMEOUT_MS,
        (value) => {
          capture = value;
        },
      );

      expect((await captureRejection(run)).message).toMatch(/timed out/);
      expect(capture).toStrictEqual({
        stdout: 'started shutdown-out',
        stderr: 'shutdown-err',
        exitCode: null,
        timedOut: true,
      });
    },
    15_000,
  );

  it('preserves process and capture failures together', async () => {
    const processErrorPattern = /code 3/;
    const captureError = new Error('capture handler failed');
    const run = spawnRun(
      bunContext('process.exit(3);', makeTempDir()),
      {},
      false,
      identityTransform,
      () => {
        throw captureError;
      },
    );

    const error = await captureRejection(run);
    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect((aggregate.errors[0] as Error).message).toMatch(processErrorPattern);
    expect(aggregate.errors[1]).toBe(captureError);
  });

  it('captures and rejects child-process spawn errors', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRun(
      {
        command: join(makeTempDir(), 'missing-command'),
        commandArgs: [],
        testDir: makeTempDir(),
      },
      {},
      false,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    // The intent is "a spawn failure for a missing executable rejects". Node
    // reports this as an ENOENT errno error; Bun (used as the test runner for
    // this workspace) reports "Executable not found in $PATH: ..." instead.
    // Matching both keeps the assertion strict — it still rejects only for a
    // missing-executable spawn failure and still fails if the rejection stops
    // happening or changes to a different error class (timeout/exit code).
    expect((await captureRejection(run)).message).toMatch(
      /ENOENT|Executable not found/i,
    );
    expect(capture).toStrictEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
    });
  });

  it('rejects instead of throwing when a capture handler fails', async () => {
    const run = spawnRun(
      bunContext('process.stdout.write("captured");', makeTempDir()),
      {},
      true,
      identityTransform,
      () => {
        throw new Error('capture handler failed');
      },
    );

    expect((await captureRejection(run)).message).toMatch(
      /capture handler failed/,
    );
  });

  it('isolates capture handler failures in timeout-managed runs', async () => {
    const run = spawnRunWithTimeout(
      bunContext('process.stdout.write("captured");', makeTempDir()),
      {},
      true,
      identityTransform,
      SPAWN_TIMEOUT_MS * 4,
      () => {
        throw new Error('timeout capture handler failed');
      },
    );

    expect((await captureRejection(run)).message).toMatch(
      /timeout capture handler failed/,
    );
  });

  it('keeps concurrent run captures isolated by callback', async () => {
    let firstCapture: RunCapture | undefined;
    let secondCapture: RunCapture | undefined;

    await Promise.all([
      spawnRun(
        bunContext('process.stdout.write("first");', makeTempDir()),
        {},
        true,
        identityTransform,
        (value) => {
          firstCapture = value;
        },
      ),
      spawnRun(
        bunContext('process.stdout.write("second");', makeTempDir()),
        {},
        true,
        identityTransform,
        (value) => {
          secondCapture = value;
        },
      ),
    ]);

    expect(firstCapture?.stdout).toBe('first');
    expect(secondCapture?.stdout).toBe('second');
  });
});

describe('process-run quota guard integration', () => {
  afterEach(() => {
    clearQuotaGuard();
    restoreEnv();
  });

  it('trips the guard and prefixes the error when a failing run emits a quota signal', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("HTTP 429 Too Many Requests"); process.exit(1)',
      ],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRun(ctx, {}, false, identityTransform),
    );

    expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
    expect(getQuotaGuardTrip()).not.toBeNull();
  });

  it('does not trip the guard for an ordinary non-quota failure', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: ['-e', 'console.error("ordinary failure"); process.exit(1)'],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRun(ctx, {}, false, identityTransform),
    );

    expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
    expect(error.message).toContain('Process exited with code');
    expect(getQuotaGuardTrip()).toBeNull();
  });

  it('preserves the ordinary exit failure (no quota label, no trip) when the guard is disabled', async () => {
    // Regression for the disable switch: with LLXPRT_QUOTA_GUARD_DISABLED=true
    // the guard no-ops, so a failing run whose output DOES contain a quota
    // signal must still surface as the plain "exited with code" error and must
    // NOT be relabelled [QUOTA/RATE-LIMIT] nor record a sentinel.
    const dir = activateDisabledGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("HTTP 429 Too Many Requests"); process.exit(1)',
      ],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRun(ctx, {}, false, identityTransform),
    );

    expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
    expect(error.message).toContain('Process exited with code');
    expect(getQuotaGuardTrip()).toBeNull();
  });

  it('preserves the ordinary timeout failure (no quota label, no trip) when the guard is disabled', async () => {
    // Same disable-switch regression on the timeout classification path: a
    // quota-looking hang must time out as the plain timeout error, never the
    // labelled quota timeout, and must not trip the sentinel.
    const dir = activateDisabledGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("Rate limit exceeded. Please wait"); setTimeout(() => {}, 10000)',
      ],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRunWithTimeout(ctx, {}, false, identityTransform, 800),
    );

    expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
    expect(error.message).toContain('timed out');
    expect(getQuotaGuardTrip()).toBeNull();
  });

  it.skipIf(process.platform === 'win32')(
    'reports the signal name (not "code null") when the child is signal-killed',
    async () => {
      const dir = activateGuard();
      const ctx: RunContext = {
        command: process.execPath,
        commandArgs: [
          '-e',
          // The child terminates itself with SIGTERM, so Node's close event emits
          // `code: null, signal: "SIGTERM"`. The error message must name the
          // signal rather than the misleading "exited with code null".
          'process.kill(process.pid, "SIGTERM")',
        ],
        testDir: dir,
      };

      const error = await captureRejection(
        spawnRun(ctx, {}, false, identityTransform),
      );

      expect(error.message).toContain('terminated by signal SIGTERM');
      expect(error.message).not.toContain('code null');
      expect(getQuotaGuardTrip()).toBeNull();
    },
  );

  it('does not trip the guard when the run uses fake responses', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("HTTP 429 Too Many Requests"); process.exit(1)',
      ],
      testDir: dir,
      childEnv: {
        ...process.env,
        LLXPRT_FAKE_RESPONSES: join(tmpdir(), 'fake.jsonl'),
      },
    };

    const error = await captureRejection(
      spawnRun(ctx, {}, false, identityTransform),
    );

    expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
    expect(getQuotaGuardTrip()).toBeNull();
  });

  it('refuses to start a new run once the guard is already tripped', async () => {
    const dir = activateGuard();
    tripQuotaGuard('test trip');

    const markerPath = join(dir, 'child-ran.marker');
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran")`,
      ],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRun(ctx, {}, false, identityTransform),
    );

    expect(error.message).toContain('refusing to start');
    expect(existsSync(markerPath)).toBe(false);
  });

  it('trips the guard when a timed-out run emitted a quota signal', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("Rate limit exceeded. Please wait"); setTimeout(() => {}, 10000)',
      ],
      testDir: dir,
    };

    const error = await captureRejection(
      spawnRunWithTimeout(
        ctx,
        {},
        false,
        identityTransform,
        QUOTA_SIGNAL_TIMEOUT_MS,
      ),
    );

    expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
    expect(error.message).toContain('timed out');
    expect(getQuotaGuardTrip()).not.toBeNull();
  });

  it('never trips on a successful run even when the output mentions rate limits', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: ['-e', 'console.log("rate limit"); process.exit(0)'],
      testDir: dir,
    };

    const result = await spawnRun(ctx, {}, false, identityTransform);

    expect(result).toContain('rate limit');
    expect(getQuotaGuardTrip()).toBeNull();
  });
});
