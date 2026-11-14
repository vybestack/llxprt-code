/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { wholeProductDefaultCensus } from '../../__tests__/support/whole-product-default-census.js';

describe('default-runtime whole-product history census', () => {
  it('releases decoded history and rejects a growing history holder', async () => {
    expect(
      await wholeProductDefaultCensus(process.env.W24_RETAINING_TRAP === '1'),
    ).toBe(true);
  }, 90000);
});
