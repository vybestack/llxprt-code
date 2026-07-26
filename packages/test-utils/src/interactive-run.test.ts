/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pty from '@lydell/node-pty';
import { createDiagnosticsSink } from './diagnostics.js';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import { InteractiveRun } from './interactive-run.js';
import { clearQuotaGuard, getQuotaGuardTrip } from './quota-guard.js';

/**
 * Generous per-test budget: each case spawns a real PTY child and waits out a
 * short poll/exit window. Well under this, but padded for slow CI.
 */
const TEST_TIMEOUT_MS = 20000;

const tempDirs: string[] = [];
const liveRuns: InteractiveRun[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'interactive-run-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Stub a fresh, isolated guard state directory and disable CI annotations so
 * each test exercises the real guard behaviour. Returns the state dir (also
 * used as the child cwd).
 *
 * Unlike the non-interactive process-run path, InteractiveRun's guard is gated
 * solely by the explicit `quotaGuardEnabled` constructor flag (never by
 * `LLXPRT_FAKE_RESPONSES`), so no fake-responses env stubbing is needed here.
 */
function activateGuard(): string {
  const dir = makeTempDir();
  setEnv('INTEGRATION_TEST_FILE_DIR', dir);
  setEnv('GITHUB_ACTIONS', 'false');
  setEnv('LLXPRT_QUOTA_GUARD_DISABLED', undefined);
  clearQuotaGuard();
  return dir;
}

/**
 * Like {@link activateGuard} but with the global disable switch on. Even with
 * `quotaGuardEnabled: true` at construction, a globally disabled guard must not
 * relabel interactive failures as `[QUOTA/RATE-LIMIT]` nor record a sentinel.
 */
function activateDisabledGuard(): string {
  const dir = activateGuard();
  setEnv('LLXPRT_QUOTA_GUARD_DISABLED', 'true');
  return dir;
}

/**
 * Spawn a real PTY around `node -e <script>` and wrap it in an InteractiveRun.
 * Uses the genuine diagnostics sink (infrastructure, not the code under test),
 * so nothing about the quota-detection path is mocked.
 */
function spawnInteractive(
  cwd: string,
  script: string,
  quotaGuardEnabled: boolean,
): InteractiveRun {
  const ptyProcess = pty.spawn(process.execPath, ['-e', script], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd,
    env: process.env,
  });
  const run = new InteractiveRun(ptyProcess, createDiagnosticsSink(null), {
    quotaGuardEnabled,
  });
  liveRuns.push(run);
  return run;
}

/** A child that prints `message`, then stays alive until killed in cleanup. */
function keepAliveScript(message: string): string {
  return `process.stdout.write(${JSON.stringify(`${message}\n`)}); setInterval(() => {}, 1000);`;
}

/** A child that prints `message`, then exits with `code` after a short delay. */
function printThenExitScript(message: string, code: number): string {
  return `process.stdout.write(${JSON.stringify(`${message}\n`)}); setTimeout(() => process.exit(${code}), 300);`;
}

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

/** Poll until the run reports it has exited, or throw after `timeoutMs`. */
async function waitUntilExited(
  run: InteractiveRun,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!run.exited) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for the PTY child to exit');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('InteractiveRun quota guard integration', () => {
  afterEach(async () => {
    // Kill every live run concurrently: each kill() may wait out a SIGTERM
    // grace period before SIGKILL, so awaiting them sequentially would cost
    // N × gracePeriod. Best-effort — swallow per-run kill errors so one failure
    // never blocks cleanup of the rest.
    await Promise.all(liveRuns.map((run) => run.kill().catch(() => {})));
    liveRuns.length = 0;
    clearQuotaGuard();
    restoreEnv();
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      // The temp dir is (was) the PTY child's cwd; if the OS has not fully
      // reaped the just-killed child, rmSync can hit EBUSY/EPERM. Swallow it so
      // the remaining dirs are still cleaned up; leftovers are OS-reclaimed.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore — best-effort cleanup.
      }
    }
    tempDirs.length = 0;
  });

  it(
    'trips the guard and throws a labelled error when expectText times out after a quota signal',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        keepAliveScript('HTTP 429 Too Many Requests'),
        true,
      );

      const error = await captureRejection(
        run.expectText('this-text-never-appears', 800),
      );

      expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
      expect(getQuotaGuardTrip()).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'does not trip the guard when expectText times out without a quota signal',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        keepAliveScript('ordinary interactive output, nothing unusual'),
        true,
      );

      const error = await captureRejection(
        run.expectText('this-text-never-appears', 800),
      );

      expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'does not trip the guard on a quota signal when quota detection is disabled (fake responses)',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        keepAliveScript('HTTP 429 Too Many Requests'),
        false,
      );

      const error = await captureRejection(
        run.expectText('this-text-never-appears', 800),
      );

      expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'preserves the ordinary expectExit timeout (no quota label, no trip) when the guard is globally disabled',
    async () => {
      // Disable-switch regression on the interactive TIMEOUT classification
      // path (_exitTimeoutError): even though quotaGuardEnabled is true and the
      // hung child's output carries a 429, a globally disabled guard must yield
      // the plain "did not exit" timeout error — exactly like the non-disabled
      // "rejects with a plain timeout error" case for non-quota output — and
      // must record no trip.
      const dir = activateDisabledGuard();
      const run = spawnInteractive(
        dir,
        keepAliveScript('HTTP 429 Too Many Requests'),
        true,
      );

      const error = await captureRejection(run.expectExit(1000));

      expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
      expect(error.message).toContain('did not exit');
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resolves with the exit code (no quota label, no trip) on a non-zero quota exit when the guard is globally disabled',
    async () => {
      // Disable-switch regression on the interactive NON-ZERO EXIT path: a
      // quota-looking non-zero exit must resolve with the ordinary exit code
      // (not reject with a labelled quota error) and record no trip.
      const dir = activateDisabledGuard();
      const run = spawnInteractive(
        dir,
        printThenExitScript('Rate limit exceeded. Please wait a moment', 1),
        true,
      );

      const exitCode = await run.expectExit(5000);

      expect(exitCode).toBe(1);
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'trips the guard and rejects with a labelled error when the PTY exits non-zero after a quota signal',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        printThenExitScript('Rate limit exceeded. Please wait a moment', 1),
        true,
      );

      const error = await captureRejection(run.expectExit(5000));

      expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
      expect(getQuotaGuardTrip()).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resolves with the exit code (and does not trip) on an ordinary non-zero exit',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        printThenExitScript('ordinary failure, no quota involved', 3),
        true,
      );

      const exitCode = await run.expectExit(5000);

      expect(exitCode).toBe(3);
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resolves with 0 (and does not trip) on a clean exit even when quota detection is enabled',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        printThenExitScript('all good here', 0),
        true,
      );

      const exitCode = await run.expectExit(5000);

      expect(exitCode).toBe(0);
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'trips the guard when expectExit is called AFTER the PTY already exited on a quota wall',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        printThenExitScript('quota exceeded for this project', 1),
        true,
      );

      // The quota wall kills the child before the test awaits its exit. This
      // exercises the already-exited fast path of expectExit, which must still
      // detect the signal rather than hang until the timeout.
      await waitUntilExited(run, 5000);

      const error = await captureRejection(run.expectExit(5000));

      expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
      expect(getQuotaGuardTrip()).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'trips the guard and rejects with a labelled error when expectExit times out after a quota signal',
    async () => {
      const dir = activateGuard();
      // The child prints a quota signal then hangs forever (never exits), so the
      // ONLY way expectExit can surface the quota wall is by scanning output on
      // the timeout path — the exit event never fires.
      const run = spawnInteractive(
        dir,
        keepAliveScript('HTTP 429 Too Many Requests'),
        true,
      );

      const error = await captureRejection(run.expectExit(1000));

      expect(error.message).toContain('[QUOTA/RATE-LIMIT]');
      // The plain timeout context is preserved alongside the quota label so the
      // reader still sees that the process failed to exit.
      expect(error.message.toLowerCase()).toContain('exit');
      expect(getQuotaGuardTrip()).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects with a plain timeout error (and does not trip) when expectExit times out without a quota signal',
    async () => {
      const dir = activateGuard();
      const run = spawnInteractive(
        dir,
        keepAliveScript('ordinary interactive output, nothing unusual'),
        true,
      );

      const error = await captureRejection(run.expectExit(1000));

      expect(error.message).not.toContain('[QUOTA/RATE-LIMIT]');
      expect(error.message).toContain('did not exit');
      expect(getQuotaGuardTrip()).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
