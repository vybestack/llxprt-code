/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import { warmupTokenCache } from './warmup-token-cache.js';

describe('warm-up token encodings', () => {
  it('preserves exact encoding, independent results and special-token rules across restoration', () => {
    const encoder = get_encoding('o200k_base');
    const text = 'History reads keep only one row in memory.';
    const expected = new Uint32Array([
      13508, 31523, 3357, 1606, 1001, 5225, 306, 8197, 13,
    ]);
    const restore = warmupTokenCache();
    try {
      const first = encoder.encode(text);
      expect(first).toStrictEqual(expected);
      first[0] = 0;
      expect(encoder.encode(text)).toStrictEqual(expected);
      expect(() => encoder.encode('<|endoftext|>')).toThrow('special token');
      expect(encoder.encode('<|endoftext|>', ['<|endoftext|>']).length).toBe(1);
    } finally {
      restore();
    }
    try {
      expect(encoder.encode(text)).toStrictEqual(expected);
    } finally {
      encoder.free();
    }
  });
});
