/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ShellJobManager, ShellJobDisposalError } from './shellJobManager.js';
import type { ShellJob } from './shellJobManager.js';
import { boundedTaskkill, type TaskkillResult } from './shellProcessKill.js';
import {
  buildInnerPidMarkerCommand,
  reapAndRemoveWindowsTestDir,
  readInnerPidFromMarker,
} from '../../test/utils/shellJobTestCleanup.js';

function isPidAliveWindows(pid: number): boolean {
  const result = spawnSync(
    'tasklist',
    ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
    { encoding: 'utf8', timeout: 5000 },
  );
  return result.stdout.includes(String(pid));
}

async function waitForPidStateWindows(
  pid: number,
  alive: boolean,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidAliveWindows(pid) === alive) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `PID ${pid} did not become ${alive ? 'alive' : 'gone'} within ${timeoutMs}ms`,
  );
}

async function waitForPidGoneWindows(
  pid: number,
  timeoutMs = 10000,
): Promise<void> {
  await waitForPidStateWindows(pid, false, timeoutMs);
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

// These tests are Windows-only: they depend on tasklist/taskkill for process
// inspection and tree-kill, and on PowerShell (Start-Process, Start-Sleep)
// process semantics that do not exist on POSIX.
describe.skipIf(os.platform() !== 'win32')(
  'ShellJobManager survivors on Windows',
  () => {
    // --- H2: survivor state is non-evictable (orphan-safe) ---

    it('dispose still reaps a survivor after retention evicts its job context (H2)', async () => {
      const h2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2-survivor-'));
      let killCalls = 0;
      const h2Manager = new ShellJobManager({
        baseDir: h2Dir,
        maxBackgroundJobs: 1,
        taskkillImpl: (pid: number): Promise<TaskkillResult> => {
          killCalls++;
          if (killCalls === 1) {
            return Promise.resolve({
              ok: false,
              error: new Error('Injected cancel-time failure'),
            });
          }
          return boundedTaskkill(pid);
        },
      });
      let survivorPid = 0;
      try {
        const jobA = h2Manager.launch({
          command: 'Start-Sleep -Seconds 300',
          cwd: os.tmpdir(),
        });
        survivorPid = jobA.pid;
        await new Promise((resolve) => setTimeout(resolve, 500));

        await h2Manager.cancel(jobA.id);
        expect(h2Manager.get(jobA.id)?.state).toBe('cancelled');
        await waitForPidStateWindows(survivorPid, true, 5000);

        // Fill retention (historyLimit = 1*2 = 2) so the survivor's context is
        // evicted from `jobs` while its survivor entry persists.
        const jobB = h2Manager.launch({
          command: "Write-Output 'b'",
          cwd: os.tmpdir(),
        });
        await waitForTerminal(h2Manager, jobB.id);
        const jobC = h2Manager.launch({
          command: "Write-Output 'c'",
          cwd: os.tmpdir(),
        });
        await waitForTerminal(h2Manager, jobC.id);
        h2Manager.markNotified([jobA.id, jobB.id, jobC.id]);

        expect(h2Manager.get(jobA.id)).toBeUndefined();
        await waitForPidStateWindows(survivorPid, true, 5000);

        await h2Manager.dispose();

        await waitForPidGoneWindows(survivorPid, 10000);
        expect(isPidAliveWindows(survivorPid)).toBe(false);
        survivorPid = 0;
      } finally {
        await reapAndRemoveWindowsTestDir(h2Dir, h2Manager, [survivorPid]);
      }
    }, 45000);

    // --- H3: a throwing / rejecting taskkillImpl never escapes ---

    it('cancel and dispose complete cleanup when taskkillImpl throws synchronously (H3)', async () => {
      const h3Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-sync-throw-'));
      // A throwing taskkill means the manager never reaps the tree, so the
      // INNER PowerShell (which owns the redirected log handles) survives.
      const innerMarker = path.join(h3Dir, 'inner.pid');
      const h3Manager = new ShellJobManager({
        baseDir: h3Dir,
        taskkillImpl: (): Promise<TaskkillResult> => {
          throw new Error('synchronous throw');
        },
      });
      let survivorPid = 0;
      let innerPid = 0;
      let rejectionSeen = false;
      const onRejection = (): void => {
        rejectionSeen = true;
      };
      process.on('unhandledRejection', onRejection);
      try {
        const job = h3Manager.launch({
          command: buildInnerPidMarkerCommand(innerMarker),
          cwd: os.tmpdir(),
        });
        survivorPid = job.pid;
        innerPid = await readInnerPidFromMarker(innerMarker, 10000);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const result = await h3Manager.cancel(job.id);
        expect(result).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(rejectionSeen).toBe(false);

        // dispose() now rejects because the survivor's kill fails. The
        // rejection is expected and must not cause an unhandled rejection.
        await expect(h3Manager.dispose()).rejects.toBeInstanceOf(
          ShellJobDisposalError,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(rejectionSeen).toBe(false);
      } finally {
        process.off('unhandledRejection', onRejection);
        await reapAndRemoveWindowsTestDir(h3Dir, h3Manager, [
          survivorPid,
          innerPid,
        ]);
      }
    }, 30000);

    it('cancel and dispose complete cleanup when taskkillImpl returns a rejected promise (H3)', async () => {
      const h3Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-reject-'));
      // A rejecting taskkill means the manager never reaps the tree, so the
      // INNER PowerShell (which owns the redirected log handles) survives.
      const innerMarker = path.join(h3Dir, 'inner.pid');
      const h3Manager = new ShellJobManager({
        baseDir: h3Dir,
        taskkillImpl: (): Promise<TaskkillResult> =>
          Promise.reject(new Error('rejected promise')),
      });
      let survivorPid = 0;
      let innerPid = 0;
      let rejectionSeen = false;
      const onRejection = (): void => {
        rejectionSeen = true;
      };
      process.on('unhandledRejection', onRejection);
      try {
        const job = h3Manager.launch({
          command: buildInnerPidMarkerCommand(innerMarker),
          cwd: os.tmpdir(),
        });
        survivorPid = job.pid;
        innerPid = await readInnerPidFromMarker(innerMarker, 10000);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const result = await h3Manager.cancel(job.id);
        expect(result).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(rejectionSeen).toBe(false);

        // dispose() now rejects because the survivor's kill fails. The
        // rejection is expected and must not cause an unhandled rejection.
        await expect(h3Manager.dispose()).rejects.toBeInstanceOf(
          ShellJobDisposalError,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(rejectionSeen).toBe(false);
      } finally {
        process.off('unhandledRejection', onRejection);
        await reapAndRemoveWindowsTestDir(h3Dir, h3Manager, [
          survivorPid,
          innerPid,
        ]);
      }
    }, 30000);

    // --- H5: survivor reaping is concurrent, not sequential ---

    it('reaps multiple survivors concurrently (bounded by one kill timeout, not N) (H5)', async () => {
      const h5Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5-concurrent-'));
      // A never-settling taskkill means the manager never reaps the trees, so
      // each job's INNER PowerShell (which owns the redirected log handles)
      // survives. Capture each via a unique marker so teardown reaps all
      // outer + inner pids.
      const h5Manager = new ShellJobManager({
        baseDir: h5Dir,
        maxBackgroundJobs: 5,
        taskkillImpl: (): Promise<TaskkillResult> => new Promise(() => {}),
      });
      const survivorPids: number[] = [];
      const innerPids: number[] = [];
      const innerMarkers: string[] = [];
      try {
        for (let i = 0; i < 3; i++) {
          const marker = path.join(h5Dir, `inner-${i}.pid`);
          innerMarkers.push(marker);
          const job = h5Manager.launch({
            command: buildInnerPidMarkerCommand(marker),
            cwd: os.tmpdir(),
          });
          survivorPids.push(job.pid);
        }
        for (const marker of innerMarkers) {
          innerPids.push(await readInnerPidFromMarker(marker, 10000));
        }
        await new Promise((resolve) => setTimeout(resolve, 800));

        const start = Date.now();
        // dispose() now rejects because survivors remain alive (taskkill
        // never resolves). The rejection is expected; the timing bound must
        // still hold.
        await expect(h5Manager.dispose()).rejects.toBeInstanceOf(
          ShellJobDisposalError,
        );
        const elapsed = Date.now() - start;

        // 3 survivors. Cancel phase ≈ 5s (concurrent). Reap phase must be ≈ 5s
        // (concurrent) plus 2×300ms verification, NOT 3×5s (sequential).
        // Concurrent ≈ 11s; sequential would be ≈ 5s + 15s + 0.6s ≈ 20.6s. The
        // bound sits between the two with headroom on both sides so a loaded
        // CI machine cannot flake it while still failing a sequential reap.
        expect(elapsed).toBeLessThan(16000);
      } finally {
        await reapAndRemoveWindowsTestDir(h5Dir, h5Manager, [
          ...survivorPids,
          ...innerPids,
        ]);
      }
    }, 45000);

    // --- I2: survivor whose kill FAILS causes dispose to reject ---

    it('dispose rejects with ShellJobDisposalError when kill always fails (I2)', async () => {
      const i2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i2-fail-survivor-'));
      // An always-fail taskkill means the manager never reaps the tree, so the
      // INNER PowerShell (which owns the redirected log handles) survives.
      const innerMarker = path.join(i2Dir, 'inner.pid');
      const i2Manager = new ShellJobManager({
        baseDir: i2Dir,
        maxBackgroundJobs: 1,
        taskkillImpl: (): Promise<TaskkillResult> =>
          Promise.resolve({
            ok: false,
            error: new Error('Injected always-fail kill'),
          }),
      });
      let survivorPid = 0;
      let innerPid = 0;
      let survivorLogPath = '';
      try {
        const job = i2Manager.launch({
          command: buildInnerPidMarkerCommand(innerMarker),
          cwd: os.tmpdir(),
        });
        survivorPid = job.pid;
        survivorLogPath = path.join(i2Dir, `${job.id}.log`);
        innerPid = await readInnerPidFromMarker(innerMarker, 10000);
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Cancel times out (kill fails) → survivor added.
        await i2Manager.cancel(job.id);
        await waitForPidStateWindows(survivorPid, true, 5000);

        // Dispose tries to reap but the kill always fails. dispose() must
        // REJECT with ShellJobDisposalError naming the surviving job id, its
        // pid, and the taskkill /T /F /PID remediation command.
        let caughtError: unknown;
        try {
          await i2Manager.dispose();
        } catch (e) {
          caughtError = e;
        }
        expect(caughtError).toBeInstanceOf(ShellJobDisposalError);
        if (!(caughtError instanceof ShellJobDisposalError)) {
          throw new Error('Expected ShellJobDisposalError');
        }
        const survivor = caughtError.survivors[0];
        expect(survivor.id).toBe(job.id);
        expect(survivor.pid).toBe(survivorPid);
        expect(survivor.remediation).toContain('taskkill /T /F /PID');

        // Survivor tracking retained so the live process tree is not orphaned.
        expect(i2Manager.getLiveSurvivorCount()).toBe(1);
        await waitForPidStateWindows(survivorPid, true, 5000);

        // Survivor's log file is NOT deleted during the failed dispose.
        expect(fs.existsSync(survivorLogPath)).toBe(true);
      } finally {
        await reapAndRemoveWindowsTestDir(i2Dir, i2Manager, [
          survivorPid,
          innerPid,
        ]);
      }
    }, 30000);

    // --- Lifecycle gate: launch() cannot race dispose() ---

    it('launch() throws synchronously when dispose() has begun (lifecycle gate)', async () => {
      const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-launch-'));
      const gateManager = new ShellJobManager({ baseDir: gateDir });
      let survivorPid = 0;
      try {
        const job = gateManager.launch({
          command: 'Start-Sleep -Seconds 300',
          cwd: os.tmpdir(),
        });
        survivorPid = job.pid;
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Start disposal WITHOUT awaiting. The public dispose() sets the
        // lifecycle gate synchronously before its first await.
        const disposalPromise = gateManager.dispose();

        // Synchronously attempt to launch — must throw immediately, before
        // any budget reservation or log open.
        expect(() =>
          gateManager.launch({
            command: "Write-Output 'should-not-run'",
            cwd: os.tmpdir(),
          }),
        ).toThrow(
          'Cannot launch a background job: ShellJobManager is disposing or disposed.',
        );

        // Await the disposal (tolerating ShellJobDisposalError on Windows
        // if the kill is slow).
        await disposalPromise.catch(() => {
          // Survivor disposal may reject — acceptable here.
        });
        // Do NOT zero survivorPid: dispose may have failed to reap the
        // survivor, and zeroing would discard the only known PID. Only
        // discard ownership after cleanup proves exit (in finally).
      } finally {
        await reapAndRemoveWindowsTestDir(gateDir, gateManager, [survivorPid]);
      }
    }, 30000);

    it('dispose() is idempotent — both calls return the identical promise (work runs once)', async () => {
      const idemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-dispose-'));
      const idemManager = new ShellJobManager({ baseDir: idemDir });
      try {
        const first = idemManager.dispose();
        const second = idemManager.dispose();

        // Both calls return the IDENTICAL promise — the underlying disposal
        // work runs exactly once.
        expect(second).toBe(first);

        // Both settle the same way (both resolve here since no jobs).
        await first;
        await second;
      } finally {
        await reapAndRemoveWindowsTestDir(idemDir, idemManager, []);
      }
    });

    it('launch() from a microtask scheduled during disposal also throws', async () => {
      const microDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micro-launch-'));
      const microManager = new ShellJobManager({ baseDir: microDir });
      let survivorPid = 0;
      let microError: Error | undefined;
      try {
        const job = microManager.launch({
          command: 'Start-Sleep -Seconds 300',
          cwd: os.tmpdir(),
        });
        survivorPid = job.pid;
        await new Promise((resolve) => setTimeout(resolve, 500));

        const disposalPromise = microManager.dispose();

        // A microtask scheduled via Promise.then runs AFTER the current
        // synchronous block but before any macrotask. The lifecycle gate is
        // already set synchronously by dispose(), so launch() must throw.
        await Promise.resolve().then(() => {
          try {
            microManager.launch({
              command: "Write-Output 'should-not-run'",
              cwd: os.tmpdir(),
            });
          } catch (e) {
            if (e instanceof Error) microError = e;
          }
        });

        expect(microError).toBeDefined();
        expect(microError?.message).toBe(
          'Cannot launch a background job: ShellJobManager is disposing or disposed.',
        );

        await disposalPromise.catch(() => {
          // Survivor disposal may reject — acceptable here.
        });
        // Do NOT zero survivorPid: dispose may have failed to reap.
        // Only discard ownership after cleanup proves exit (in finally).
      } finally {
        await reapAndRemoveWindowsTestDir(microDir, microManager, [
          survivorPid,
        ]);
      }
    }, 30000);
  },
);
