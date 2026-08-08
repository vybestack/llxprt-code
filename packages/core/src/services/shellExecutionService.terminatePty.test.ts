/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import os from 'node:os';
import { spawn } from 'node:child_process';

import headless from '@xterm/headless';
import type { IPty } from '@lydell/node-pty';
import type { ActivePty } from './shellPtyHelpers.js';
import { ShellExecutionService } from './shellExecutionService.js';

const { Terminal } = headless;

const isWindows = os.platform() === 'win32';

// The private static pty registry is accessed via a typed cast; this is the
// observable boundary that determines whether terminatePty reaches its kill
// path (no public API registers an arbitrary pid).
const serviceInternals = ShellExecutionService as unknown as {
  activePtys: Map<number, ActivePty>;
};

/** Signal-0 liveness check. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls until the pid is gone, up to `timeoutMs`. Polling rather than a fixed
 * sleep keeps the assertion stable on a loaded CI runner, where taskkill can
 * take noticeably longer than the happy path.
 */
async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Best-effort cleanup of a registered fake entry and its escalation timer. */
function removeFakeEntry(pid: number): void {
  const entry = serviceInternals.activePtys.get(pid);
  if (entry) {
    if (entry.terminationTimeout) {
      clearTimeout(entry.terminationTimeout);
      entry.terminationTimeout = undefined;
    }
    serviceInternals.activePtys.delete(pid);
  }
}

/**
 * Best-effort direct reap of a Windows pid (cleanup only). Awaits taskkill's
 * exit so the tree is actually gone before the test ends; returning early
 * would let the runner exit while taskkill is still running, leaking
 * processes onto the CI agent.
 */
async function reapWindowsPid(pid: number): Promise<void> {
  if (pid <= 0) return;
  try {
    const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => {
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  } catch {
    // Already gone.
  }
}

describe.skipIf(isWindows)(
  'ShellExecutionService.terminatePty pid validation (POSIX)',
  () => {
    afterEach(() => {
      for (const pid of [...serviceInternals.activePtys.keys()]) {
        removeFakeEntry(pid);
      }
    });

    it('pid 0 does not signal the caller process group even when registered', async () => {
      // Registering under pid 0 is what makes this reachable: before the fix
      // terminatePty(0) found the entry and ran process.kill(-0), which is
      // process.kill(0) — a signal to the CALLER's own process group. A
      // sibling sharing this process's group must survive.
      const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
      sibling.unref();
      // Without an 'error' listener a failed spawn raises an uncaught exception
      // that crashes the runner and skips the finally cleanup below.
      sibling.on('error', () => {});
      expect(sibling.pid).toBeGreaterThan(0);

      const terminal = new Terminal({
        allowProposedApi: true,
        cols: 80,
        rows: 30,
        scrollback: 10,
      });
      const fakePty = { pid: 0, kill: () => undefined } as unknown as IPty;
      serviceInternals.activePtys.set(0, {
        ptyProcess: fakePty,
        headlessTerminal: terminal,
        supportsProcessGroupKill: true,
      });

      try {
        expect(() => ShellExecutionService.terminatePty(0)).not.toThrow();
        // Observe survival through the child handle, not a signal-0 probe: this
        // process is the sibling's parent, so a wrongly-killed sibling lingers
        // as a zombie for which signal 0 still succeeds, which would pass this
        // test for exactly the wrong reason.
        await Promise.race([
          new Promise<never>((_, reject) => {
            sibling.on('exit', (_code, signal) =>
              reject(new Error(`sibling was terminated (signal ${signal})`)),
            );
          }),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);
        // Reaching this line also proves the test runner itself survived.
      } finally {
        removeFakeEntry(0);
        try {
          terminal.dispose();
        } catch {
          // May already be disposed.
        }
        // The sibling shares this process's group and is NOT a group leader,
        // so it must be reaped through its own handle, not as a group.
        sibling.kill('SIGKILL');
      }
    }, 20000);
  },
);

describe.skipIf(!isWindows)(
  'ShellExecutionService.terminatePty (Windows)',
  () => {
    afterEach(() => {
      // Defensive: clear any strays without assuming a specific pid.
      for (const pid of [...serviceInternals.activePtys.keys()]) {
        removeFakeEntry(pid);
      }
    });

    it('reaps a registered pty via the taskkill path, not a POSIX process-group kill', async () => {
      // Spawn a real long-lived child and register it as an ActivePty entry.
      // Before the fix terminatePty used process.kill(-pid) on Windows, which
      // throws (no process groups) and leaves the tree alive. After the fix the
      // isWindows branch uses taskkillTree and the process is reaped.
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Start-Sleep -Seconds 60'],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.unref();
      const childPid = child.pid ?? 0;
      expect(childPid).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const terminal = new Terminal({
        allowProposedApi: true,
        cols: 80,
        rows: 30,
        scrollback: 10,
      });
      const fakePty = {
        pid: childPid,
        kill: () => undefined,
      } as unknown as IPty;
      const entry: ActivePty = {
        ptyProcess: fakePty,
        headlessTerminal: terminal,
        supportsProcessGroupKill: true,
      };
      serviceInternals.activePtys.set(childPid, entry);

      try {
        ShellExecutionService.terminatePty(childPid);
        await waitForPidGone(childPid, 8000);
        expect(isPidAlive(childPid)).toBe(false);
      } finally {
        removeFakeEntry(childPid);
        try {
          terminal.dispose();
        } catch {
          // May already be disposed.
        }
        await reapWindowsPid(childPid);
      }
    }, 20000);
  },
);
