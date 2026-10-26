/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import { encodingLongTextCounter } from './neutral-long-piece.js';

const oracle = get_encoding('o200k_base');

describe('unit-scoped neutral count reuse', () => {
  afterAll(() => oracle.free());
  it('shares lexical runs between single and repeated projections without changing boundaries', () => {
    const messages = [
      { role: 'user', content: 'cold payload 雪 '.repeat(1800) },
    ];
    const cache = new Map<string, number>();
    const count = encodingLongTextCounter('o200k_base');
    let encodedChars = 0;
    const encode = (text: string): number => {
      encodedChars += text.length;
      return oracle.encode(text).length;
    };
    const single = JSON.stringify({ messages });
    const repeated = JSON.stringify({ messages: [...messages, ...messages] });
    expect(count(single, encode, cache)).toBe(oracle.encode(single).length);
    expect(count(repeated, encode, cache)).toBe(oracle.encode(repeated).length);
    expect(encodedChars).toBeLessThan(single.length + 128);
  });

  it('shares long pieces but keeps surrounding punctuation and Unicode exact', () => {
    const cache = new Map<string, number>();
    const count = encodingLongTextCounter('o200k_base');
    const text = 'x'.repeat(65536);
    for (const value of [
      `{"text":"${text}"}`,
      ` {"text":"${text}","other":"${text}"} 'S\n\u0085\ufeff`,
    ])
      expect(count(value, (piece) => oracle.encode(piece).length, cache)).toBe(
        oracle.encode(value).length,
      );
  });
});
