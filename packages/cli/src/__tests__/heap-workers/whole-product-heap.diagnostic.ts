/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { wholeProductHeap } from '../../__tests__/support/whole-product-heap.js';

describe('whole-product native retained heap and history I/O', () => {
  it('releases rows between 50 real Agent turns inside the original allowance', async () => {
    expect(await wholeProductHeap(process.env.W24_RETAINING_TRAP === '1')).toBe(
      true,
    );
  }, 290000);
});
