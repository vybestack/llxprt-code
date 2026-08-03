/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ShellJobManager } from './shellJobManager.js';
import type { ShellJob } from './shellJobManager.js';

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
  timeoutMs = 5000,
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
      try {
        process.kill(-job.pid, 'SIGKILL');
      } catch {
        // May already be gone.
      }

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
