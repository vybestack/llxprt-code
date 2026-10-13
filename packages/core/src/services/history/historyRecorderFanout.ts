/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type {
  SessionEventType,
  SessionRecordLine,
} from '../../recording/types.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';
import {
  scanJournalRecords,
  type ScannedJournalRecord,
} from './historyJournalRecordScan.js';

interface FanoutBinding {
  readonly origin: string;
  readonly recorder: SessionRecordingService;
}

function rowOrigin(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const origin = (payload as { origin?: unknown }).origin;
  return typeof origin === 'string' ? origin : undefined;
}

function rethrow(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

/**
 * Per-origin recorder bindings behind one history. Each binding records the
 * rows of its own origin plus unowned rows and skips foreign-origin rows.
 * Once a fan-out is active the history's primary journal is hidden and holds
 * every row; the bindings are filtered mirrors of it.
 */
export class HistoryRecorderFanout {
  private readonly bindings: FanoutBinding[] = [];
  active = false;

  get size(): number {
    return this.bindings.length;
  }

  /** Re-binding an origin replaces that origin's recorder; others are untouched. */
  bind(origin: string, recorder: SessionRecordingService): void {
    const index = this.bindings.findIndex((entry) => entry.origin === origin);
    const binding = { origin, recorder };
    if (index >= 0) this.bindings[index] = binding;
    else this.bindings.push(binding);
  }

  unbind(recorder: SessionRecordingService): boolean {
    const index = this.bindings.findIndex(
      (entry) => entry.recorder === recorder,
    );
    if (index < 0) return false;
    this.bindings.splice(index, 1);
    return true;
  }

  has(recorder: SessionRecordingService): boolean {
    return this.bindings.some((entry) => entry.recorder === recorder);
  }

  /**
   * Hand one committed primary row to every accepting binding. One refusing
   * recorder does not starve the others; failures are rethrown together.
   */
  deliver(type: SessionEventType, payload: unknown): void {
    const origin = rowOrigin(payload);
    const failures: unknown[] = [];
    for (const binding of this.bindings) {
      if (!acceptsHistoryOrigin(binding.origin, origin)) continue;
      try {
        binding.recorder.requireCommittable();
        if (binding.recorder.enqueue(type, payload) === null)
          throw new Error(`Session recording is inactive (${type})`);
      } catch (error) {
        failures.push(error);
      }
    }
    rethrow(failures, 'Recorder fan-out failed');
  }
}

/**
 * How the pump treats the records up to a sequence:
 * - `deliver`: hand them to the mirrors;
 * - `advance`: they already reached the mirrors directly, only move past them;
 * - `drop`: their publication failed, so neither they nor the compensation
 *   that undid them may reach a mirror.
 */
export type FanoutFeedMode = 'deliver' | 'advance' | 'drop';

/**
 * Publish-time pump from the hidden primary journal to the bindings.
 *
 * Nothing is staged in memory. After a publication succeeds,
 * `schedule(..., 'deliver')` waits until the primary has committed the
 * publication's last record, then streams the committed records after the
 * cursor one at a time, up to and including that record and no further. The
 * bound is the record sequence, never the commit watermark: the watermark of
 * an already acknowledged sequence is the latest one, which may already cover
 * later records of other publications. A failed publication schedules
 * `drop`, which moves the cursor past its records without delivering them.
 */
export class HistoryFanoutFeed {
  private cursor = 0;
  private consumedSeq = 0;
  private primary: SessionRecordingService | undefined;
  private chain: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private scheduled = 0;

  constructor(private readonly fanout: HistoryRecorderFanout) {}

  /** Point the pump at a new primary journal; callers settle first. */
  reset(primary: SessionRecordingService, cursor: number): void {
    this.primary = primary;
    this.cursor = cursor;
    this.consumedSeq = 0;
  }

  /** True when no scheduled delivery is pending, so direct delivery keeps row order. */
  get idle(): boolean {
    return this.scheduled === 0;
  }

  /**
   * Hand just-admitted rows straight to the mirrors, then move the cursor
   * past them once the primary commits the last one. The caller checks
   * {@link idle} first so row order is kept; direct delivery is what lets a
   * small publication reach the mirrors as soon as it publishes, the way it
   * reaches a sole recorder. A refusing mirror is reported through
   * {@link settle}, like a pump failure.
   */
  deliverNow(
    primary: SessionRecordingService,
    lines: ReadonlyArray<Pick<SessionRecordLine, 'seq' | 'type' | 'payload'>>,
  ): void {
    if (lines.length === 0) return;
    const last = lines[lines.length - 1];
    for (const line of lines) {
      try {
        this.fanout.deliver(line.type, line.payload);
      } catch (error) {
        this.failures.push(error);
      }
    }
    this.schedule(primary, last.seq, 'advance');
  }

  schedule(
    primary: SessionRecordingService,
    seq: number,
    mode: FanoutFeedMode,
  ): void {
    this.scheduled++;
    this.chain = this.chain.then(async () => {
      try {
        if (primary !== this.primary)
          throw new Error('History fan-out primary changed before delivery');
        if (seq <= this.consumedSeq) return;
        const { byteOffset } = await primary.waitForCommitSequence(seq);
        await this.consume(primary, seq, byteOffset, mode);
      } catch (error) {
        this.failures.push(error);
      } finally {
        this.scheduled--;
      }
    });
  }

  /** Consume the records from the cursor through `seq`; `limit` bounds the read. */
  private async consume(
    primary: SessionRecordingService,
    seq: number,
    limit: number,
    mode: FanoutFeedMode,
  ): Promise<void> {
    const filePath = primary.getFilePath();
    if (filePath === null)
      throw new Error('History fan-out primary has no journal file');
    const failures: unknown[] = [];
    for await (const record of scanJournalRecords(
      filePath,
      this.cursor,
      limit,
    )) {
      if (record.seq <= seq) {
        this.cursor = record.end;
        this.consumedSeq = record.seq;
        if (mode === 'deliver') this.deliverRecord(record, failures);
      }
      if (record.seq >= seq) break;
    }
    if (this.consumedSeq < seq)
      throw new Error(
        `History fan-out primary record ${seq} was not found after byte ${this.cursor}`,
      );
    rethrow(failures, 'Recorder fan-out failed');
  }

  private deliverRecord(
    record: ScannedJournalRecord,
    failures: unknown[],
  ): void {
    try {
      this.fanout.deliver(record.type, record.payload);
    } catch (error) {
      failures.push(error);
    }
  }

  /** Resolve once every scheduled delivery ran; rethrow what failed. */
  async settle(): Promise<void> {
    await this.chain;
    const failures = this.failures;
    this.failures = [];
    rethrow(failures, 'Recorder fan-out failed');
  }
}
