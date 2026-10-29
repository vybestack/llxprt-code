/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { encoding_for_model } from '@dqbd/tiktoken';
import { encodingLongTextCounter } from './neutral-long-piece.js';

describe('neutral token counting short-piece batches', () => {
  it('counts an ordinary prompt exactly without crossing the encoder boundary for every word', () => {
    const encoder = encoding_for_model('gpt-4o');
    const text = Array.from(
      { length: 400 },
      (_, index) => `section${index}: complete the requested operation.\n`,
    ).join('');
    let encodes = 0;
    let largest = 0;
    try {
      const tokens = encodingLongTextCounter('o200k_base')(
        text,
        (piece) => {
          encodes++;
          largest = Math.max(largest, piece.length);
          return encoder.encode(piece).length;
        },
        new Map<string, number>(),
      );
      expect(tokens).toBe(encoder.encode(text).length);
      expect(largest).toBeLessThanOrEqual(512);
      expect(encodes).toBeLessThanOrEqual(Math.ceil(text.length / 256));
    } finally {
      encoder.free();
    }
  });
});
