/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral tests for the cross-process janitor lease (AC-6).
 *
 * Tests use real temporary filesystems and real subprocess competition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { JanitorLease } from './janitorLease.js';
import type { JanitorLeaseHandle } from './janitorLease.js';

const bunIt = it;

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-lease-'));
}

/**
 * Tracks any lease acquired by a test so afterEach can reliably release it
 * (and stop the heartbeat timer) even if an assertion throws before the
 * test's own release call.
 */
let trackedLease: JanitorLeaseHandle | null = null;

describe('JanitorLease — shared cleanup', () => {
  afterEach(async () => {
    if (trackedLease) {
      await trackedLease.release().catch(() => {});
      trackedLease = null;
    }
  });

  describe('JanitorLease — single-process acquisition', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await makeTempDir();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('acquires a lease when no lease exists', async () => {
      const lease = await JanitorLease.tryAcquire(tempDir);
      expect(lease).not.toBeNull();
      trackedLease = lease;
      await lease!.release();
      trackedLease = null;
    });

    it('returns null when a lease is already held (skip-on-busy)', async () => {
      const lease1 = await JanitorLease.tryAcquire(tempDir);
      expect(lease1).not.toBeNull();
      trackedLease = lease1;

      const lease2 = await JanitorLease.tryAcquire(tempDir);
      expect(lease2).toBeNull();

      await lease1!.release();
      trackedLease = null;
    });

    it('releases the lease so another process can acquire', async () => {
      const lease1 = await JanitorLease.tryAcquire(tempDir);
      expect(lease1).not.toBeNull();
      trackedLease = lease1;
      await lease1!.release();
      trackedLease = null;

      const lease2 = await JanitorLease.tryAcquire(tempDir);
      expect(lease2).not.toBeNull();
      trackedLease = lease2;
      await lease2!.release();
      trackedLease = null;
    });

    it("owner-checked release does not remove another owner's lease", async () => {
      const lease1 = await JanitorLease.tryAcquire(tempDir);
      expect(lease1).not.toBeNull();
      trackedLease = lease1;

      // Simulate another process writing a different lease file.
      const leasePath = path.join(tempDir, '.llxprt-janitor.lease');
      const content = JSON.stringify({
        ownerToken: 'different-owner-token',
        pid: 999999,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      });
      await fs.writeFile(leasePath, content);

      // Release lease1 — should NOT remove the replacement.
      await lease1!.release();
      trackedLease = null;

      // The replacement lease file should still exist.
      const afterContent = await fs.readFile(leasePath, 'utf-8');
      expect(JSON.parse(afterContent).ownerToken).toBe('different-owner-token');
    });

    {
      const it =
        process.platform === 'win32' || process.getuid?.() === 0
          ? bunIt.skip
          : bunIt;
      it('tryAcquire propagates I/O errors instead of masking them as busy', async () => {
        // Make the temp dir read-only so temp-file creation fails with EACCES.
        await fs.chmod(tempDir, 0o555);
        try {
          let threw = false;
          try {
            await JanitorLease.tryAcquire(tempDir);
          } catch {
            threw = true;
          }
          // A genuine I/O error must propagate — not be swallowed as null (busy).
          expect(threw).toBe(true);
        } finally {
          await fs.chmod(tempDir, 0o755);
        }
      });
    }
  });

  describe('JanitorLease — stale recovery', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await makeTempDir();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('takes over a stale lease from a dead PID', async () => {
      const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

      // Write a stale lease with a dead PID.
      const oldTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await fs.writeFile(
        leasePath,
        JSON.stringify({
          ownerToken: 'stale-token',
          pid: 999999, // Almost certainly dead.
          hostname: os.hostname(),
          createdAt: oldTime,
          heartbeatAt: oldTime,
        }),
      );

      // Should be able to acquire.
      const lease = await JanitorLease.tryAcquire(tempDir);
      expect(lease).not.toBeNull();
      trackedLease = lease;
      await lease!.release();
      trackedLease = null;
    });

    it('does not take over a lease with a live PID and recent heartbeat', async () => {
      const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

      // Write a live lease using our own PID.
      await fs.writeFile(
        leasePath,
        JSON.stringify({
          ownerToken: 'live-token',
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        }),
      );

      // Should NOT be able to acquire — lease is live.
      const lease = await JanitorLease.tryAcquire(tempDir);
      expect(lease).toBeNull();
    });

    it('takes over a lease with a live PID but stale heartbeat exceeding the absolute PID-reuse bound', async () => {
      const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

      // Write a lease with our PID but createdAt/heartbeatAt far beyond the
      // absolute PID-reuse bound (2 hours).  Even though the PID is alive,
      // the absolute bound ensures the lease is reclaimable.
      const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      await fs.writeFile(
        leasePath,
        JSON.stringify({
          ownerToken: 'frozen-token',
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: staleTime,
          heartbeatAt: staleTime,
        }),
      );

      // Should be able to acquire — exceeds the absolute PID-reuse bound.
      const lease = await JanitorLease.tryAcquire(tempDir);
      expect(lease).not.toBeNull();
      trackedLease = lease;
      await lease!.release();
      trackedLease = null;
    });

    it('does NOT take over a live-PID lease with stale heartbeat within the PID-reuse bound', async () => {
      const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

      // Heartbeat is stale (60 min > 10 min) but PID is alive and createdAt
      // is within the 2-hour PID-reuse bound.
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await fs.writeFile(
        leasePath,
        JSON.stringify({
          ownerToken: 'alive-frozen',
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: staleTime,
          heartbeatAt: staleTime,
        }),
      );

      // Should NOT be able to acquire — PID is alive and within PID-reuse bound.
      const lease = await JanitorLease.tryAcquire(tempDir);
      expect(lease).toBeNull();
    });
  });

  describe('JanitorLease — real subprocess concurrency (AC-6)', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await makeTempDir();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('exactly one of two concurrent subprocesses wins the lease', async () => {
      // Fully parent-coordinated contention: each subprocess signals READY,
      // spin-waits for a start barrier, then races to acquire.  The winner
      // prints WON immediately and holds the lease until a distinct release
      // barrier appears; the loser prints SKIP.  The parent waits until each
      // child reports WON or SKIP, asserts exactly one winner, then publishes
      // the release barrier and awaits clean completion.  Child exceptions
      // write stderr and exit nonzero — they never masquerade as SKIP.
      const startBarrierPath = path.join(tempDir, '.start-barrier');
      const releaseBarrierPath = path.join(tempDir, '.release-barrier');
      const script = `
      const { JanitorLease } = require(${JSON.stringify(path.resolve(__dirname, 'janitorLease.js'))});
      const fs = require('fs');
      const tempDir = process.env.TEST_TEMP_DIR;
      const startBarrier = process.env.TEST_START_BARRIER;
      const releaseBarrier = process.env.TEST_RELEASE_BARRIER;
      (async () => {
        try {
          process.stdout.write('READY');
          const startDeadline = Date.now() + 15000;
          while (!fs.existsSync(startBarrier)) {
            if (Date.now() > startDeadline) { process.stdout.write('TIMEOUT'); return; }
            await new Promise(r => setTimeout(r, 5));
          }
          const lease = await JanitorLease.tryAcquire(tempDir);
          if (lease) {
            process.stdout.write('WON');
            // Hold the lease until the parent publishes the release barrier.
            const releaseDeadline = Date.now() + 15000;
            while (!fs.existsSync(releaseBarrier)) {
              if (Date.now() > releaseDeadline) {
                await lease.release();
                process.stderr.write('release barrier timeout');
                process.exit(1);
              }
              await new Promise(r => setTimeout(r, 5));
            }
            await lease.release();
          } else {
            process.stdout.write('SKIP');
          }
        } catch (e) {
          process.stderr.write(String(e && e.stack ? e.stack : e));
          process.exit(1);
        }
      })();
    `;

      const childEnv = {
        TEST_TEMP_DIR: tempDir,
        TEST_START_BARRIER: startBarrierPath,
        TEST_RELEASE_BARRIER: releaseBarrierPath,
      };
      const managed = [
        spawnManagedChild(script, childEnv),
        spawnManagedChild(script, childEnv),
      ];

      try {
        // Wait for both subprocesses to reach the start-barrier spin-wait.
        await Promise.all(managed.map((m) => waitForManagedSignal(m, 'READY')));

        // Release the start barrier — both attempt concurrently.
        await fs.writeFile(startBarrierPath, 'go');

        // Wait until each child reports WON or SKIP (before any release).
        const reportPromises = managed.map((m) =>
          waitForManagedSignal(m, ['WON', 'SKIP']),
        );
        const reports = await Promise.all(reportPromises);

        // Assert exactly one winner.
        const winners = reports.filter((r) => r === 'WON');
        expect(winners.length).toBe(1);

        // Publish the release barrier so the winner can release and exit.
        await fs.writeFile(releaseBarrierPath, 'go');

        // Await clean completion of both children.
        await Promise.all(managed.map((m) => awaitManagedCompletion(m)));
      } finally {
        await Promise.all(managed.map((m) => killManagedChild(m)));
      }
    }, 30000);
  });

  /**
   * A spawned child with accumulated stdout/stderr buffers.
   */
  interface ManagedChild {
    readonly child: ChildProcessWithoutNullStreams;
    stdout: string;
    stderr: string;
  }

  /**
   * Spawn a child script, collecting stdout and stderr into mutable buffers.
   */
  function spawnManagedChild(
    code: string,
    env: Record<string, string>,
  ): ManagedChild {
    // `process.execPath` rather than the bare string 'bun': Node's spawn does
    // not apply PATHEXT resolution on Windows unless `shell: true`, so a literal
    // 'bun' never resolves to bun.exe and the child dies before emitting READY.
    // Under bun:test execPath is the running bun binary, so this is both correct
    // and portable.
    const child = spawn(process.execPath, ['-e', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const managed: ManagedChild = { child, stdout: '', stderr: '' };
    child.stdout.on('data', (d) => (managed.stdout += d.toString()));
    child.stderr.on('data', (d) => (managed.stderr += d.toString()));
    return managed;
  }

  /**
   * Find the first of the candidate markers present in stdout, or null.
   */
  function findMarker(
    stdout: string,
    markers: readonly string[],
  ): string | null {
    for (const m of markers) {
      if (stdout.includes(m)) return m;
    }
    return null;
  }

  /**
   * Wait for one of the candidate markers on the child's stdout.  Resolves
   * with the matched marker.  Rejects with captured stderr on timeout or
   * unexpected exit so failures are diagnosable.  Handles already-exited
   * children and 'error' events, and cleans up all listeners/timers on every
   * settle path.
   */
  function waitForManagedSignal(
    managed: ManagedChild,
    markers: string | readonly string[],
    timeoutMs = 10000,
  ): Promise<string> {
    const candidates = Array.isArray(markers) ? markers : [markers];
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        managed.child.stdout.off('data', onData);
        managed.child.off('close', onClose);
        managed.child.off('error', onError);
      };
      const succeed = (match: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(match);
      };
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      };

      const timer = setTimeout(
        () =>
          fail(
            `Timeout waiting for ${JSON.stringify(candidates)}
stderr: ${managed.stderr}`,
          ),
        timeoutMs,
      );
      const onData = (_d: Buffer): void => {
        const match = findMarker(managed.stdout, candidates);
        if (match) succeed(match);
      };
      const onClose = (): void => {
        const match = findMarker(managed.stdout, candidates);
        if (match) succeed(match);
        else
          fail(
            `Child exited before ${JSON.stringify(candidates)}
stderr: ${managed.stderr}`,
          );
      };
      const onError = (err: Error): void => {
        fail(
          `Child error before ${JSON.stringify(candidates)}: ${err.message}
stderr: ${managed.stderr}`,
        );
      };

      // Handle a child that already emitted the marker or already exited.
      const early = findMarker(managed.stdout, candidates);
      if (early) {
        succeed(early);
        return;
      }
      if (
        managed.child.exitCode !== null ||
        managed.child.signalCode !== null
      ) {
        fail(
          `Child already exited before ${JSON.stringify(candidates)}
stderr: ${managed.stderr}`,
        );
        return;
      }

      managed.child.stdout.on('data', onData);
      managed.child.on('close', onClose);
      managed.child.on('error', onError);
    });
  }

  /**
   * Resolve with the child's stdout when it exits cleanly (code 0).  Handles
   * already-exited children and 'error' events; cleans up listeners/timers on
   * every settle path via a single `settle` continuation guard.
   */
  function awaitManagedCompletion(
    managed: ManagedChild,
    timeoutMs = 20000,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        managed.child.off('close', onClose);
        managed.child.off('error', onError);
        action();
      };

      const timer = setTimeout(
        () =>
          settle(() =>
            reject(
              new Error(`Completion timeout
stderr: ${managed.stderr}`),
            ),
          ),
        timeoutMs,
      );
      const onClose = (code: number | null): void => {
        if (code === 0) settle(() => resolve(managed.stdout));
        else
          settle(() =>
            reject(
              new Error(`Exit ${code}
stderr: ${managed.stderr}`),
            ),
          );
      };
      const onError = (err: Error): void => {
        settle(() =>
          reject(
            new Error(`Child error: ${err.message}
stderr: ${managed.stderr}`),
          ),
        );
      };

      // Handle a child that already exited before attachment.
      if (
        managed.child.exitCode !== null ||
        managed.child.signalCode !== null
      ) {
        if (managed.child.exitCode === 0) settle(() => resolve(managed.stdout));
        else
          settle(() =>
            reject(
              new Error(
                `Already exited with ${managed.child.exitCode ?? managed.child.signalCode}
stderr: ${managed.stderr}`,
              ),
            ),
          );
        return;
      }

      managed.child.on('close', onClose);
      managed.child.on('error', onError);
    });
  }

  /**
   * Ensure a spawned child is terminated and its exit awaited, regardless of
   * test outcome.  Idempotent.  Sends SIGTERM to the exact child only;
   * escalates to SIGKILL if the child does not close within a grace period;
   * awaits the 'close' event in both cases.  Fails (rejects) with diagnostics
   * if even SIGKILL cannot produce an observed close.
   */
  async function killManagedChild(managed: ManagedChild): Promise<void> {
    const { child } = managed;
    if (child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onClose = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(escalationTimer);
        child.off('close', onClose);
        resolve();
      };
      child.on('close', onClose);

      const escalationTimer = setTimeout(() => {
        if (settled) return;
        // SIGTERM grace period elapsed without close — escalate to SIGKILL on
        // the exact child.
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore — fall through to final guard
        }
        // Final guard: if SIGKILL also fails to produce a close, fail loudly.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          child.off('close', onClose);
          reject(
            new Error(
              `killManagedChild: child (pid=${child.pid}) did not close after SIGKILL`,
            ),
          );
        }, 5000);
      }, 2000);

      try {
        child.kill('SIGTERM');
      } catch {
        settled = true;
        clearTimeout(escalationTimer);
        child.off('close', onClose);
        resolve();
      }
    });
  }
});
