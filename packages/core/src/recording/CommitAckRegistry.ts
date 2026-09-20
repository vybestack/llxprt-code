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
 * Per-record commit acknowledgement registry for the session recording
 * service (PLAN-20260917-ISSUE854.P05b2).
 *
 * Tracks pending `commit`/`waitForCommit` acks keyed by envelope seq,
 * resolves them in seq order after each durably appended batch (watermarks
 * are monotone in both seq and byte offset), rejects every outstanding ack
 * when a write fails or the recorder is disposed, owns the committed-byte
 * counter that seeds absolute watermark offsets from the journal file size,
 * and provides the drain-completion gate that holds backpressure waiters in
 * `commit`.
 *
 * Extracted from SessionRecordingService for file size
 * (PLAN-20260917-ISSUE854.P05b2); behaviour is unchanged.
 */

import * as fs from 'node:fs/promises';
import { type CommitWatermark } from './types.js';

/** Structural view of a serialized record needed for watermark math. */
export interface AckableRecord {
  readonly seq: number;
  readonly bytes: number;
}

interface PendingCommitAck {
  readonly seq: number;
  resolve(watermark: CommitWatermark): void;
  reject(error: unknown): void;
  /** Adopted settlement of `deferred`, chained after the previous ack so resolutions stay in seq order. */
  readonly chained: Promise<CommitWatermark>;
}

export class CommitAckRegistry {
  private readonly pending = new Map<number, PendingCommitAck>();
  /** Chained promise of the most recently registered ack; anchors seq-ordered resolution. */
  private tail: Promise<CommitWatermark> | null = null;
  /** Highest seq whose batch completed an append. */
  private highestAckedSeq: number = 0;
  /** Watermark of the most recently acked record. */
  private latestWatermark: CommitWatermark | null = null;
  /**
   * Exclusive end offset of the journal bytes covered by acked records.
   * Seeded from the file size on the first drained batch (resume-safe), then
   * advanced by each completed batch.
   */
  private committedBytes: number | null = null;
  /** Resolved when the current drain cycle completes; gates backpressure waiters. */
  private drainDone: (() => void) | null = null;
  private drainDonePromise: Promise<void> | null = null;

  /** Acks still waiting for a drained batch. */
  get pendingCount(): number {
    return this.pending.size;
  }

  get lastAckedSeq(): number {
    return this.highestAckedSeq;
  }

  get lastWatermark(): CommitWatermark | null {
    return this.latestWatermark;
  }

  /** Exclusive end offset of acked bytes; 0 before the first drained batch. */
  get baseOffset(): number {
    return this.committedBytes ?? 0;
  }

  find(seq: number): PendingCommitAck | undefined {
    return this.pending.get(seq);
  }

  /**
   * Register a pending ack for `seq`. Each ack's visible promise is chained
   * after the previous one, so a later record's ack never resolves before an
   * earlier's while both are pending.
   */
  register(seq: number): PendingCommitAck {
    let resolve!: (watermark: CommitWatermark) => void;
    let reject!: (error: unknown) => void;
    const deferred = new Promise<CommitWatermark>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const tail = this.tail;
    const chained =
      tail === null
        ? deferred
        : tail.then(
            () => deferred,
            () => deferred,
          );
    const ack: PendingCommitAck = { seq, resolve, reject, chained };
    this.pending.set(seq, ack);
    this.tail = chained;
    return ack;
  }

  /** Reject and drop the ack for `seq` if one is pending; no-op otherwise. */
  reject(seq: number, error: unknown): void {
    const ack = this.pending.get(seq);
    if (ack !== undefined) {
      this.pending.delete(seq);
      ack.reject(error);
    }
  }

  /** Reject every outstanding ack with `error` and drop them all. */
  failAll(error: unknown): void {
    const acks = [...this.pending.values()];
    this.pending.clear();
    for (const ack of acks) {
      ack.reject(error);
    }
  }

  nextDrainCompletion(): Promise<void> {
    this.drainDonePromise ??= new Promise<void>((resolve) => {
      this.drainDone = resolve;
    });
    return this.drainDonePromise;
  }

  notifyDrainCompletion(): void {
    const done = this.drainDone;
    this.drainDone = null;
    this.drainDonePromise = null;
    done?.();
  }

  /**
   * Seed the committed byte counter from the journal file before the first
   * acked batch, so watermarks carry absolute file offsets across resumed
   * sessions. A missing file is the pre-first-append state (offset 0).
   */
  async ensureBaseOffset(filePath: string): Promise<void> {
    if (this.committedBytes !== null) return;
    try {
      const stat = await fs.stat(filePath);
      this.committedBytes = stat.size;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      this.committedBytes = 0;
    }
  }

  /**
   * Drop the seeded base offset so the next drained batch re-seeds from the
   * (possibly different) journal file's size.
   */
  resetBaseOffset(): void {
    this.committedBytes = null;
  }

  /**
   * Resolve per-record acks after a batch append completed, in seq order,
   * advancing the committed-byte counter to the batch's exclusive end offset.
   *
   * The batch's first ack resolves synchronously; each subsequent ack
   * resolves in a strictly later macrotask. Resolving two same-batch acks in
   * one synchronous section let a later record's chained promise settle
   * before an earlier record's observer resumed its `await`, so an observer
   * of ack N could observe ack N+1 already resolved. A macrotask boundary
   * guarantees every microtask observer of ack N — including `await`
   * resumptions — runs before ack N+1 resolves
   * (PLAN-20260917-ISSUE854.P05b2).
   */
  fireBatch(batch: readonly AckableRecord[], startOffset: number): void {
    let endOffset = startOffset;
    let firedFirst = false;
    for (const record of batch) {
      endOffset += record.bytes;
      const watermark: CommitWatermark = {
        seq: record.seq,
        byteOffset: endOffset,
      };
      this.highestAckedSeq = Math.max(this.highestAckedSeq, record.seq);
      this.latestWatermark = watermark;
      const ack = this.pending.get(record.seq);
      if (ack !== undefined) {
        this.pending.delete(record.seq);
        if (firedFirst) {
          setTimeout(() => {
            ack.resolve(watermark);
          }, 0);
        } else {
          ack.resolve(watermark);
          firedFirst = true;
        }
      }
    }
    this.committedBytes = endOffset;
  }
}
