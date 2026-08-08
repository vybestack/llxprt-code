/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

import { killProcessGroupSafe } from './shellJobInternal.js';

const isWindows = os.platform() === 'win32';

/**
 * Spawns a `sleep 30` sibling into the CALLER's process group.
 *
 * The 'error' listener is required: an unhandled 'error' event (for example if
 * `sleep` were missing from PATH) is thrown as an uncaught exception, which
 * would crash the runner and skip the `finally` cleanup that reaps the child.
 */
function spawnSibling(): ChildProcess {
  const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
  sibling.unref();
  sibling.on('error', () => {});
  return sibling;
}

/**
 * Waits `ms`, rejecting immediately if the sibling exits first.
 *
 * Survival is observed through the child handle rather than a
 * `process.kill(pid, 0)` probe: this process is the sibling's parent, so after
 * a wrongful kill the pid lingers as a zombie until the runtime reaps it, and
 * signal 0 still SUCCEEDS for a zombie. Probing would therefore report a killed
 * sibling as alive and pass the test for exactly the wrong reason.
 */
async function expectSurvivesFor(
  sibling: ChildProcess,
  ms: number,
): Promise<void> {
  await Promise.race([
    new Promise<never>((_, reject) => {
      sibling.once('exit', (_code, signal) =>
        reject(new Error(`sibling was terminated (signal ${signal})`)),
      );
    }),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/** Kill an entire detached process group (no-op if already gone). POSIX only. */
function reapGroup(pgid: number): void {
  // Guard the cleanup path against the very bug under test: a spawn that
  // produced no pid yields 0 here, and `process.kill(-0)` is `process.kill(0)`,
  // which would signal the TEST RUNNER's own process group.
  if (!Number.isInteger(pgid) || pgid <= 0) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------
// killProcessGroupSafe — POSIX-only (production behavior is POSIX-gated)
// ---------------------------------------------------------------------------

describe.skipIf(isWindows)(
  'killProcessGroupSafe pid validation (POSIX)',
  () => {
    it('pid 0 is a no-op: a same-group sibling survives and the test process survives', async () => {
      // killProcessGroupSafe computes process.kill(-pid, signal). For pid 0
      // that is process.kill(0), which signals the CALLER's own process group.
      // A sibling child spawned into the caller's group must survive.
      const sibling = spawnSibling();
      expect(sibling.pid).toBeGreaterThan(0);
      try {
        killProcessGroupSafe(0, 'SIGTERM');
        // Rejects the moment a (buggy) group signal reaches the sibling;
        // otherwise settles after the grace window with the sibling alive.
        await expectSurvivesFor(sibling, 500);
        // Reaching this line also proves the test runner itself survived.
      } finally {
        // The sibling shares this process's group and is NOT a group leader,
        // so it must be reaped through its own handle, not as a group.
        sibling.kill('SIGKILL');
      }
    });

    it('pid -1 / NaN / Infinity are no-ops and do not throw', async () => {
      const sibling = spawnSibling();
      expect(sibling.pid).toBeGreaterThan(0);
      try {
        expect(() => killProcessGroupSafe(-1, 'SIGTERM')).not.toThrow();
        expect(() => killProcessGroupSafe(Number.NaN, 'SIGTERM')).not.toThrow();
        expect(() =>
          killProcessGroupSafe(Number.POSITIVE_INFINITY, 'SIGTERM'),
        ).not.toThrow();
        await expectSurvivesFor(sibling, 500);
      } finally {
        sibling.kill('SIGKILL');
      }
    });

    it('a valid pid still terminates that process group', async () => {
      const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
      child.unref();
      child.on('error', () => {});
      const childPid = child.pid ?? 0;
      expect(childPid).toBeGreaterThan(0);
      // Observe the exit via the child handle rather than a signal-0 probe and
      // a fixed sleep: this process is the child's parent, so between the
      // signal and the runtime's SIGCHLD reap the pid is a zombie for which
      // `process.kill(pid, 0)` still SUCCEEDS.
      const exited = new Promise<NodeJS.Signals | null>((resolve) => {
        child.once('exit', (_code, signal) => resolve(signal));
      });
      try {
        killProcessGroupSafe(childPid, 'SIGTERM');
        const signal = await Promise.race([
          exited,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`pid ${childPid} was not terminated`)),
              8000,
            ),
          ),
        ]);
        // The guard must not have suppressed delivery for a legitimate pid.
        expect(signal).toBe('SIGTERM');
      } finally {
        reapGroup(childPid);
      }
    }, 20000);
  },
);
