/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fixed-capacity overwrite ring for in-session memory samples (P10, AC-11).
 *
 * At the 60 s `MEMORY_CHECK_INTERVAL_MS` cadence, the default capacity of 120
 * samples holds two hours of history for the live `/perf` view. The ring never
 * grows beyond its capacity — pushing beyond it overwrites the oldest entry.
 * The leak detector must not leak.
 *
 * Snapshot returns a defensive copy ordered oldest→newest; the caller cannot
 * obtain a mutable alias to the internal buffer.
 */

/**
 * A single memory sample held by the ring. Carries the four memory values plus
 * the timing context needed for the live view and idle interpretation.
 */
export interface MemoryRingSample {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
  readonly uptimeMs: number;
  readonly msSinceLastOperation: number;
  readonly timestampMs: number;
}

/**
 * Default capacity: 120 samples × 60 s = 2 hours at the monitor cadence.
 * Bounded — never grows beyond this regardless of session length.
 */
export const MEMORY_RING_CAPACITY = 120;

export class MemoryRing {
  private readonly buffer: Array<MemoryRingSample | undefined>;
  private readonly capacity: number;
  private head = 0;
  private len = 0;

  constructor(capacity: number = MEMORY_RING_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `MemoryRing capacity must be a positive integer (got ${capacity})`,
      );
    }
    this.capacity = capacity;
    this.buffer = new Array<MemoryRingSample | undefined>(capacity);
  }

  push(sample: MemoryRingSample): void {
    this.buffer[this.head] = sample;
    this.head = (this.head + 1) % this.capacity;
    if (this.len < this.capacity) {
      this.len += 1;
    }
  }

  get size(): number {
    return this.len;
  }

  snapshot(): readonly MemoryRingSample[] {
    const result: MemoryRingSample[] = [];
    const start = this.len < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.len; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry !== undefined) {
        result.push({ ...entry });
      }
    }
    return result;
  }
}
