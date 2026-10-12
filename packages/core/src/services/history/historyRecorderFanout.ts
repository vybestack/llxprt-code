/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { SessionEventType } from '../../recording/types.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';

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
 * Publish-time pump from the hidden primary journal to the bindings.
 *
 * Nothing is staged in memory. After a publication succeeds, `schedule('feed')`
 * waits for the primary's commit watermark and re-reads the committed byte
 * range [cursor, watermark) line by line, so the cost does not grow with the
 * size of the publication. A failed publication calls `schedule('skip')`,
 * which advances the cursor past the range without delivering it: neither
 * recording sees the rolled-back rows nor the compensation that undid them.
 */
export class HistoryFanoutFeed {
  private cursor = 0;
  private primary: SessionRecordingService | undefined;
  private chain: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];

  constructor(private readonly fanout: HistoryRecorderFanout) {}

  /** Point the pump at a new primary journal; callers settle first. */
  reset(primary: SessionRecordingService, cursor: number): void {
    this.primary = primary;
    this.cursor = cursor;
  }

  schedule(
    primary: SessionRecordingService,
    seq: number,
    mode: 'feed' | 'skip',
  ): void {
    this.chain = this.chain.then(async () => {
      try {
        if (primary !== this.primary)
          throw new Error('History fan-out primary changed before delivery');
        const { byteOffset } = await primary.waitForCommitSequence(seq);
        const start = this.cursor;
        if (byteOffset <= start) return;
        this.cursor = byteOffset;
        if (mode === 'feed')
          await this.deliverRange(primary, start, byteOffset);
      } catch (error) {
        this.failures.push(error);
      }
    });
  }

  private async deliverRange(
    primary: SessionRecordingService,
    start: number,
    end: number,
  ): Promise<void> {
    const filePath = primary.getFilePath();
    if (filePath === null) return;
    const stream = createReadStream(filePath, { start, end: end - 1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const failures: unknown[] = [];
    try {
      for await (const line of lines) {
        if (line.length === 0) continue;
        const record = JSON.parse(line) as {
          type: SessionEventType;
          payload: unknown;
        };
        try {
          this.fanout.deliver(record.type, record.payload);
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    rethrow(failures, 'Recorder fan-out failed');
  }

  /** Resolve once every scheduled delivery ran; rethrow what failed. */
  async settle(): Promise<void> {
    await this.chain;
    const failures = this.failures;
    this.failures = [];
    rethrow(failures, 'Recorder fan-out failed');
  }
}
