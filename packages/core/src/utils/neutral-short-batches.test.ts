/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { encoding_for_model, Tiktoken } from '@dqbd/tiktoken';
import { encodingLongTextCounter } from './neutral-long-piece.js';
import { estimateTokens } from './toolOutputLimiter.js';

describe('neutral token counting short-piece batches', () => {
  it('counts a one-shot quoted prompt exactly without encoding every word', () => {
    const text = Array.from(
      { length: 200 },
      (_, index) =>
        `Read "section${index}" and complete the requested operation.\n`,
    ).join('');
    const encoder = encoding_for_model('gpt-4o');
    const expected = encoder.encode(text).length;
    encoder.free();
    const encode = Tiktoken.prototype.encode;
    let encodes = 0;
    const measured = spyOn(Tiktoken.prototype, 'encode').mockImplementation(
      function (
        this: Tiktoken,
        ...args: Parameters<typeof encode>
      ): ReturnType<typeof encode> {
        encodes++;
        return encode.apply(this, args);
      },
    );
    try {
      expect(estimateTokens(text)).toBe(expected);
      expect(encodes).toBeLessThanOrEqual(Math.ceil(text.length / 256));
    } finally {
      measured.mockRestore();
    }
  });

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
