/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle / concurrency behavioral tests for PerfRetention (P08).
 *
 * Covers the lifecycle defects surfaced in independent source inspection:
 *  D-LC-1: dispose actually cancels the interval (clear), not merely nulls the
 *          handle. Proven with an auto-firing scheduler that would keep firing
 *          unless clear() is invoked.
 *  D-LC-2: dispose awaits an in-flight tick before unlinking the claim. Proven
 *          with a controllable real-file gate that blocks touch until released.
 *  D-LC-3: an internal (non-errno) rejection during a tick is observable via a
 *          deterministic scheduler (await/reject), not silently swallowed.
 *
 * Real files, real filesystem, no mocks of fs. Gating is achieved by wrapping
 * the package-private filesystem port with controllable deferreds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfRetention,
  type PerfScheduler,
  type PerfTimerHandle,
  type PerfRetentionFilesystem,
} from './retention.js';

let dir: string;

describe('PerfRetention lifecycle behavior', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-lifecycle-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  interface Deferred<T = void> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
  }

  function createDeferred<T = void>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function waitAtFirstReaddir(
    readdirCount: number,
    readdirEntered: Deferred<void>,
    gate: Deferred<void>,
  ): Promise<void> {
    if (readdirCount === 1) {
      readdirEntered.resolve();
      await gate.promise;
    }
  }

  /** Real-fs port that delegates to node:fs/promises (test shared dir). */
  function realFilesystem(): PerfRetentionFilesystem {
    return {
      async ensureDir(d: string): Promise<void> {
        try {
          await fsp.access(d);
        } catch {
          await fsp.mkdir(d, { recursive: true, mode: 0o700 });
        }
      },
      async openExclusive(p: string, mode: number): Promise<void> {
        const h = await fsp.open(p, 'wx', mode);
        await h.close();
      },
      async utimes(p: string, atime: Date, mtime: Date): Promise<void> {
        await fsp.utimes(p, atime, mtime);
      },
      async readdir(d: string): Promise<string[]> {
        return fsp.readdir(d);
      },
      async stat(p: string): Promise<{ size: number; mtimeMs: number }> {
        const s = await fsp.stat(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
      },
      async unlink(p: string): Promise<void> {
        await fsp.unlink(p);
      },
    };
  }

  /** Captures the interval callback for deterministic firing. */
  class CapturingScheduler implements PerfScheduler {
    callback: (() => Promise<void>) | null = null;

    setInterval(callback: () => Promise<void>): PerfTimerHandle {
      this.callback = callback;
      return { unref: () => {}, clear: () => {} };
    }
  }

  class ThrowOnceScheduler implements PerfScheduler {
    attempts = 0;
    callback: (() => Promise<void>) | null = null;

    setInterval(callback: () => Promise<void>): PerfTimerHandle {
      this.attempts += 1;
      if (this.attempts === 1) {
        throw new Error('scheduler setup failed');
      }
      this.callback = callback;
      return { unref: () => {}, clear: () => {} };
    }
  }

  class ThrowOnceUnrefScheduler implements PerfScheduler {
    attempts = 0;
    clearCalls = 0;

    setInterval(): PerfTimerHandle {
      this.attempts += 1;
      const throwOnUnref = this.attempts === 1;
      return {
        unref: () => {
          if (throwOnUnref) throw new Error('scheduler unref failed');
        },
        clear: () => {
          this.clearCalls += 1;
        },
      };
    }
  }

  /**
   * A scheduler backed by a REAL native interval that keeps firing until clear()
   * is called on the returned handle. Used to prove disposal actually cancels
   * firing (behaviorally), not just source-level.
   */
  class AutoFiringScheduler implements PerfScheduler {
    fireCount = 0;
    private native: ReturnType<typeof setInterval> | null = null;

    setInterval(callback: () => Promise<void>, ms: number): PerfTimerHandle {
      this.native = setInterval(() => {
        this.fireCount += 1;
        void callback().catch(() => {
          /* internal errors are surfaced by the retention path; ignore here */
        });
      }, ms);
      return {
        unref: () => {
          const h = this.native as unknown as { unref?: () => void };
          if (typeof h.unref === 'function') h.unref();
        },
        clear: () => {
          if (this.native !== null) {
            clearInterval(this.native);
            this.native = null;
          }
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Start transaction: scheduler setup failure rolls back claim/state
  // ---------------------------------------------------------------------------

  describe('PerfRetention scheduler setup rollback', () => {
    it('removes the claim and permits a successful start retry', async () => {
      const runUuid = '00000000-0000-4000-8000-00000000000a';
      const claimPath = path.join(dir, `${runUuid}.claim`);
      const scheduler = new ThrowOnceScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid,
        scheduler,
        onDiagnostic: () => {},
      });

      await expect(retention.start()).rejects.toThrow('scheduler setup failed');
      expect(fs.existsSync(claimPath)).toBe(false);

      await expect(retention.start()).resolves.toBeUndefined();
      expect(scheduler.attempts).toBe(2);
      expect(scheduler.callback).not.toBeNull();
      expect(fs.existsSync(claimPath)).toBe(true);

      await retention.dispose();
      expect(fs.existsSync(claimPath)).toBe(false);
    });

    it('clears the timer and rolls back the claim when unref fails', async () => {
      const runUuid = '00000000-0000-4000-8000-00000000000b';
      const claimPath = path.join(dir, `${runUuid}.claim`);
      const scheduler = new ThrowOnceUnrefScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid,
        scheduler,
        onDiagnostic: () => {},
      });

      await expect(retention.start()).rejects.toThrow('scheduler unref failed');
      expect(scheduler.clearCalls).toBe(1);
      expect(fs.existsSync(claimPath)).toBe(false);

      await expect(retention.start()).resolves.toBeUndefined();
      expect(scheduler.attempts).toBe(2);
      expect(fs.existsSync(claimPath)).toBe(true);

      await retention.dispose();
      expect(scheduler.clearCalls).toBe(2);
      expect(fs.existsSync(claimPath)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // D-LC-1: dispose cancels the interval (clear), not just nulls the handle
  // ---------------------------------------------------------------------------

  describe('PerfRetention dispose cancels the interval (D-LC-1)', () => {
    it('stops firing after dispose when the scheduler keeps firing until clear', async () => {
      const scheduler = new AutoFiringScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000000',
        scheduler,
        maintenanceIntervalMs: 8,
        onDiagnostic: () => {},
      });
      await retention.start();

      // Let the auto-firing scheduler fire several times.
      await new Promise((r) => setTimeout(r, 40));
      const warmed = scheduler.fireCount;
      expect(warmed).toBeGreaterThan(0);

      await retention.dispose();

      // After dispose, the native interval must be cancelled. Wait long enough
      // that several more firings WOULD have occurred if clear() were not called.
      await new Promise((r) => setTimeout(r, 40));
      expect(scheduler.fireCount).toBe(warmed);
    });

    it('does not touch the claim after dispose (auto-firing scheduler)', async () => {
      const scheduler = new AutoFiringScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000001',
        scheduler,
        maintenanceIntervalMs: 8,
        onDiagnostic: () => {},
      });
      await retention.start();
      await retention.dispose();

      // The claim must be gone, and no amount of waiting recreates it.
      await new Promise((r) => setTimeout(r, 30));
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000001.claim'),
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // D-LC-2: dispose awaits an in-flight tick before unlinking the claim
  // ---------------------------------------------------------------------------

  describe('PerfRetention dispose awaits in-flight tick (D-LC-2)', () => {
    it('waits for a touch blocked on a gate, then unlinks — no post-dispose touch', async () => {
      const touchGate = createDeferred<void>();
      let touchCount = 0;
      const gatedFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(p, atime, mtime): Promise<void> {
          touchCount += 1;
          // Block until the test releases the gate.
          await touchGate.promise;
          await fsp.utimes(p, atime, mtime);
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000002',
        fs: gatedFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      // Fire the interval tick WITHOUT awaiting — it blocks inside touchClaim.
      const tickPromise = scheduler.callback!().catch(() => {});
      await new Promise((r) => setTimeout(r, 15));

      // Begin dispose while the tick is still in flight (blocked at the gate).
      let disposed = false;
      const disposePromise = retention.dispose().then(() => {
        disposed = true;
      });
      await new Promise((r) => setTimeout(r, 15));

      // Dispose must NOT have resolved yet: the in-flight tick is still running.
      expect(disposed).toBe(false);
      // The claim must still be present: dispose has not unlinked it yet.
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000002.claim'),
        ),
      ).toBe(true);

      // Release the gate: the in-flight touch completes, then dispose unlinks.
      touchGate.resolve();
      await tickPromise;
      await disposePromise;

      expect(disposed).toBe(true);
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000002.claim'),
        ),
      ).toBe(false);
      // Exactly one touch (the in-flight one). No post-dispose touch occurs.
      expect(touchCount).toBe(1);
    });

    it('dispose then a late scheduler fire performs no touch', async () => {
      const touchGate = createDeferred<void>();
      let touchCount = 0;
      const gatedFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(p, atime, mtime): Promise<void> {
          touchCount += 1;
          await touchGate.promise;
          await fsp.utimes(p, atime, mtime);
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000003',
        fs: gatedFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      // Block a tick, then dispose (which awaits it), then release.
      const tickPromise = scheduler.callback!().catch(() => {});
      const disposePromise = retention.dispose();
      await new Promise((r) => setTimeout(r, 10));
      touchGate.resolve();
      await tickPromise;
      await disposePromise;

      // Now attempt a LATE fire of the captured callback — disposed, so no touch.
      const before = touchCount;
      await scheduler.callback!().catch(() => {});
      expect(touchCount).toBe(before);
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000003.claim'),
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // D-LC-3: internal rejection is observable (await/reject), not swallowed
  // ---------------------------------------------------------------------------

  describe('PerfRetention internal tick rejection (D-LC-3)', () => {
    it('a non-errno throw during touch is awaitable/rejectable via the scheduler', async () => {
      // Internal (programming) error: utimes throws a plain Error (no errno code).
      const internalFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(): Promise<void> {
          throw new Error('internal touch corruption');
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000004',
        fs: internalFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      // The interval callback returns a promise that rejects with the internal
      // error — it is NOT silently swallowed; awaiting observes the rejection.
      await expect(scheduler.callback!()).rejects.toThrow(
        'internal touch corruption',
      );

      await retention.dispose();
    });

    it('a non-errno throw during maintain is awaitable/rejectable', async () => {
      // Internal error inside maintain: readdir throws a plain Error.
      const internalFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async readdir(): Promise<string[]> {
          throw new Error('internal readdir corruption');
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000005',
        fs: internalFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      await expect(scheduler.callback!()).rejects.toThrow(
        'internal readdir corruption',
      );

      await retention.dispose();
    });

    it('dispose still completes (unlinks claim) after a tick rejected', async () => {
      const internalFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(): Promise<void> {
          throw new Error('internal touch corruption');
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000006',
        fs: internalFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      await scheduler.callback!().catch(() => {});
      await retention.dispose();

      // Claim cleanup proceeds despite the prior internal rejection.
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000006.claim'),
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // D-LC-4: dispose propagates in-flight tick internal error after cleanup
  // ---------------------------------------------------------------------------

  describe('PerfRetention dispose propagates in-flight tick error (D-LC-4)', () => {
    it('rejects with the in-flight tick internal error AND removes the claim', async () => {
      let touchResolve!: () => void;
      const touchGate = new Promise<void>((resolve) => {
        touchResolve = resolve;
      });
      const gatedFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(_p, _atime, _mtime): Promise<void> {
          await touchGate;
          throw new Error('internal touch corruption');
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000007',
        fs: gatedFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      // Fire the tick — it blocks inside touchClaim on the gate.
      const tickPromise = scheduler.callback!().catch(() => {});
      await new Promise((r) => setTimeout(r, 15));

      // Dispose while the tick is in-flight (blocked at the gate).
      const disposePromise = retention.dispose();

      // Release the gate — the tick throws an internal (non-errno) error.
      touchResolve();
      await tickPromise;

      // Dispose must reject with the tick's internal error after cleanup.
      await expect(disposePromise).rejects.toThrow('internal touch corruption');

      // Cleanup must still have proceeded despite the tick error.
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000007.claim'),
        ),
      ).toBe(false);
    });

    it('aggregates tick and cleanup internal errors when both fail (D-LC-4)', async () => {
      let touchResolve!: () => void;
      const touchGate = new Promise<void>((resolve) => {
        touchResolve = resolve;
      });
      const dualFailFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(): Promise<void> {
          await touchGate;
          throw new Error('tick internal error');
        },
        async unlink(): Promise<void> {
          throw new Error('cleanup internal error');
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000008',
        fs: dualFailFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      const tickPromise = scheduler.callback!().catch(() => {});
      await new Promise((r) => setTimeout(r, 15));

      const disposePromise = retention.dispose();
      touchResolve();
      await tickPromise;

      let caught: unknown = undefined;
      try {
        await disposePromise;
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AggregateError);
      const aggregate = caught as AggregateError;
      const messages = aggregate.errors.map(errorMessage);
      expect(messages).toContain('tick internal error');
      expect(messages).toContain('cleanup internal error');
    });

    it('external errno tick failure resolves fail-open during dispose', async () => {
      let touchResolve!: () => void;
      const touchGate = new Promise<void>((resolve) => {
        touchResolve = resolve;
      });
      const errnoFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async utimes(): Promise<void> {
          await touchGate;
          const err = new Error('EACCES') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        },
      };
      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000009',
        fs: errnoFs,
        scheduler,
        onDiagnostic: () => {},
      });
      await retention.start();

      const tickPromise = scheduler.callback!().catch(() => {});
      await new Promise((r) => setTimeout(r, 15));

      const disposePromise = retention.dispose();
      touchResolve();
      await tickPromise;

      // External errno failure resolves fail-open — dispose resolves.
      await expect(disposePromise).resolves.toBeUndefined();
      expect(
        fs.existsSync(
          path.join(dir, '00000000-0000-4000-8000-000000000009.claim'),
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Serialization: maybeMaintain and interval tick use one chain (no overlap)
  // ---------------------------------------------------------------------------

  describe('PerfRetention serialization — maybeMaintain and tick never overlap', () => {
    it('maybeMaintain chains after an in-flight tick with no overlapping maintain work', async () => {
      // Gated filesystem: the first readdir (from the tick's maintain) blocks
      // until released. While blocked, maybeMaintain is called — it must chain
      // behind the tick rather than overlap.
      const gate = createDeferred<void>();
      const readdirEntered = createDeferred<void>();
      let concurrentReaddirs = 0;
      let maxConcurrent = 0;
      let readdirCount = 0;
      let utimesCount = 0;

      const gatedFs: PerfRetentionFilesystem = {
        ...realFilesystem(),
        async readdir(d: string): Promise<string[]> {
          readdirCount += 1;
          concurrentReaddirs += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrentReaddirs);
          await waitAtFirstReaddir(readdirCount, readdirEntered, gate);
          const result = await fsp.readdir(d);
          concurrentReaddirs -= 1;
          return result;
        },
        async utimes(p: string, atime: Date, mtime: Date): Promise<void> {
          utimesCount += 1;
          await fsp.utimes(p, atime, mtime);
        },
      };

      const scheduler = new CapturingScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000040',
        fs: gatedFs,
        scheduler,
        maintenanceIntervalMs: 1,
        maxFiles: 1,
        maxBytes: 1,
        onDiagnostic: () => {},
      });
      await retention.start();

      const tickPromise = scheduler.callback!();
      await readdirEntered.promise;

      const maybePromise = retention.maybeMaintain(Date.now() + 10_000);

      gate.resolve();
      await tickPromise;
      await maybePromise;

      expect(readdirCount).toBe(2);

      // No overlap: at most 1 concurrent readdir across both maintains.
      expect(maxConcurrent).toBe(1);

      // No extra claim touch: only the tick called utimes (touchClaim).
      // maybeMaintain calls maintain() — NOT tick() — so it does not touch
      // the claim.
      expect(utimesCount).toBe(1);

      await retention.dispose();
    });

    it('explicit maybeMaintain now is preserved for the eviction sweep (not overwritten by a concurrent tick)', async () => {
      // Create a perf file with today's UTC day key and a known mtime, belonging
      // to a DIFFERENT run UUID (so own-run protection does not apply). The file
      // is protected (not evicted) when `now - mtimeMs < maintenanceIntervalMs`
      // and eligible when `now - mtimeMs >= maintenanceIntervalMs`. Proving the
      // file survives at one `now` and is evicted at a later `now` demonstrates
      // that maybeMaintain passes its explicit `now` to the sweep.
      const today = new Date();
      const dayKey = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
      const fileName = `perf-${dayKey}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl`;
      const filePath = path.join(dir, fileName);

      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000041',
        maxFiles: 1,
        maxBytes: 1,
        maintenanceIntervalMs: 60_000,
        onDiagnostic: () => {},
      });

      // File mtime is exactly 1000 ms before baseNow.
      const baseNow = Date.now();
      const fileMtime = baseNow - 1000;
      fs.writeFileSync(filePath, 'data' + '\n');
      fs.utimesSync(filePath, new Date(fileMtime), new Date(fileMtime));

      // maybeMaintain(baseNow): now - mtimeMs = 1000 < 60_000 → file protected.
      await retention.maybeMaintain(baseNow);
      expect(fs.existsSync(filePath)).toBe(true);

      // maybeMaintain(baseNow + 120_000): now - mtimeMs = 121_000 >= 60_000 →
      // file eligible → evicted. The rate-limit also passes: 120_000 >= 60_000.
      await retention.maybeMaintain(baseNow + 120_000);
      expect(fs.existsSync(filePath)).toBe(false);

      await retention.dispose();
    });
  });
});
