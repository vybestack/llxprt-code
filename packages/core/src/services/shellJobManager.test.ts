/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  ShellJobManager,
  ShellJobDisposalError,
  survivorNeedsReap,
  type SurvivorEntry,
} from './shellJobManager.js';
import type { ShellJob } from './shellJobManager.js';
import { boundedTaskkill, type TaskkillResult } from './shellProcessKill.js';
import {
  buildInnerPidMarkerCommand,
  disposeAndCleanupWindowsTest,
  isPidAliveWindows,
  reapAndRemoveWindowsTestDir,
  readInnerPidFromMarker,
  waitForPidFile,
  waitForPidStateWindows,
} from '../../test/utils/shellJobTestCleanup.js';

/**
 * Real-process behavioral tests for ShellJobManager. Every test uses actual
 * shell processes spawned by the manager — no mocks. Each test deterministically
 * cleans up via afterEach (dispose + temp dir removal).
 */

function makeTempBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shell-job-test-'));
}

function makeManager(options?: {
  maxBackgroundJobs?: number;
  logMaxBytes?: number;
}): { manager: ShellJobManager; baseDir: string } {
  const baseDir = makeTempBase();
  const manager = new ShellJobManager({
    maxBackgroundJobs: options?.maxBackgroundJobs,
    logMaxBytes: options?.logMaxBytes,
    baseDir,
  });
  return { manager, baseDir };
}

function waitForTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = process.platform === 'win32' ? 15000 : 5000,
): Promise<ShellJob | undefined> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const job = manager.get(id);
      if (job !== undefined && job.state !== 'running') {
        resolve(job);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Job ${id} did not reach terminal state in time`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function pgidOf(pid: number): number | null {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const parsed = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Kill a process group for test cleanup, refusing any pgid that POSIX kill(2)
 * would reinterpret. `pgidOf` returns null on failure and `Number(null)` is 0,
 * so an unguarded `process.kill(-pgid)` would become `process.kill(0)` and
 * signal the TEST RUNNER's own process group.
 */
function reapGroupSafe(pgid: number | null | undefined): void {
  if (typeof pgid !== 'number' || !Number.isInteger(pgid) || pgid <= 0) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function isProcessGroupGone(pid: number): boolean {
  const pgid = pgidOf(pid);
  if (pgid === null) {
    return true;
  }
  // Check if any process in the group is alive
  try {
    process.kill(-pgid, 0);
    return false;
  } catch {
    return true;
  }
}

describe.skipIf(os.platform() === 'win32')('ShellJobManager', () => {
  let manager: ShellJobManager;
  let baseDir: string;

  beforeEach(() => {
    const setup = makeManager();
    manager = setup.manager;
    baseDir = setup.baseDir;
  });

  afterEach(async () => {
    await manager.dispose();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  describe('fast success and failure', () => {
    it('completes a fast-success command with real exit code 0 and retrievable output', async () => {
      const job = manager.launch({
        command: 'echo hello-world',
        cwd: os.tmpdir(),
      });
      const terminal = await waitForTerminal(manager, job.id);

      expect(terminal).toBeDefined();
      expect(terminal?.state).toBe('completed');
      expect(terminal?.exitCode).toBe(0);

      const tail = manager.tailOutput(job.id);
      expect(tail.output).toContain('hello-world');
    });

    it('fails a fast-failing command with real non-zero exit code and stderr in tail', async () => {
      const job = manager.launch({
        command: 'echo err-msg >&2; exit 3',
        cwd: os.tmpdir(),
      });
      const terminal = await waitForTerminal(manager, job.id);

      expect(terminal).toBeDefined();
      expect(terminal?.state).toBe('failed');
      expect(terminal?.exitCode).toBe(3);

      const tail = manager.tailOutput(job.id);
      expect(tail.output).toContain('err-msg');
    });
  });

  describe('exit code correctness for wrapper-defeating cases', () => {
    it('reports correct non-zero exit for "set -e; false"', async () => {
      const job = manager.launch({
        command: 'set -e; false',
        cwd: os.tmpdir(),
      });
      const terminal = await waitForTerminal(manager, job.id);

      expect(terminal?.state).toBe('failed');
      expect(terminal?.exitCode).toBe(1);
    });

    it('reports correct exit for a command with a trailing # comment', async () => {
      const job = manager.launch({
        command: 'echo trailing-comment # this is a comment',
        cwd: os.tmpdir(),
      });
      const terminal = await waitForTerminal(manager, job.id);

      expect(terminal?.state).toBe('completed');
      expect(terminal?.exitCode).toBe(0);
      expect(manager.tailOutput(job.id).output).toContain('trailing-comment');
    });

    it('reports correct exit for a heredoc command', async () => {
      const command = 'cat <<EOF\nheredoc-line-1\nheredoc-line-2\nEOF';
      const job = manager.launch({ command, cwd: os.tmpdir() });
      const terminal = await waitForTerminal(manager, job.id);

      expect(terminal?.state).toBe('completed');
      expect(terminal?.exitCode).toBe(0);
      const tail = manager.tailOutput(job.id);
      expect(tail.output).toContain('heredoc-line-1');
      expect(tail.output).toContain('heredoc-line-2');
    });
  });

  describe('spawn error and budget release', () => {
    it('fails a job when the cwd does not exist AND releases the budget slot', async () => {
      const badCwd = path.join(baseDir, 'does-not-exist');
      // The spawn should still happen but the process will error immediately.
      // We launch and expect a 'failed' state.
      const job = manager.launch({ command: 'echo hi', cwd: badCwd });
      const terminal = await waitForTerminal(manager, job.id, 5000);

      expect(terminal?.state).toBe('failed');
      expect(terminal?.failureReason).toBeDefined();

      // Budget was released: we can launch again immediately.
      const job2 = manager.launch({ command: 'echo ok', cwd: os.tmpdir() });
      const terminal2 = await waitForTerminal(manager, job2.id);
      expect(terminal2?.state).toBe('completed');
    });

    // Regression guard for issue #3126: a job whose spawn failed carries a
    // sentinel/absent pid. Cancelling it must never deliver a signal to the
    // caller's own process group, and the job must already be (or reach) a
    // terminal state. The genuinely dangerous pid (0) is exercised at the
    // primitive chokepoints (killProcessGroupSafe/escalateKillUnix); this
    // guards the full manager cancel path end-to-end.
    it('cancel of a spawn-failed job does not signal the caller process group', async () => {
      const badCwd = path.join(baseDir, 'does-not-exist');
      // A sibling sharing the test process's own group must survive any cancel.
      const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
      sibling.unref();
      const siblingPid = sibling.pid ?? 0;
      expect(siblingPid).toBeGreaterThan(0);
      try {
        const job = manager.launch({ command: 'echo hi', cwd: badCwd });
        const terminal = await waitForTerminal(manager, job.id, 5000);
        expect(terminal?.state).toBe('failed');

        // Cancel is a no-op for an already-terminal job; it must not signal.
        await manager.cancel(job.id);

        // There is no event to await for the ABSENCE of a signal, so a fixed
        // settle window is the only available construct. It is not a flake
        // risk in the failing direction: a loaded runner that delivers a
        // stray signal after the window makes this test pass spuriously, not
        // fail spuriously, so the window is a lower bound on confidence
        // rather than a deadline that can expire.
        await new Promise((resolve) => setTimeout(resolve, 400));
        const siblingPgid = pgidOf(siblingPid);
        expect(siblingPgid).not.toBeNull();
        expect(() => process.kill(siblingPid, 0)).not.toThrow();
      } finally {
        reapGroupSafe(pgidOf(siblingPid));
      }
    });
  });

  describe('external signal kill', () => {
    it('records the signal when the process group is killed externally', async () => {
      const job = manager.launch({
        command: 'sleep 30',
        cwd: os.tmpdir(),
      });

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Kill the process group externally
      reapGroupSafe(job.pid);

      const terminal = await waitForTerminal(manager, job.id, 5000);
      expect(terminal).toBeDefined();
      expect(terminal?.state).toBe('failed');
      expect(terminal?.signal).toBe('SIGKILL');
    });
  });

  describe('cancel', () => {
    it('cancels a running job, kills the process group, exactly one terminal event', async () => {
      const job = manager.launch({
        command: 'sleep 30',
        cwd: os.tmpdir(),
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      let eventCount = 0;
      manager.onJobCancelled(() => {
        eventCount++;
      });
      manager.onJobCompleted(() => {
        eventCount++;
      });
      manager.onJobFailed(() => {
        eventCount++;
      });

      const result = await manager.cancel(job.id);
      expect(result).toBe(true);

      const terminal = manager.get(job.id);
      expect(terminal?.state).toBe('cancelled');

      // Process group should be gone
      expect(isProcessGroupGone(job.pid)).toBe(true);

      // Give time for any race to resolve
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventCount).toBe(1);
    });

    it('resolves false when cancelling an already-terminal job', async () => {
      const job = manager.launch({ command: 'true', cwd: os.tmpdir() });
      await waitForTerminal(manager, job.id);

      const result = await manager.cancel(job.id);
      expect(result).toBe(false);
    });

    it('escalates SIGTERM to SIGKILL for a process that ignores SIGTERM', async () => {
      // trap '' TERM ignores SIGTERM; the escalation timer must SIGKILL it.
      const job = manager.launch({
        command: "trap '' TERM; sleep 30",
        cwd: os.tmpdir(),
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const start = Date.now();
      const result = await manager.cancel(job.id);
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      // SIGKILL_TIMEOUT_MS is 200ms; allow generous headroom
      expect(elapsed).toBeLessThan(5000);
      expect(isProcessGroupGone(job.pid)).toBe(true);
    });
  });

  describe('cancel racing a natural exit', () => {
    it('produces exactly one terminal transition and one event when cancel races exit', async () => {
      const job = manager.launch({
        command: 'sleep 0.3',
        cwd: os.tmpdir(),
      });

      let eventCount = 0;
      let lastState = '';
      manager.onJobCancelled((j) => {
        eventCount++;
        lastState = j.state;
      });
      manager.onJobCompleted((j) => {
        eventCount++;
        lastState = j.state;
      });
      manager.onJobFailed((j) => {
        eventCount++;
        lastState = j.state;
      });

      // Immediately cancel — the job is about to exit naturally.
      await manager.cancel(job.id);

      await waitForTerminal(manager, job.id, 5000);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(eventCount).toBe(1);
      // Either cancelled (if cancel won the race) or completed (if exit won)
      expect(['cancelled', 'completed']).toContain(lastState);
    });
  });

  describe('tailOutput while running', () => {
    it('returns recent lines while the job is still running', async () => {
      const job = manager.launch({
        command: 'echo line1; sleep 1; echo line2',
        cwd: os.tmpdir(),
      });
      // Wait for line1 to appear
      await new Promise((resolve) => setTimeout(resolve, 300));

      const tail = manager.tailOutput(job.id);
      expect(tail.output).toContain('line1');

      await waitForTerminal(manager, job.id);
    });
  });

  describe('log cap', () => {
    it('fails an over-cap job with an explicit failure reason', async () => {
      const capManager = new ShellJobManager({
        maxBackgroundJobs: 10,
        logMaxBytes: 256,
        baseDir: makeTempBase(),
      });
      try {
        // Generate output slowly but continuously so the 2s cap poll catches
        // the job while it is still running and over the 256-byte cap.
        const job = capManager.launch({
          command:
            'for i in $(seq 1 1000); do echo "padding-line-$i-padding"; sleep 0.05; done',
          cwd: os.tmpdir(),
        });
        const terminal = await waitForTerminal(capManager, job.id, 15000);

        expect(terminal).toBeDefined();
        expect(terminal?.state).toBe('failed');
        expect(terminal?.failureReason).toContain('exceeded cap');
      } finally {
        await capManager.dispose();
      }
    });
  });

  describe('retention', () => {
    it('evicts oldest notified terminal jobs and deletes their logs, never an unnotified one', async () => {
      const retManager = new ShellJobManager({
        maxBackgroundJobs: 2,
        baseDir: makeTempBase(),
      });
      try {
        // Launch and complete 3 jobs. History limit = 2*2 = 4, so we need more
        // to trigger eviction. But first we need to exceed the limit.
        const jobs: ShellJob[] = [];
        for (let i = 0; i < 5; i++) {
          const job = retManager.launch({
            command: `echo job-${i}`,
            cwd: os.tmpdir(),
          });
          await waitForTerminal(retManager, job.id);
          jobs.push(job);
        }

        // Mark all as notified so they are eligible for eviction.
        retManager.markNotified(jobs.map((j) => j.id));

        // History limit = 2*2 = 4. We have 5 terminal jobs. One should be evicted.
        const remaining = retManager.list();
        expect(remaining.length).toBeLessThanOrEqual(4);

        // The oldest job (jobs[0]) should be evicted and its log deleted.
        const oldest = retManager.get(jobs[0].id);
        expect(oldest).toBeUndefined();
      } finally {
        await retManager.dispose();
      }
    });

    it('never evicts an unnotified terminal job', async () => {
      const retManager = new ShellJobManager({
        maxBackgroundJobs: 1,
        baseDir: makeTempBase(),
      });
      try {
        const job1 = retManager.launch({
          command: 'echo first',
          cwd: os.tmpdir(),
        });
        await waitForTerminal(retManager, job1.id);
        // Do NOT mark as notified.

        const job2 = retManager.launch({
          command: 'echo second',
          cwd: os.tmpdir(),
        });
        await waitForTerminal(retManager, job2.id);
        // Do NOT mark as notified.

        // Both should still be present because neither was notified.
        expect(retManager.get(job1.id)).toBeDefined();
        expect(retManager.get(job2.id)).toBeDefined();
      } finally {
        await retManager.dispose();
      }
    });
  });

  describe('budget exhaustion and reservation release', () => {
    it('rejects a launch when budget is exhausted', () => {
      const budgetManager = new ShellJobManager({
        maxBackgroundJobs: 1,
        baseDir: makeTempBase(),
      });
      try {
        // Occupy the one slot with a long-running job.
        budgetManager.launch({ command: 'sleep 30', cwd: os.tmpdir() });

        // Second launch should throw.
        expect(() =>
          budgetManager.launch({ command: 'echo hi', cwd: os.tmpdir() }),
        ).toThrow('Background job budget exhausted');
      } finally {
        void budgetManager.dispose();
      }
    });

    it('releases a reservation on a failed launch so the next succeeds', async () => {
      const budgetManager = new ShellJobManager({
        maxBackgroundJobs: 1,
        baseDir: makeTempBase(),
      });
      try {
        // First launch with a bad cwd — it will fail, but the budget slot
        // must be released.
        const badJob = budgetManager.launch({
          command: 'echo hi',
          cwd: '/nonexistent-path-xyz',
        });
        await waitForTerminal(budgetManager, badJob.id, 5000);

        // Now we can launch again within the budget.
        const goodJob = budgetManager.launch({
          command: 'echo success',
          cwd: os.tmpdir(),
        });
        expect(goodJob.state).toBe('running');
      } finally {
        await budgetManager.dispose();
      }
    });
  });

  describe('dispose', () => {
    it('terminates running jobs leaving zero orphans', async () => {
      const disposeManager = new ShellJobManager({
        maxBackgroundJobs: 10,
        baseDir: makeTempBase(),
      });
      const pids: number[] = [];
      try {
        const job1 = disposeManager.launch({
          command: 'sleep 30',
          cwd: os.tmpdir(),
        });
        const job2 = disposeManager.launch({
          command: 'sleep 30',
          cwd: os.tmpdir(),
        });
        pids.push(job1.pid, job2.pid);
        await new Promise((resolve) => setTimeout(resolve, 200));

        await disposeManager.dispose();

        // All pids should be gone.
        for (const pid of pids) {
          expect(isProcessGroupGone(pid)).toBe(true);
        }
      } finally {
        // Ensure cleanup even if dispose failed.
        await disposeManager.dispose();
      }
    });
  });

  describe('prefix lookup', () => {
    it('finds a job by unique prefix', async () => {
      const job = manager.launch({ command: 'true', cwd: os.tmpdir() });
      await waitForTerminal(manager, job.id);

      const prefix = job.id.slice(0, 10);
      const result = manager.getByPrefix(prefix);
      expect(result.job).toBeDefined();
      expect(result.job?.id).toBe(job.id);
    });
  });
});

// ---------------------------------------------------------------------------
// Windows-only suite
// ---------------------------------------------------------------------------
async function waitForPidGoneWindows(
  pid: number,
  timeoutMs = 10000,
): Promise<void> {
  await waitForPidStateWindows(pid, false, timeoutMs);
}

describe.skipIf(os.platform() !== 'win32')('ShellJobManager on Windows', () => {
  let manager: ShellJobManager;

  beforeEach(() => {
    manager = makeManager().manager;
  });

  afterEach(async () => {
    // dispose() owns its temp dir (ShellJobLogStore.destroy() removes it with
    // a bounded retry). An explicit rmSync here is redundant and, on Windows,
    // races with redirected-log handle release right after taskkill /F /T.
    await manager.dispose();
  });

  it('completes a fast-success PowerShell command with exit code 0', async () => {
    const job = manager.launch({
      command: "Write-Output 'hello-windows'",
      cwd: os.tmpdir(),
    });
    const terminal = await waitForTerminal(manager, job.id);

    expect(terminal).toBeDefined();
    expect(terminal?.state).toBe('completed');
    expect(terminal?.exitCode).toBe(0);

    const tail = manager.tailOutput(job.id);
    expect(tail.output).toContain('hello-windows');
  });

  it('reports a fast-failing command with the real non-zero exit code', async () => {
    const job = manager.launch({
      command: 'exit 3',
      cwd: os.tmpdir(),
    });
    const terminal = await waitForTerminal(manager, job.id);

    expect(terminal).toBeDefined();
    expect(terminal?.state).toBe('failed');
    expect(terminal?.exitCode).toBe(3);
  });

  it('reports exit 1 for a thrown exception', async () => {
    const job = manager.launch({
      command: "throw 'kaboom'",
      cwd: os.tmpdir(),
    });
    const terminal = await waitForTerminal(manager, job.id);

    expect(terminal).toBeDefined();
    expect(terminal?.state).toBe('failed');
    expect(terminal?.exitCode).toBe(1);
  });

  it('reaches the running state with a live pid for a long-running job', async () => {
    const job = manager.launch({
      command: 'Start-Sleep -Seconds 30',
      cwd: os.tmpdir(),
    });

    expect(job.state).toBe('running');
    expect(job.pid).toBeGreaterThan(0);
    await waitForPidStateWindows(job.pid, true, 5000);
  });

  it('cancels a running job and reaps the process tree', async () => {
    const job = manager.launch({
      command: 'Start-Sleep -Seconds 30',
      cwd: os.tmpdir(),
    });
    expect(job.pid).toBeGreaterThan(0);

    const cancelled = await manager.cancel(job.id);
    expect(cancelled).toBe(true);

    const terminal = manager.get(job.id);
    expect(terminal?.state).toBe('cancelled');

    await waitForPidGoneWindows(job.pid);
  });

  it('reaps a grandchild spawned by the inner command (taskkill /T)', async () => {
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-gc-'));
    const grandchildMarker = path.join(markerDir, 'gc.pid');
    try {
      const escapedMarker = grandchildMarker.replace(/'/g, "''");
      const command =
        'Start-Process -FilePath powershell.exe ' +
        `-ArgumentList @('-NoProfile','-Command','$PID | Out-File -FilePath ''${escapedMarker}'' -Encoding ASCII; Start-Sleep -Seconds 60') ` +
        '-WindowStyle Hidden -PassThru | Out-Null; ' +
        'Start-Sleep -Seconds 60';

      const job = manager.launch({ command, cwd: os.tmpdir() });
      expect(job.pid).toBeGreaterThan(0);

      // Read the grandchild PID from the marker file. waitForPidFile polls up
      // to its 10000ms timeout, so no fixed pre-delay is needed.
      const grandchildPid = await waitForPidFile(grandchildMarker, 10000);
      expect(grandchildPid).toBeGreaterThan(0);
      expect(isPidAliveWindows(grandchildPid)).toBe(true);

      const cancelled = await manager.cancel(job.id);
      expect(cancelled).toBe(true);

      // Both the outer pid AND the grandchild must be gone (taskkill /T).
      await waitForPidGoneWindows(job.pid);
      await waitForPidGoneWindows(grandchildPid);
    } finally {
      fs.rmSync(markerDir, { recursive: true, force: true });
    }
  });

  it('fails a job whose log exceeds the cap', async () => {
    const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-cap-'));
    const capManager = new ShellJobManager({
      baseDir: capDir,
      logMaxBytes: 512,
    });
    try {
      const job = capManager.launch({
        command:
          "1..10000 | ForEach-Object { Write-Output ('x' * 80) }; Start-Sleep -Seconds 8",
        cwd: os.tmpdir(),
      });
      const terminal = await waitForTerminal(capManager, job.id, 15000);

      expect(terminal).toBeDefined();
      expect(terminal?.state).toBe('failed');
      expect(terminal?.failureReason).toContain('exceeded cap');
    } finally {
      await capManager.dispose();
    }
  });

  it('disposes all running jobs without survivors', async () => {
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-dispose-'));
    const grandchildMarker = path.join(markerDir, 'gc.pid');
    try {
      const escapedMarker = grandchildMarker.replace(/'/g, "''");
      const command =
        'Start-Process -FilePath powershell.exe ' +
        `-ArgumentList @('-NoProfile','-Command','$PID | Out-File -FilePath ''${escapedMarker}'' -Encoding ASCII; Start-Sleep -Seconds 60') ` +
        '-WindowStyle Hidden -PassThru | Out-Null; ' +
        'Start-Sleep -Seconds 60';

      const job = manager.launch({ command, cwd: os.tmpdir() });
      await waitForPidStateWindows(job.pid, true, 5000);

      // No fixed sleep here: waitForPidFile polls every 200ms and only returns
      // once the marker parses as a positive PID, so a created-but-unwritten
      // file keeps polling. Its 10s deadline gives more headroom than a fixed
      // wait while keeping the fast path fast.
      const grandchildPid = await waitForPidFile(grandchildMarker, 10000);
      expect(isPidAliveWindows(grandchildPid)).toBe(true);

      await manager.dispose();

      await waitForPidGoneWindows(job.pid);
      await waitForPidGoneWindows(grandchildPid);
    } finally {
      fs.rmSync(markerDir, { recursive: true, force: true });
    }
  });

  it('cancel does not hang when taskkill fails (bounded cancel)', async () => {
    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-bounded-'));
    // The injected always-fail taskkill means the manager never reaps the
    // tree, so the INNER PowerShell (which owns the redirected log handles)
    // survives. Capture it via a marker so teardown reaps both outer + inner.
    const innerMarker = path.join(failDir, 'inner.pid');
    let survivorPid = 0;
    let innerPid = 0;
    const failManager = new ShellJobManager({
      baseDir: failDir,
      taskkillImpl: async () => ({
        ok: false,
        error: new Error('Injected taskkill failure'),
      }),
    });
    try {
      const job = failManager.launch({
        command: buildInnerPidMarkerCommand(innerMarker),
        cwd: os.tmpdir(),
      });
      survivorPid = job.pid ?? 0;
      expect(survivorPid).toBeGreaterThan(0);
      innerPid = await readInnerPidFromMarker(innerMarker, 10000);
      expect(innerPid).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const start = Date.now();
      const result = await failManager.cancel(job.id);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10000);
      expect(result).toBe(true);

      const terminal = failManager.get(job.id);
      expect(terminal?.state).toBe('cancelled');
    } finally {
      // dispose() rejects with ShellJobDisposalError by design when the
      // injected always-fail taskkill leaves survivors. Deterministic cleanup
      // still reaps both process layers before accepting that expected error.
      await disposeAndCleanupWindowsTest(
        failDir,
        failManager,
        [survivorPid, innerPid],
        true,
      );
    }
    // Waiting for the inner PowerShell marker alone allows up to 10s, so the
    // 5s default timeout could never cover this test on a loaded machine.
  }, 30000);

  // --- G1/H4: dispose must not kill unrelated processes via PID reuse ---
  // Re-expressed against the PURE reap-eligibility helper (no production
  // mutator of kill-critical state). dispose only reaps survivors whose
  // ORIGINAL child handle is still running, so a numeric pid that was reused
  // by an unrelated process is never targeted.

  it('never reaps a survivor whose original child has exited (PID-reuse safe)', async () => {
    // A short-lived child that has already exited.
    const exited = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', 'exit 0'],
      { windowsHide: true, stdio: 'ignore' },
    );
    await new Promise<void>((resolve) => {
      exited.on('exit', () => resolve());
    });
    const exitedEntry: SurvivorEntry = {
      child: exited,
      pid: exited.pid,
    };
    expect(survivorNeedsReap(exitedEntry)).toBe(false);

    // A long-lived child that is still running.
    const live = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Start-Sleep -Seconds 120'],
      { windowsHide: true, stdio: 'ignore' },
    );
    live.unref();
    try {
      expect(live.pid).toBeGreaterThan(0);
      const liveEntry: SurvivorEntry = { child: live, pid: live.pid ?? 0 };
      expect(survivorNeedsReap(liveEntry)).toBe(true);
    } finally {
      spawnSync('taskkill', ['/pid', String(live.pid), '/f', '/t'], {
        timeout: 5000,
      });
    }
  });
  // --- G2: bounded taskkill and cap poll safety ---

  it('dispose does not hang when taskkill never settles (G2)', async () => {
    const hangDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-hang-'));
    // A never-settling taskkill means the manager never reaps the tree, so the
    // INNER PowerShell (which owns the redirected log handles) survives.
    // Capture it via a marker so teardown reaps both outer + inner.
    const innerMarker = path.join(hangDir, 'inner.pid');
    const hangManager = new ShellJobManager({
      baseDir: hangDir,
      taskkillImpl: (): Promise<TaskkillResult> => new Promise(() => {}),
    });
    let pid = 0;
    let innerPid = 0;
    try {
      const job = hangManager.launch({
        command: buildInnerPidMarkerCommand(innerMarker),
        cwd: os.tmpdir(),
      });
      pid = job.pid ?? 0;
      // Fail fast rather than proceeding with pid 0, which the guarded cleanup
      // helpers would silently skip.
      expect(pid).toBeGreaterThan(0);
      innerPid = await readInnerPidFromMarker(innerMarker, 10000);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const start = Date.now();
      // With a never-settling taskkill, the survivor remains alive and
      // dispose() correctly rejects with ShellJobDisposalError. The timing
      // bound must still hold (bounded kill timeout + verification rounds).
      await expect(hangManager.dispose()).rejects.toBeInstanceOf(
        ShellJobDisposalError,
      );
      const elapsed = Date.now() - start;

      // Must complete in bounded time, not hang forever.
      expect(elapsed).toBeLessThan(20000);
    } finally {
      await reapAndRemoveWindowsTestDir(hangDir, hangManager, [pid, innerPid]);
    }
  }, 30000);

  it('does not start overlapping cap polls when taskkill is slow (G2)', async () => {
    let killCallCount = 0;
    const slowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-slow-'));
    const innerMarker = path.join(slowDir, 'inner.pid');
    const slowManager = new ShellJobManager({
      baseDir: slowDir,
      logMaxBytes: 256,
      taskkillImpl: async (targetPid: number): Promise<TaskkillResult> => {
        killCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return boundedTaskkill(targetPid);
      },
    });
    let pid = 0;
    let innerPid = 0;
    try {
      const job = slowManager.launch({
        command: buildInnerPidMarkerCommand(
          innerMarker,
          15,
          "1..10000 | ForEach-Object { Write-Output ('x' * 80) }",
        ),
        cwd: os.tmpdir(),
      });
      pid = job.pid ?? 0;
      // Fail fast rather than proceeding with pid 0, which the guarded cleanup
      // helpers would silently skip.
      expect(pid).toBeGreaterThan(0);
      innerPid = await readInnerPidFromMarker(innerMarker, 10000);

      // Wait for the cap to be exceeded and at least one poll to fire.
      await waitForTerminal(slowManager, job.id, 20000);
      // Allow time for potential overlapping polls.
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // taskkill must be called exactly once — serialized polls prevent overlap.
      expect(killCallCount).toBe(1);
    } finally {
      await disposeAndCleanupWindowsTest(slowDir, slowManager, [pid, innerPid]);
    }
  }, 45000);

  it('reclaims the budget slot when spawnWindowsBackground throws synchronously (A1)', async () => {
    // A manager with capacity 1: a leaked slot would make the second launch fail.
    const reclaimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-reclaim-'));
    const reclaimManager = new ShellJobManager({
      baseDir: reclaimDir,
      maxBackgroundJobs: 1,
    });
    // A NUL byte in cwd makes child_process.spawn throw synchronously with
    // ERR_INVALID_ARG_VALUE (validated before the process is created). A
    // merely nonexistent directory does NOT throw synchronously - it surfaces
    // asynchronously as an 'error' event - so it cannot exercise this guard.
    const invalidCwd = reclaimDir + '\u0000invalid';
    try {
      // The reservation is taken in launch() before spawnWindowsBackground is
      // called, so the synchronous throw must be caught and the slot released.
      expect(() =>
        reclaimManager.launch({
          command: 'Write-Output nope',
          cwd: invalidCwd,
        }),
      ).toThrow(/null bytes/);

      // The budget was reclaimed, so a subsequent launch with a valid cwd
      // succeeds — proving the slot was not permanently consumed.
      const job = reclaimManager.launch({
        command: "Write-Output 'reclaimed'",
        cwd: os.tmpdir(),
      });
      expect(job.state).toBe('running');

      const terminal = await waitForTerminal(reclaimManager, job.id);
      expect(terminal?.state).toBe('completed');
      expect(terminal?.exitCode).toBe(0);
    } finally {
      await disposeAndCleanupWindowsTest(reclaimDir, reclaimManager, []);
    }
  });
});
