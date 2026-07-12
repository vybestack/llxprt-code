/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  spawnRun,
  spawnRunWithTimeout,
  type RunContext,
} from './process-run.js';
import {
  clearQuotaGuard,
  getQuotaGuardTrip,
  tripQuotaGuard,
} from './quota-guard.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-run-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Stub a fresh, isolated guard state directory and disable both the
 * fake-responses short-circuit and CI annotations so each test exercises the
 * real guard behaviour.
 */
function activateGuard(): string {
  const dir = makeTempDir();
  vi.stubEnv('INTEGRATION_TEST_FILE_DIR', dir);
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('LLXPRT_FAKE_RESPONSES', undefined);
  vi.stubEnv('LLXPRT_QUOTA_GUARD_DISABLED', undefined);
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
  vi.stubEnv('LLXPRT_QUOTA_GUARD_DISABLED', 'true');
  return dir;
}

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

const identityTransform = (stdout: string): string => stdout;

describe('process-run quota guard integration', () => {
  afterEach(() => {
    clearQuotaGuard();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
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

  it('reports the signal name (not "code null") when the child is signal-killed', async () => {
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
  });

  it('does not trip the guard when the run uses fake responses', async () => {
    const dir = activateGuard();
    const ctx: RunContext = {
      command: process.execPath,
      commandArgs: [
        '-e',
        'console.error("HTTP 429 Too Many Requests"); process.exit(1)',
      ],
      testDir: dir,
      childEnv: { ...process.env, LLXPRT_FAKE_RESPONSES: '/tmp/fake.jsonl' },
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
      spawnRunWithTimeout(ctx, {}, false, identityTransform, 800),
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
