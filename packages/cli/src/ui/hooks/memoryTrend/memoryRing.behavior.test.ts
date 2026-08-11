/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 behavioral tests for MemoryRing (EVIDENCE-AC11).
 *
 * Fixed-capacity overwrite ring for the live /perf memory view. At the 60 s
 * sampling cadence the default capacity holds two hours of history. Pushing
 * beyond capacity overwrites the oldest entry. Snapshots are defensive copies
 * ordered oldest→newest with no internal aliasing.
 */

import { describe, it, expect } from 'bun:test';
import { MemoryRing, MEMORY_RING_CAPACITY } from './memoryRing.js';
import type { MemoryRingSample } from './memoryRing.js';

function makeSample(rss: number): MemoryRingSample {
  return {
    rss,
    heapUsed: rss + 1,
    external: rss + 2,
    arrayBuffers: rss + 3,
    uptimeMs: rss * 100,
    msSinceLastOperation: rss * 10,
    timestampMs: rss * 1000,
  };
}

describe('MemoryRing (AC-11)', () => {
  it('snapshot of an empty ring is empty', () => {
    const ring = new MemoryRing(4);
    expect(ring.snapshot()).toEqual([]);
    expect(ring.size).toBe(0);
  });

  it('pushes preserve oldest→newest order below capacity', () => {
    const ring = new MemoryRing(4);
    ring.push(makeSample(10));
    ring.push(makeSample(20));
    ring.push(makeSample(30));
    const snap = ring.snapshot();
    expect(snap).toHaveLength(3);
    expect(snap[0].rss).toBe(10);
    expect(snap[1].rss).toBe(20);
    expect(snap[2].rss).toBe(30);
    expect(ring.size).toBe(3);
  });

  it('overwrites oldest when capacity is exceeded', () => {
    const ring = new MemoryRing(3);
    ring.push(makeSample(10));
    ring.push(makeSample(20));
    ring.push(makeSample(30));
    ring.push(makeSample(40)); // overwrites 10
    const snap = ring.snapshot();
    expect(snap).toHaveLength(3);
    expect(snap[0].rss).toBe(20);
    expect(snap[1].rss).toBe(30);
    expect(snap[2].rss).toBe(40);
    expect(ring.size).toBe(3);
  });

  it('wraps around multiple times keeping only the newest capacity entries', () => {
    const ring = new MemoryRing(3);
    for (let i = 1; i <= 10; i++) {
      ring.push(makeSample(i * 10));
    }
    const snap = ring.snapshot();
    expect(snap).toHaveLength(3);
    expect(snap[0].rss).toBe(80);
    expect(snap[1].rss).toBe(90);
    expect(snap[2].rss).toBe(100);
  });

  it('snapshot is a defensive copy (mutating it does not affect the ring)', () => {
    const ring = new MemoryRing(4);
    ring.push(makeSample(10));
    ring.push(makeSample(20));
    const snap1 = ring.snapshot();
    // Attempt to mutate the returned array and its objects.
    (snap1 as Array<Partial<MemoryRingSample>>).push({ rss: 999 });
    (snap1[0] as { rss: number }).rss = 999;
    // The ring's internal state is unaffected.
    const snap2 = ring.snapshot();
    expect(snap2).toHaveLength(2);
    expect(snap2[0].rss).toBe(10);
    expect(snap2[1].rss).toBe(20);
  });

  it('two snapshot calls return independent arrays', () => {
    const ring = new MemoryRing(4);
    ring.push(makeSample(10));
    const snap1 = ring.snapshot();
    const snap2 = ring.snapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1).toEqual(snap2);
  });

  it('exposes the documented default capacity', () => {
    // 120 samples × 60 s = 2 hours of history at the monitor cadence.
    expect(MEMORY_RING_CAPACITY).toBe(120);
  });

  it('default capacity ring holds exactly capacity entries after overflow', () => {
    const ring = new MemoryRing();
    for (let i = 0; i < MEMORY_RING_CAPACITY + 50; i++) {
      ring.push(makeSample(i));
    }
    expect(ring.size).toBe(MEMORY_RING_CAPACITY);
    const snap = ring.snapshot();
    expect(snap).toHaveLength(MEMORY_RING_CAPACITY);
    // The oldest surviving entry is index 50 (first 50 were overwritten).
    expect(snap[0].rss).toBe(50);
    expect(snap[snap.length - 1].rss).toBe(MEMORY_RING_CAPACITY + 49);
  });
});

describe('MemoryRing capacity validation (AC-11)', () => {
  it('rejects capacity 0', () => {
    expect(() => new MemoryRing(0)).toThrow(RangeError);
  });

  it('rejects a negative capacity', () => {
    expect(() => new MemoryRing(-1)).toThrow(RangeError);
    expect(() => new MemoryRing(-100)).toThrow(RangeError);
  });

  it('rejects a fractional capacity', () => {
    expect(() => new MemoryRing(2.5)).toThrow(RangeError);
    expect(() => new MemoryRing(0.5)).toThrow(RangeError);
  });

  it('rejects NaN capacity', () => {
    expect(() => new MemoryRing(NaN)).toThrow(RangeError);
  });

  it('rejects Infinity capacity', () => {
    expect(() => new MemoryRing(Infinity)).toThrow(RangeError);
    expect(() => new MemoryRing(-Infinity)).toThrow(RangeError);
  });

  it('accepts capacity 1 and overwrites on every subsequent push', () => {
    const ring = new MemoryRing(1);
    expect(ring.size).toBe(0);
    expect(ring.snapshot()).toEqual([]);

    ring.push(makeSample(10));
    expect(ring.size).toBe(1);
    expect(ring.snapshot()[0].rss).toBe(10);

    // Overwrite: the sole slot is replaced.
    ring.push(makeSample(20));
    expect(ring.size).toBe(1);
    expect(ring.snapshot()).toHaveLength(1);
    expect(ring.snapshot()[0].rss).toBe(20);

    ring.push(makeSample(30));
    expect(ring.size).toBe(1);
    expect(ring.snapshot()[0].rss).toBe(30);
  });
});
