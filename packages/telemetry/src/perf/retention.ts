/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PerfRetention — directory retention + per-run claim lifecycle (P08, D3/D5/D6).
 *
 * A constructible (non-singleton) owner that manages exactly ONE coarse
 * maintenance interval. That same interval:
 *   1. Touches this run's UUID claim file (lease-window freshness — D3).
 *   2. Performs an oldest-first retention sweep over perf-*.jsonl + *.claim.
 *
 * Claim lifecycle:
 *   - Created exclusively (`wx`, 0600) at {@link PerfRetention.start}.
 *   - Touched every interval by {@link PerfRetention.tick}.
 *   - Removed on clean {@link PerfRetention.dispose}.
 *   - A crash (no dispose) leaves a stale claim until the next sweep reaps it.
 *
 * Retention is an EVENTUAL BOUND with documented overshoot + live-writer
 * safety (AC-7, §6). It is explicitly NOT an instantaneous no-loss cap.
 * The bound permits active-day and claim overshoot (D3/D5).
 *
 * Error policy (D8): internal/programming errors fail fast. Only genuine
 * filesystem persistence/maintenance errors (create/touch/stat/readdir/unlink)
 * fail open and are rate-limited.
 *
 * Filesystem fault injection (D6): tests inject {@link FaultInjectingRetentionFilesystem}
 * to produce deterministic EACCES/EROFS/ENOSPC at any boundary — never real-disk
 * fill or chmod.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import {
  isOwnedArtifact,
  isNonStaleClaim,
  isClaimFile,
  isPerfJsonl,
  extractRunUuid,
  collectFreshClaimRunUuids,
  isPerfJsonlProtected,
  requireValidRunUuid,
} from './perfArtifacts.js';

// ===========================================================================
// Constants (D5 — derived from the P04 Bun record-size benchmark)
// ===========================================================================
//
// P04 benchmark output (perfRecordSize.bench.ts, actual v1 schema):
//   operation record (WITH memory columns): 1220 bytes/line
//   memory_sample record:                   242 bytes/line
//   combined per-operation pair:            1462 bytes
//
// MAX_BYTES = 64 MiB = 67,108,864 bytes
//   At 1462 bytes/pair (memory on), the cap holds ~45,902 operation pairs.
//   At 1220 bytes/op (memory off), it holds ~55,008 operations.
//   This is a generous budget for LOCAL-ONLY dev telemetry — no network,
//   no remote upload.
//
// MAX_FILES = 128
//   One file per writer per UTC day (perf-YYYYMMDD-uuid.jsonl) + one 0-byte
//   claim per concurrent run. At single-writer volume, 128 files ≈ 128 days.
//   Each claim file is 0 bytes but counts toward the file cap.
//
// Which cap binds at representative single-writer volume?
//   Crossover: MAX_BYTES / MAX_FILES = 524,288 bytes/file ≈ 512 KiB.
//   524,288 / 1462 ≈ 359 operation-pairs/file (memory on).
//   Below ~359 pairs/day: the FILE cap binds (128 days of data before eviction).
//   Above ~359 pairs/day: the BYTE cap binds (64 MiB reached before 128 days).
//   At typical interactive use (~50-200 ops/day), the file cap is the binding
//   constraint — generous for local-only retention.
//
// MAINTENANCE_INTERVAL_MS = 60,000 (60 s)
//   The single owned coarse interval. Also defines the live-writer protection
//   window: a perf file with today's day-key whose mtime is within this window
//   is never evicted.
//
// CLAIM_LEASE_MS = 180,000 (180 s = 3 × interval)
//   A claim is non-stale while now - mtime ≤ CLAIM_LEASE_MS. The interval
//   touches the claim every 60 s, so a running process keeps it fresh well
//   within the 180 s lease. A crashed run's claim becomes stale within
//   3 minutes — bounded crash overshoot (D3).
//
// DIAG_RATE_LIMIT_MS = 60,000 (60 s)
//   At most one diagnostic per window for retention filesystem failures.

export const PERF_MAX_BYTES = 64 * 1024 * 1024; // 67,108,864
export const PERF_MAX_FILES = 128;
export const PERF_MAINTENANCE_INTERVAL_MS = 60_000;
export const PERF_CLAIM_LEASE_MS = PERF_MAINTENANCE_INTERVAL_MS * 3; // 180,000
export const PERF_DIAG_RATE_LIMIT_MS = 60_000;

// ===========================================================================
// Filesystem port (D6 — package-private for deterministic fault injection)
// ===========================================================================

/**
 * Narrow filesystem port used by PerfRetention. The default implementation
 * uses real `node:fs/promises`; tests inject
 * {@link FaultInjectingRetentionFilesystem} to produce deterministic
 * EACCES/EROFS/ENOSPC failures at the unlink/touch/stat/readdir boundary
 * without filling a disk or relying on chmod.
 */
export interface PerfRetentionFilesystem {
  ensureDir(dir: string): Promise<void>;
  openExclusive(path: string, mode: number): Promise<void>;
  utimes(path: string, atime: Date, mtime: Date): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  unlink(path: string): Promise<void>;
}

/** Default filesystem port using real `node:fs/promises`. */
class RealRetentionFilesystem implements PerfRetentionFilesystem {
  async ensureDir(dir: string): Promise<void> {
    try {
      await fsp.access(dir);
    } catch {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  async openExclusive(filePath: string, mode: number): Promise<void> {
    const handle = await fsp.open(filePath, 'wx', mode);
    await handle.close();
  }

  async utimes(filePath: string, atime: Date, mtime: Date): Promise<void> {
    await fsp.utimes(filePath, atime, mtime);
  }

  async readdir(dir: string): Promise<string[]> {
    return fsp.readdir(dir);
  }

  async stat(filePath: string): Promise<{ size: number; mtimeMs: number }> {
    const s = await fsp.stat(filePath);
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async unlink(filePath: string): Promise<void> {
    await fsp.unlink(filePath);
  }
}

/**
 * Deterministic fault-injecting filesystem port for retention tests (D6).
 * Fails the configured method with the given errno code on every call,
 * delegating all other methods to the real implementation. Package-private
 * — tests deep-import it; it is NOT in the public barrel.
 */
export class FaultInjectingRetentionFilesystem
  implements PerfRetentionFilesystem
{
  private readonly real = new RealRetentionFilesystem();

  constructor(
    private readonly fault: {
      readonly failMethod:
        | 'unlink'
        | 'utimes'
        | 'openExclusive'
        | 'readdir'
        | 'stat'
        | 'ensureDir';
      readonly code: 'EACCES' | 'EROFS' | 'ENOSPC' | 'ENOENT';
    },
  ) {}

  async ensureDir(dir: string): Promise<void> {
    if (this.fault.failMethod === 'ensureDir') throw this.makeError();
    await this.real.ensureDir(dir);
  }

  async openExclusive(filePath: string, mode: number): Promise<void> {
    if (this.fault.failMethod === 'openExclusive') throw this.makeError();
    await this.real.openExclusive(filePath, mode);
  }

  async utimes(filePath: string, atime: Date, mtime: Date): Promise<void> {
    if (this.fault.failMethod === 'utimes') throw this.makeError();
    await this.real.utimes(filePath, atime, mtime);
  }

  async readdir(dir: string): Promise<string[]> {
    if (this.fault.failMethod === 'readdir') throw this.makeError();
    return this.real.readdir(dir);
  }

  async stat(filePath: string): Promise<{ size: number; mtimeMs: number }> {
    if (this.fault.failMethod === 'stat') throw this.makeError();
    return this.real.stat(filePath);
  }

  async unlink(filePath: string): Promise<void> {
    if (this.fault.failMethod === 'unlink') throw this.makeError();
    await this.real.unlink(filePath);
  }

  private makeError(): NodeJS.ErrnoException {
    const err = new Error(
      `fault-injected ${this.fault.code}`,
    ) as NodeJS.ErrnoException;
    err.code = this.fault.code;
    return err;
  }
}

// ===========================================================================
// Scheduler port (package-private — for deterministic test firing)
// ===========================================================================

/**
 * Handle for an owned interval timer. The `unref` method prevents the timer
 * from keeping the CLI process alive (supported on Node.js/Bun). The `clear`
 * method cancels the interval so it stops invoking the callback — disposal
 * MUST call this rather than merely nulling the handle, otherwise the native
 * interval keeps firing a disposed callback forever.
 */
export interface PerfTimerHandle {
  unref(): void;
  clear(): void;
}

/**
 * Package-private scheduler seam. The default implementation delegates to
 * `setInterval`. Tests inject a custom implementation that captures the
 * callback so it can be fired deterministically, then asserts file/mtime/
 * outcome behavior — not just callback invocation.
 *
 * The callback returns a Promise so test schedulers can `await` the async
 * work (touch + maintain) before asserting state.
 */
export interface PerfScheduler {
  setInterval(callback: () => Promise<void>, ms: number): PerfTimerHandle;
}

class RealScheduler implements PerfScheduler {
  setInterval(callback: () => Promise<void>, ms: number): PerfTimerHandle {
    // Wrap the async callback so that an internal (non-errno) rejection is
    // surfaced via an asynchronous rethrow (D8 fail-fast) rather than becoming
    // an opaque unhandled rejection. External fs errors are caught inside
    // tick()/maintain() (fail-open); only true programming errors reach here.
    const fire = (): void => {
      Promise.resolve(callback()).catch((err: unknown) => {
        queueMicrotask(() => {
          throw err;
        });
      });
    };
    const nativeHandle = globalThis.setInterval(fire, ms);
    return {
      unref: () => {
        const h = nativeHandle as unknown as {
          unref?: () => void;
        };
        if (typeof h.unref === 'function') h.unref();
      },
      clear: () => {
        globalThis.clearInterval(nativeHandle);
      },
    };
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Determines whether an error carries a Node.js errno code, indicating a
 * filesystem persistence failure (fail-open). Errors without an errno code
 * are programming errors and must propagate (fail fast).
 */
function isErrnoError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return typeof (err as NodeJS.ErrnoException).code === 'string';
}

// ===========================================================================
// PerfRetention
// ===========================================================================

export interface PerfRetentionOptions {
  readonly dir: string;
  readonly runUuid: string;
  readonly fs?: PerfRetentionFilesystem;
  readonly scheduler?: PerfScheduler;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly maintenanceIntervalMs?: number;
  readonly claimLeaseMs?: number;
  readonly diagRateLimitMs?: number;
  readonly onDiagnostic?: (message: string) => void;
}

interface ArtifactInfo {
  readonly name: string;
  readonly fullPath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Constructible retention owner. Owns exactly one coarse maintenance interval
 * that touches this run's claim and sweeps old artifacts.
 *
 * Lifecycle:
 *   - `await start()` — creates the claim exclusively, starts the interval.
 *   - `await tick()`   — interval body: touch claim + maintain (fire-and-forget
 *                        in production, awaitable for deterministic tests).
 *   - `await dispose()` — clears the interval, removes the claim cleanly.
 *
 * A crash (no dispose) leaves a stale claim on disk; the next sweep reaps it.
 */
export class PerfRetention {
  private readonly sinkDir: string;
  private readonly runUuid: string;
  private readonly fsPort: PerfRetentionFilesystem;
  private readonly scheduler: PerfScheduler;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly maintenanceIntervalMs: number;
  private readonly claimLeaseMs: number;
  private readonly diagRateLimitMs: number;
  private readonly onDiagnostic: (message: string) => void;

  private timerHandle: PerfTimerHandle | null = null;
  private claimPath: string | null = null;
  private lastMaintenanceMs = 0;
  private lastDiagMs = 0;
  private started = false;
  private disposed = false;
  // P11 self-health: cumulative count of successful evictions in THIS process.
  // Narrow read-only state for the inspect/report self-health surface — NOT
  // persisted.
  private evictions = 0;
  // The latest accepted interval tick promise (serialized chain). Dispose
  // awaits this so an in-flight touch+sweep completes before the claim is
  // removed — preventing a touch-after-unlink race.
  private inflight: Promise<void> | null = null;

  constructor(options: PerfRetentionOptions) {
    this.sinkDir = options.dir;
    this.runUuid = requireValidRunUuid(options.runUuid);
    this.fsPort = options.fs ?? new RealRetentionFilesystem();
    this.scheduler = options.scheduler ?? new RealScheduler();
    this.maxBytes = options.maxBytes ?? PERF_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? PERF_MAX_FILES;
    this.maintenanceIntervalMs =
      options.maintenanceIntervalMs ?? PERF_MAINTENANCE_INTERVAL_MS;
    this.claimLeaseMs = options.claimLeaseMs ?? PERF_CLAIM_LEASE_MS;
    this.diagRateLimitMs = options.diagRateLimitMs ?? PERF_DIAG_RATE_LIMIT_MS;
    this.onDiagnostic = options.onDiagnostic ?? defaultDiagnostic;
    this.validateTuning();
  }

  /**
   * Fails fast on misconfigured caps/intervals so internal misuse cannot cause
   * catastrophic eviction (e.g. NaN/negative caps make every `<=` comparison
   * false and delete everything eligible).
   */
  private validateTuning(): void {
    this.requirePositiveFinite('maxBytes', this.maxBytes);
    this.requirePositiveFinite('maxFiles', this.maxFiles);
    this.requirePositiveFinite(
      'maintenanceIntervalMs',
      this.maintenanceIntervalMs,
    );
    this.requirePositiveFinite('claimLeaseMs', this.claimLeaseMs);
    if (!Number.isFinite(this.diagRateLimitMs) || this.diagRateLimitMs < 0) {
      throw new RangeError(
        `PerfRetention: diagRateLimitMs must be a finite nonnegative number (got ${this.diagRateLimitMs})`,
      );
    }
  }

  private requirePositiveFinite(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        `PerfRetention: ${name} must be a finite positive number (got ${value})`,
      );
    }
  }

  /**
   * Creates the UUID claim file exclusively and starts the one owned
   * maintenance interval. Must be called exactly once before tick/dispose.
   * An empty started retention creates ONLY its claim — no perf JSONL.
   *
   * Only marks `started` after successful claim creation, so an external
   * filesystem failure leaves the instance in a truthful, retryable state
   * (the next `start()` re-attempts). Phantom claim state is cleared on
   * external open failure so dispose/tick do not operate on a non-existent
   * file. External errno errors remain fail-open; internal errors propagate.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;

    this.claimPath = join(this.sinkDir, `${this.runUuid}.claim`);

    try {
      await this.fsPort.ensureDir(this.sinkDir);
      await this.fsPort.openExclusive(this.claimPath, 0o600);
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        this.claimPath = null;
        return;
      }
      throw err;
    }

    try {
      this.timerHandle = this.scheduler.setInterval(
        () => this.fireTick(),
        this.maintenanceIntervalMs,
      );
      this.timerHandle.unref();
      this.started = true;
    } catch (error) {
      await this.rollbackFailedStart(error);
    }
  }

  private async rollbackFailedStart(startError: unknown): Promise<never> {
    const errors: unknown[] = [startError];
    const timerHandle = this.timerHandle;
    this.timerHandle = null;
    this.started = false;
    if (timerHandle !== null) {
      try {
        timerHandle.clear();
      } catch (error) {
        errors.push(error);
      }
    }

    const claimPath = this.claimPath;
    this.claimPath = null;
    if (claimPath !== null) {
      try {
        await this.fsPort.unlink(claimPath);
      } catch (error) {
        if (isErrnoError(error)) {
          this.emitDiagnostic(error);
        } else {
          errors.push(error);
        }
      }
    }

    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'PerfRetention start and rollback both failed',
      );
    }
    throw startError;
  }

  /**
   * Serializes a unit of work onto the single tracked chain so interval ticks
   * and triggered maintenance never overlap. Each unit runs regardless of
   * whether the prior unit resolved or rejected (a prior internal error is
   * surfaced independently by the real-scheduler rejection path). Returns the
   * unit's promise so callers can await it.
   */
  private serializeWork(work: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const prev = this.inflight;
    const next: Promise<void> = prev === null ? work() : prev.then(work, work);
    this.inflight = next;
    next.then(
      () => {
        if (this.inflight === next) this.inflight = null;
      },
      () => {
        if (this.inflight === next) this.inflight = null;
      },
    );
    return next;
  }

  /**
   * Interval entry point. Serializes tick work onto a single tracked chain so
   * ticks never overlap and {@link dispose} can deterministically await any
   * in-flight maintenance before removing the claim. Each firing returns its
   * own promise so deterministic test schedulers can await/reject it.
   */
  private fireTick(): Promise<void> {
    return this.serializeWork(() => this.tick());
  }

  /**
   * The interval body: touches this run's claim and runs a retention sweep.
   * Called automatically by the owned interval. Exposed as public so
   * deterministic tests can fire the actual interval callback and assert
   * file/mtime/outcome behavior.
   */
  async tick(): Promise<void> {
    if (this.disposed) return;
    const now = Date.now();
    await this.touchClaim(now);
    await this.maintain(now);
  }

  /**
   * Rate-limited maintenance trigger (called on roll boundary by PerfSink).
   * Skips if called within the maintenance interval of the last sweep.
   *
   * Serialized onto the SAME tracked chain as interval ticks (via
   * {@link serializeWork}) so a triggered sweep can never overlap a concurrent
   * interval tick. The explicit `now` is preserved for the actual sweep — no
   * invented extra claim touch occurs.
   */
  async maybeMaintain(now: number): Promise<void> {
    if (this.disposed) return;
    if (now - this.lastMaintenanceMs < this.maintenanceIntervalMs) return;
    this.lastMaintenanceMs = now;
    await this.serializeWork(() => this.maintain(now));
  }

  /**
   * Scans owned artifacts (perf-YYYYMMDD-*.jsonl + *.claim), computes total
   * bytes/files, and evicts oldest-first until BOTH caps are satisfied.
   *
   * Live-writer protection: a perf file whose day-key is today UTC AND whose
   * mtime is within the maintenance interval is never deleted. A non-stale
   * claim is never deleted. Stale claims and old-day files are eligible.
   *
   * Accounting is decremented ONLY on successful unlink (D6 — does not copy
   * rotateReports' decrement-on-failure defect).
   *
   * Genuine filesystem errors (stat/readdir/unlink) fail open and are
   * rate-limited. Internal/programming errors fail fast.
   */
  async maintain(now: number): Promise<void> {
    if (this.disposed) return;
    this.lastMaintenanceMs = now;

    let names: string[];
    try {
      names = await this.fsPort.readdir(this.sinkDir);
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        return;
      }
      throw err;
    }

    const owned = names.filter(isOwnedArtifact);
    if (owned.length === 0) return;

    // Stat all owned artifacts. Individual stat failures fail open (the
    // file is skipped, not counted).
    const artifacts: ArtifactInfo[] = [];
    for (const name of owned) {
      const fullPath = join(this.sinkDir, name);
      const statResult = await this.safeStat(fullPath);
      if (statResult !== null) {
        artifacts.push({ name, fullPath, ...statResult });
      }
    }

    let filesLeft = artifacts.length;
    let bytesLeft = artifacts.reduce((sum, a) => sum + a.size, 0);

    if (filesLeft <= this.maxFiles && bytesLeft <= this.maxBytes) return;

    // Centralized claim→run→JSONL protection (A): collect canonical run IDs
    // from fresh/future claims. Every JSONL belonging to a non-stale claim is
    // protected regardless of mtime/day. The retention owner's own run is
    // always protected.
    const claimArtifacts = artifacts.filter((a) => isClaimFile(a.name));
    const protectedRunUuids = collectFreshClaimRunUuids(
      claimArtifacts.map((a) => ({
        runUuid: extractRunUuid(a.name),
        mtimeMs: a.mtimeMs,
      })),
      now,
      this.claimLeaseMs,
    );

    // Sort oldest-first with stable deterministic tie-break by name.
    // Pre-filter to eligible (non-protected) artifacts to keep the eviction
    // loop simple (single break for cap check — no nested continues).
    const sorted = artifacts
      .filter((a) => !this.isProtected(a, now, protectedRunUuids))
      .sort(compareArtifactAge);

    for (const artifact of sorted) {
      if (filesLeft <= this.maxFiles && bytesLeft <= this.maxBytes) break;

      const unlinked = await this.safeUnlink(artifact.fullPath);
      if (unlinked) {
        // Decrement ONLY on successful unlink.
        filesLeft -= 1;
        bytesLeft -= artifact.size;
        this.evictions += 1;
      }
    }
  }

  /**
   * Counts non-stale claim files for concurrent_instances (D3).
   * A claim is non-stale while (now - mtime) ≤ CLAIM_LEASE_MS.
   *
   * Genuine filesystem errors (readdir/stat) fail open (return 0 / skip) but
   * emit the same rate-limited diagnostic as other maintenance paths. ENOENT
   * races count as external fs and are rate-limited.
   */
  async countNonStaleClaims(now: number): Promise<number> {
    let names: string[];
    try {
      names = await this.fsPort.readdir(this.sinkDir);
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        return 0;
      }
      throw err;
    }

    const claimNames = names.filter((n) => n.endsWith('.claim'));
    let count = 0;
    for (const name of claimNames) {
      try {
        const s = await this.fsPort.stat(join(this.sinkDir, name));
        if (now - s.mtimeMs <= this.claimLeaseMs) {
          count += 1;
        }
      } catch (err) {
        if (isErrnoError(err)) {
          this.emitDiagnostic(err); // skip unreadable claim, fail open
          continue;
        }
        throw err;
      }
    }
    return count;
  }

  /**
   * P11 self-health: cumulative count of successful evictions in THIS process.
   * Narrow read-only state for the inspect/report self-health surface. Not
   * persisted.
   */
  get evictionCount(): number {
    return this.evictions;
  }

  /**
   * Stops new scheduling, cancels the interval, awaits all accepted/running
   * interval tick work, then removes the claim file cleanly. After dispose,
   * no further ticks fire and the claim is gone. A crash (no dispose) leaves
   * the claim stale until the next sweep.
   *
   * If the awaited in-flight tick rejected with an internal/programming error
   * (non-errno), dispose rejects with that error AFTER cleanup has proceeded.
   * If claim cleanup also has an internal failure, both errors are surfaced
   * via an AggregateError (project convention for dual-failure scenarios).
   * External errno failures from either tick or cleanup remain fail-open /
   * rate-limited and do NOT cause dispose to reject.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    // 1. Stop accepting new interval ticks.
    this.disposed = true;
    // 2. Cancel the timer so the native interval stops firing.
    this.timerHandle?.clear();
    this.timerHandle = null;

    // 3. Await any in-flight touch+sweep so it completes before the claim is
    //    removed (prevents a touch-after-unlink race). External errno errors
    //    are swallowed (fail-open); internal errors are captured for rethrow
    //    after cleanup.
    let tickError: unknown = null;
    if (this.inflight !== null) {
      try {
        await this.inflight;
      } catch (err) {
        if (isErrnoError(err)) {
          this.emitDiagnostic(err);
        } else {
          tickError = err;
        }
      }
    }

    // 4. Remove the claim. Cleanup ALWAYS proceeds (try/finally pattern)
    //    even when the tick rejected — the primary error is surfaced after.
    let cleanupError: unknown = null;
    if (this.claimPath !== null) {
      try {
        await this.fsPort.unlink(this.claimPath);
      } catch (err) {
        if (isErrnoError(err)) {
          this.emitDiagnostic(err);
        } else {
          cleanupError = err;
        }
      }
    }

    // 5. Surface internal errors (fail-fast). If both the tick and cleanup
    //    failed internally, aggregate both so neither is silently discarded.
    if (tickError !== null && cleanupError !== null) {
      throw new AggregateError(
        [tickError, cleanupError],
        'PerfRetention dispose: in-flight tick and claim cleanup both failed',
      );
    }
    if (tickError !== null) throw tickError;
    if (cleanupError !== null) throw cleanupError;
  }

  // -----------------------------------------------------------------------
  // Private
  /**
   * Attempts to stat a file. Returns null on filesystem errors (fail open,
   * rate-limited diagnostic emitted); rethrows internal/programming errors
   * (fail fast). ENOENT races (file removed between readdir and stat) count
   * as external fs and are rate-limited.
   */
  private async safeStat(
    fullPath: string,
  ): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      return await this.fsPort.stat(fullPath);
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        return null;
      }
      throw err;
    }
  }

  /**
   * Attempts to unlink a file. Returns true on success, false on filesystem
   * errors (fail open — accounting NOT decremented). Rethrows internal errors.
   */
  private async safeUnlink(fullPath: string): Promise<boolean> {
    try {
      await this.fsPort.unlink(fullPath);
      return true;
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        return false;
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------

  private async touchClaim(now: number): Promise<void> {
    if (this.claimPath === null) return;
    const date = new Date(now);
    try {
      await this.fsPort.utimes(this.claimPath, date, date);
    } catch (err) {
      if (isErrnoError(err)) {
        this.emitDiagnostic(err);
        return;
      }
      throw err;
    }
  }

  /**
   * Determines whether an artifact is protected from eviction. Delegates to
   * the centralized {@link isPerfJsonlProtected} / {@link isNonStaleClaim}
   * logic so retention and delete cannot drift (A).
   *
   * JSONL protection now includes claim-based protection: every JSONL file
   * belonging to a non-stale claim's run UUID is protected, regardless of
   * the JSONL's own mtime/day. The retention owner's own run is always
   * protected.
   */
  private isProtected(
    artifact: ArtifactInfo,
    now: number,
    protectedRunUuids: ReadonlySet<string>,
  ): boolean {
    if (isClaimFile(artifact.name)) {
      return isNonStaleClaim(artifact.mtimeMs, now, this.claimLeaseMs);
    }
    if (isPerfJsonl(artifact.name)) {
      return isPerfJsonlProtected(
        artifact.name,
        artifact.mtimeMs,
        now,
        this.maintenanceIntervalMs,
        protectedRunUuids,
        this.runUuid,
      );
    }
    return false;
  }

  private emitDiagnostic(err: unknown): void {
    const now = Date.now();
    if (now - this.lastDiagMs < this.diagRateLimitMs) return;
    this.lastDiagMs = now;
    const code =
      err instanceof Error
        ? ((err as NodeJS.ErrnoException).code ?? 'UNKNOWN')
        : 'UNKNOWN';
    this.onDiagnostic(`perf retention error: ${code}`);
  }
}

// ===========================================================================
// Module-private utilities
// ===========================================================================

function defaultDiagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Stable oldest-first comparison: by mtime, then by name. */
function compareArtifactAge(a: ArtifactInfo, b: ArtifactInfo): number {
  if (a.mtimeMs !== b.mtimeMs) {
    return a.mtimeMs < b.mtimeMs ? -1 : 1;
  }
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
