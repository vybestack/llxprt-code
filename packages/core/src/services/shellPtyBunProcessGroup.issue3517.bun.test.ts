/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3517: under Bun the foreground PTY is spawned by `Bun.spawn` with an
 * inline terminal, which makes the child a session and process-group leader.
 * Group-wide termination used to be switched off for that backend, so abort,
 * inactivity timeout and explicit termination killed only the shell and left
 * its children running.
 *
 * These tests run real isolated Bun PTYs. Every fixture child is recorded by
 * pid and, in the cleanup, is signalled only if it is still alive and still a
 * member of the process group led by the PTY pid this test spawned.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ShellExecutionService } from './shellExecutionService.js';
import type {
  ShellExecutionHandle,
  ShellExecutionResult,
} from './shellExecutionTypes.js';

const isWindows = os.platform() === 'win32';
const POLL_INTERVAL_MS = 25;

const shellConfig = {
  showColor: false,
  scrollback: 1000,
  terminalWidth: 80,
  terminalHeight: 24,
};

function processGroupOf(pid: number): number | undefined {
  const ps = Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(pid)]);
  const group = Number.parseInt(new TextDecoder().decode(ps.stdout).trim(), 10);
  return Number.isInteger(group) ? group : undefined;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollUntil(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return condition();
}

/**
 * Cleanup-only: signal a recorded fixture pid, and only while it is still a
 * member of the group led by the PTY pid this test spawned. A pid that is
 * gone, or that no longer belongs to that group, is never signalled.
 */
function killFixturePidIfOwned(pid: number, ownerGroup: number): void {
  if (processGroupOf(pid) !== ownerGroup) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already exited.
  }
}

interface Fixture {
  readonly handle: ShellExecutionHandle;
  readonly childPid: number;
}

describe('Bun foreground PTY process-group termination (issue #3517)', () => {
  let workDir: string;
  let spawnedGroups: number[];
  let recordedChildren: number[];

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-bun-pty-group-'));
    spawnedGroups = [];
    recordedChildren = [];
  });

  afterEach(() => {
    // A failure before the test recorded the child must not leak it.
    const pidFile = path.join(workDir, 'child.pid');
    if (fs.existsSync(pidFile)) {
      const child = Number.parseInt(
        fs.readFileSync(pidFile, 'utf8').trim(),
        10,
      );
      if (Number.isInteger(child)) recordedChildren.push(child);
    }
    for (const group of spawnedGroups) {
      for (const child of recordedChildren) {
        killFixturePidIfOwned(child, group);
      }
      killFixturePidIfOwned(group, group);
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  /**
   * Starts a shell that backgrounds one child, records the child's pid, and
   * waits. The child always ignores SIGHUP, as `nohup` does, so the hangup
   * the kernel sends when the session leader exits cannot end it; only the
   * termination path under test can. `childTraps` additionally makes it
   * ignore SIGTERM so only SIGKILL can end it.
   */
  async function startShellWithChild(options: {
    childTraps: boolean;
    signal?: AbortSignal;
    inactivityTimeoutMs?: number;
  }): Promise<Fixture> {
    const pidFile = path.join(workDir, 'child.pid');
    const trap = options.childTraps ? "trap '' HUP TERM; " : "trap '' HUP; ";
    const command = `(${trap}exec sleep 86413) & echo $! > '${pidFile}'; wait`;
    const handle = await ShellExecutionService.execute(
      command,
      workDir,
      () => undefined,
      options.signal ?? new AbortController().signal,
      true,
      {
        ...shellConfig,
        ...(options.inactivityTimeoutMs === undefined
          ? {}
          : { inactivityTimeoutMs: options.inactivityTimeoutMs }),
      },
    );
    if (handle.pid === undefined) {
      throw new Error('PTY did not report a pid');
    }
    spawnedGroups.push(handle.pid);

    const recorded = await pollUntil(
      () =>
        fs.existsSync(pidFile) &&
        fs.readFileSync(pidFile, 'utf8').trim() !== '',
      5000,
    );
    if (!recorded) {
      throw new Error('fixture shell did not record its child pid');
    }
    const childPid = Number.parseInt(
      fs.readFileSync(pidFile, 'utf8').trim(),
      10,
    );
    recordedChildren.push(childPid);
    expect(processGroupOf(childPid)).toBe(handle.pid);
    return { handle, childPid };
  }

  async function settle(fixture: Fixture): Promise<ShellExecutionResult> {
    return fixture.handle.result;
  }

  it.skipIf(isWindows)(
    'kills a SIGTERM-ignoring child of the shell when the caller aborts',
    async () => {
      const controller = new AbortController();
      const fixture = await startShellWithChild({
        childTraps: true,
        signal: controller.signal,
      });

      controller.abort();
      const result = await settle(fixture);

      expect(result.aborted).toBe(true);
      expect(result.survivingGroupMembersOnAbort).toBeUndefined();
      expect(await pollUntil(() => !isPidAlive(fixture.childPid), 3000)).toBe(
        true,
      );
    },
    20000,
  );

  it.skipIf(isWindows)(
    'kills a SIGTERM-ignoring child of the shell when the inactivity timeout fires',
    async () => {
      const fixture = await startShellWithChild({
        childTraps: true,
        inactivityTimeoutMs: 600,
      });

      const result = await settle(fixture);

      expect(result.aborted).toBe(false);
      expect(result.survivingGroupMembersOnAbort).toBeUndefined();
      expect(await pollUntil(() => !isPidAlive(fixture.childPid), 3000)).toBe(
        true,
      );
    },
    20000,
  );

  it.skipIf(isWindows)(
    'kills the shell child group on explicit terminatePty',
    async () => {
      const fixture = await startShellWithChild({ childTraps: false });

      ShellExecutionService.terminatePty(fixture.handle.pid);
      await settle(fixture);

      expect(await pollUntil(() => !isPidAlive(fixture.childPid), 3000)).toBe(
        true,
      );
    },
    20000,
  );

  it.skipIf(isWindows)(
    'escalates to SIGKILL on explicit terminatePty for a SIGTERM-ignoring child after the shell has exited',
    async () => {
      const fixture = await startShellWithChild({ childTraps: true });

      ShellExecutionService.terminatePty(fixture.handle.pid);
      await settle(fixture);

      // The shell is gone and its registry entry has been removed, so the
      // kill that follows cannot be driven by the entry still being present.
      expect(ShellExecutionService.isActivePty(fixture.handle.pid ?? 0)).toBe(
        false,
      );
      expect(await pollUntil(() => !isPidAlive(fixture.childPid), 3000)).toBe(
        true,
      );
    },
    20000,
  );

  it.skipIf(isWindows)(
    'terminates the shell child group on shutdown disposal',
    async () => {
      const fixture = await startShellWithChild({ childTraps: false });

      await ShellExecutionService.destroyAllPtys();

      expect(await pollUntil(() => !isPidAlive(fixture.childPid), 3000)).toBe(
        true,
      );
    },
    20000,
  );

  it.skipIf(isWindows)(
    'escalates to SIGKILL for a SIGTERM-ignoring child on shutdown disposal',
    async () => {
      const fixture = await startShellWithChild({ childTraps: true });

      await ShellExecutionService.destroyAllPtys();

      expect(isPidAlive(fixture.childPid)).toBe(false);
    },
    20000,
  );
  it.skipIf(isWindows)(
    'shutdown disposal waits for the escalation started by an earlier terminatePty',
    async () => {
      const fixture = await startShellWithChild({ childTraps: true });

      ShellExecutionService.terminatePty(fixture.handle.pid);
      await settle(fixture);
      expect(ShellExecutionService.isActivePty(fixture.handle.pid ?? 0)).toBe(
        false,
      );
      await ShellExecutionService.destroyAllPtys();

      // No grace sleep: disposal itself must have waited for the SIGKILL.
      expect(isPidAlive(fixture.childPid)).toBe(false);
    },
    20000,
  );

  it.skipIf(isWindows)(
    'every concurrent shutdown disposal waits for the group to be gone',
    async () => {
      const fixture = await startShellWithChild({ childTraps: true });

      const first = ShellExecutionService.destroyAllPtys();
      const second = ShellExecutionService.destroyAllPtys();
      await second;

      expect(isPidAlive(fixture.childPid)).toBe(false);
      await first;
    },
    20000,
  );

  it.skipIf(isWindows)(
    'shutdown disposal leaves no child behind when the shell exits during an abort escalation',
    async () => {
      const controller = new AbortController();
      const fixture = await startShellWithChild({
        childTraps: true,
        signal: controller.signal,
      });
      const leaderPid = fixture.handle.pid ?? 0;

      controller.abort();
      // The shell exits on SIGTERM while the TERM-ignoring child is still
      // inside the abort escalation's grace window.
      expect(await pollUntil(() => !isPidAlive(leaderPid), 3000)).toBe(true);
      await ShellExecutionService.destroyAllPtys();

      expect(isPidAlive(fixture.childPid)).toBe(false);
      await settle(fixture);
    },
    20000,
  );
});
