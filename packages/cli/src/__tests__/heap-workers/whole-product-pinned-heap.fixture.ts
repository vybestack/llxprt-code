/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { wholeProductHeap } from '../../__tests__/support/whole-product-heap.js';
import { measurementMode } from '../../__tests__/support/whole-product-measurement.js';

describe('pinned-code-v1 whole-product retained heap', () => {
  it('releases history under the unchanged unfiltered heap bounds', async () => {
    expect(measurementMode()).toBe('pinned-code-v1');
    expect(await wholeProductHeap(process.env.W24_RETAINING_TRAP === '1')).toBe(
      true,
    );
  }, 290000);
});
