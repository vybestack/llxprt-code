/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PerfSink — serialized no-drop perf telemetry writer (P04B, D4).
 *
 * A constructible (non-singleton) writer that does NOT inherit FileOutput.
 * Uses a serialized promise chain: one record per operation, own back-pressure,
 * no bounded queue, no drop counter.
 *
 * File layout: one exclusive-created 0600 file per run UUID per UTC record
 * day: `perf-YYYYMMDD-<runUuid>.jsonl`. The day comes from each record's `ts`
 * and rolls on the next serialized record whose day differs. Empty sink
 * creates no file. Dispose drains all accepted writes.
 *
 * Error policy (D8): schema/programming/serialization errors fail fast to the
 * caller (synchronous throw before queueing). Only filesystem
 * create/append/close errors fail-open and are rate-limited.
 *
 * Decision: FileOutput is left untouched. The only overlap with FileOutput is
 * directory-creation and file-append, which are 2-line primitives too trivial
 * to extract. FileOutput does not use exclusive-open (`wx`), has a different
 * naming scheme, and carries a bounded/drop queue that PerfSink must not
 * inherit (D4). Extraction would broaden scope and risk the singleton/debug
 * behavior — not warranted.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PerfRecordSchema } from './perfRecords.js';
import { requireValidRunUuid } from './perfArtifacts.js';
import type { PerfRetention } from './retention.js';

// ---------------------------------------------------------------------------
// Filesystem port (D6 — package-private for deterministic fault injection)
// ---------------------------------------------------------------------------

/**
 * Narrow filesystem port used by PerfSink. The default implementation uses
 * real `node:fs/promises`; tests inject {@link FaultInjectingPerfFilesystem}
 * or a custom implementation to produce deterministic EACCES/EROFS/ENOSPC
 * failures at the append boundary without filling a disk or relying on chmod.
 */
export interface PerfSinkFilesystem {
  ensureDir(dir: string): Promise<void>;
  openExclusive(path: string, mode: number): Promise<void>;
  appendFile(path: string, data: string, mode: number): Promise<void>;
}

/** Default filesystem port using real `node:fs/promises`. */
class RealPerfFilesystem implements PerfSinkFilesystem {
  async ensureDir(dir: string): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  async openExclusive(filePath: string, mode: number): Promise<void> {
    const handle = await fs.open(filePath, 'wx', mode);
    await handle.close();
  }

  async appendFile(
    filePath: string,
    data: string,
    mode: number,
  ): Promise<void> {
    await fs.appendFile(filePath, data, { encoding: 'utf8', mode });
  }
}

/**
 * Deterministic fault-injecting filesystem port. Fails the configured method
 * with the given errno code on every call, delegating all other methods to the
 * real implementation. Used by fault-injection tests (D6) — never fills a real
 * disk or relies on chmod.
 */
export class FaultInjectingPerfFilesystem implements PerfSinkFilesystem {
  private readonly real = new RealPerfFilesystem();

  constructor(
    private readonly fault: {
      readonly failMethod: 'appendFile' | 'openExclusive' | 'ensureDir';
      readonly code: 'EACCES' | 'EROFS' | 'ENOSPC';
    },
  ) {}

  async ensureDir(dir: string): Promise<void> {
    if (this.fault.failMethod === 'ensureDir') {
      throw this.makeError();
    }
    await this.real.ensureDir(dir);
  }

  async openExclusive(filePath: string, mode: number): Promise<void> {
    if (this.fault.failMethod === 'openExclusive') {
      throw this.makeError();
    }
    await this.real.openExclusive(filePath, mode);
  }

  async appendFile(
    filePath: string,
    data: string,
    mode: number,
  ): Promise<void> {
    if (this.fault.failMethod === 'appendFile') {
      throw this.makeError();
    }
    await this.real.appendFile(filePath, data, mode);
  }

  private makeError(): NodeJS.ErrnoException {
    const err = new Error(
      `fault-injected ${this.fault.code}`,
    ) as NodeJS.ErrnoException;
    err.code = this.fault.code;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a UTC YYYYMMDD day key from an ISO 8601 timestamp string.
 */
function utcDayKey(ts: string): string {
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Determines whether an error carries a Node.js errno code, indicating a
 * filesystem persistence failure (fail-open). Errors without an errno code
 * are programming errors and must propagate (fail fast).
 */
function isErrnoError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return typeof (err as NodeJS.ErrnoException).code === 'string';
}

/**
 * Extracts the errno code from an error, or 'UNKNOWN' if none. Shared by the
 * self-health surface and the diagnostic message so they cannot drift.
 */
function extractErrnoCode(err: unknown): string {
  return err instanceof Error
    ? ((err as NodeJS.ErrnoException).code ?? 'UNKNOWN')
    : 'UNKNOWN';
}

const DEFAULT_DIAG_RATE_LIMIT_MS = 60_000;

function defaultDiagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// PerfSink
// ---------------------------------------------------------------------------

export interface PerfSinkOptions {
  readonly dir: string;
  readonly runUuid: string;
  readonly fs?: PerfSinkFilesystem;
  readonly retention?: PerfRetention;
  readonly diagRateLimitMs?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export class PerfSink {
  private readonly sinkDir: string;
  private readonly runUuid: string;
  private readonly fsPort: PerfSinkFilesystem;
  private readonly retention: PerfRetention | null;
  private readonly diagRateLimitMs: number;
  private readonly onDiagnostic: (message: string) => void;

  private fileDayKey: string | null = null;
  private currentPath: string | null = null;
  private bytesSinceStat = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private lastDiagMs = 0;
  private disposed = false;
  // P11 self-health: the errno code of the latest filesystem write failure
  // in THIS process, or null if no write has failed. Narrow read-only state
  // for the inspect/report self-health surface — NOT persisted.
  private latestWriteErrorCode: string | null = null;

  constructor(options: PerfSinkOptions) {
    this.sinkDir = options.dir;
    this.runUuid = requireValidRunUuid(options.runUuid);
    this.fsPort = options.fs ?? new RealPerfFilesystem();
    this.retention = options.retention ?? null;
    this.diagRateLimitMs =
      options.diagRateLimitMs ?? DEFAULT_DIAG_RATE_LIMIT_MS;
    this.onDiagnostic = options.onDiagnostic ?? defaultDiagnostic;
  }

  /**
   * Starts the optional retention owner (creates the per-run claim file and
   * the one owned maintenance interval). Must be awaited before writing if a
   * retention owner was provided, so the runtime (P12) can await it before
   * installing observers. If no retention owner was provided, this is a no-op.
   *
   * An empty started sink creates ONLY its claim — no perf JSONL.
   */
  async start(): Promise<void> {
    if (this.retention !== null) {
      await this.retention.start();
    }
  }

  /**
   * Validates and serializes the record through the schema, then queues a
   * serialized filesystem append.
   *
   * Schema/programming/serialization errors throw synchronously (fail fast).
   * Filesystem errors are caught and rate-limited (fail-open) — the returned
   * promise always resolves for filesystem errors.
   *
   * After dispose, returns the current chain without queueing a new write.
   */
  write(record: unknown): Promise<void> {
    if (this.disposed) {
      return this.writeChain;
    }

    // Fail fast: validate + serialize BEFORE queueing. These throw
    // synchronously to the caller — they are NOT filesystem errors.
    const validated = PerfRecordSchema.parse(record);
    const payload = JSON.stringify(validated) + '\n';
    const dayKey = utcDayKey(validated.ts);

    // Serialize the append through the no-drop promise chain.
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.appendPayload(payload, dayKey);
      } catch (err) {
        if (isErrnoError(err)) {
          this.emitDiagnostic(err);
        } else {
          throw err;
        }
      }
    });

    return this.writeChain;
  }

  /**
   * Blocks further writes deterministically, drains all accepted writes,
   * then stops maintenance and removes the claim cleanly (if a retention
   * owner was provided). Always runs BOTH the write-chain drain and the
   * retention disposal, aggregating internal failures via AggregateError so
   * an internal write rejection cannot skip claim/timer cleanup.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const errors: unknown[] = [];
    try {
      await this.writeChain;
    } catch (err) {
      errors.push(err);
    }
    if (this.retention !== null) {
      try {
        await this.retention.dispose();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length === 1) throw errors[0]!;
    if (errors.length > 1) {
      throw new AggregateError(errors, 'PerfSink disposal');
    }
  }

  get byteCount(): number {
    return this.bytesSinceStat;
  }

  /**
   * P11 self-health: the errno code of the latest filesystem write failure in
   * THIS process (e.g. 'EACCES'), or null if no write has failed. Used by the
   * inspect/report self-health surface to surface the current-process write
   * health. Not persisted.
   */
  get lastWriteErrorCode(): string | null {
    return this.latestWriteErrorCode;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async appendPayload(payload: string, dayKey: string): Promise<void> {
    if (dayKey !== this.fileDayKey || this.currentPath === null) {
      await this.rollToNewFile(dayKey);
    }
    const target = this.currentPath;
    if (target === null) {
      throw new Error(
        'PerfSink internal error: currentPath is null after roll',
      );
    }
    await this.fsPort.appendFile(target, payload, 0o600);
    this.bytesSinceStat += Buffer.byteLength(payload);
  }

  private async rollToNewFile(dayKey: string): Promise<void> {
    const name = `perf-${dayKey}-${this.runUuid}.jsonl`;
    const filePath = join(this.sinkDir, name);

    // Filesystem operations only — any error here is a filesystem error.
    await this.fsPort.ensureDir(this.sinkDir);
    await this.fsPort.openExclusive(filePath, 0o600);

    // State advances ONLY after successful exclusive open.
    this.currentPath = filePath;
    this.bytesSinceStat = 0;
    this.fileDayKey = dayKey;

    // Roll boundary triggers rate-limited maintenance so a 24/7 process
    // that never restarts still bounds growth. maybeMaintain handles its
    // own filesystem errors (fail-open); only internal errors propagate.
    if (this.retention !== null) {
      await this.retention.maybeMaintain(Date.now());
    }
  }

  private emitDiagnostic(err: unknown): void {
    const now = Date.now();
    // P11 self-health: always record the latest error code even if the
    // diagnostic message is rate-limited. The code is surfaced by the
    // inspect/report self-health surface.
    const code = extractErrnoCode(err);
    this.latestWriteErrorCode = code;
    if (now - this.lastDiagMs < this.diagRateLimitMs) {
      return;
    }
    this.lastDiagMs = now;
    this.onDiagnostic(`perf telemetry write failed: ${code}`);
  }
}
