/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  collectedWithin,
  median,
  medianOfRuns,
  medianSettledDelta,
  settledHeap,
} from './settled-heap.js';

const ONE_MIB = 1024 * 1024;

describe('settled heap measurement helpers', () => {
  it('median picks the middle value and averages the middle pair', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([4, 1, 9, 2])).toBe(3);
    expect(() => median([])).toThrow('at least one value');
  });

  it('settledHeap converges on a stable heap with a positive reading', async () => {
    expect(await settledHeap()).toBeGreaterThan(0);
  });

  it('medianSettledDelta stays under 1 MiB for an operation that releases everything', async () => {
    const delta = await medianSettledDelta(async () => {
      const scratch = Array.from({ length: 64 }, (_, i) => ({
        i,
        pad: 'x'.repeat(4096),
      }));
      await Promise.resolve(scratch.length);
    });
    expect(delta).toBeLessThan(ONE_MIB);
  });

  it('trap: medianSettledDelta fails the 1 MiB bound when every run retains 4 MiB', async () => {
    const retained: Uint8Array[] = [];
    const delta = await medianSettledDelta(async () => {
      const block = new Uint8Array(4 * ONE_MIB);
      block.fill(1);
      retained.push(block);
      await Promise.resolve();
    });
    expect(delta).toBeGreaterThan(ONE_MIB);
    expect(retained.length).toBeGreaterThan(0);
  });

  it('medianOfRuns ignores one outlier run but reports a delta present in every run', async () => {
    const outlier = [10, 10, 9_000_000, 10, 10];
    let index = 0;
    expect(await medianOfRuns(async () => outlier[index++], 3)).toBe(10);
    expect(await medianOfRuns(async () => 5 * ONE_MIB, 3)).toBe(5 * ONE_MIB);
  });

  it('collectedWithin sees a dropped object collected and a held one retained', async () => {
    const held = { held: true };
    const heldRef = new WeakRef<object>(held);
    const droppedRef = (() => new WeakRef<object>({ dropped: true }))();
    expect(await collectedWithin(droppedRef, 12)).toBe(true);
    expect(await collectedWithin(heldRef, 3)).toBe(false);
    expect(held.held).toBe(true);
  });
});
