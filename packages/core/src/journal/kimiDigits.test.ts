/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { kimiDigitRange } from './kimiDigits.js';

describe('Kimi decimal counter digit sums', () => {
  it('sums half-open counter ranges across zero and decimal boundaries', () => {
    for (const first of [0, 1, 8, 9, 10, 98, 99, 100, 998, 999, 1000])
      for (const count of [0, 1, 2, 10, 103])
        expect(kimiDigitRange(first, count)).toBe(
          Array.from(
            { length: count },
            (_, index) => String(first + index).length,
          ).reduce((sum, width) => sum + width, 0),
        );
  });
  it('handles a trillion counter uses without iterating the uses', () => {
    expect(kimiDigitRange(0, 1_000_000_000_000)).toBe(11_888_888_888_890);
    expect(kimiDigitRange(9_007_199_254_740_990, 1)).toBe(16);
  });
  it('refuses unsafe inputs, end counters and digit totals instead of rounding', () => {
    for (const [first, count] of [
      [-1, 2],
      [0.5, 1],
      [0, NaN],
      [Infinity, 1],
      [Number.MAX_SAFE_INTEGER, 1],
      [0, Number.MAX_SAFE_INTEGER],
    ])
      expect(() => kimiDigitRange(first, count)).toThrow(/safe integer/);
  });
});
