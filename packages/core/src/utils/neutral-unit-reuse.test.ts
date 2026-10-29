/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import { encodingLongTextCounter } from './neutral-long-piece.js';

const oracle = get_encoding('o200k_base');

describe('unit-scoped neutral count reuse', () => {
  afterAll(() => oracle.free());
  it('bounds encoded short-piece work per row at two history sizes', () => {
    const count = encodingLongTextCounter('o200k_base');
    const measured = [20, 40].map((rows) => {
      let characters = 0;
      let tokens = 0;
      for (let index = 0; index < rows; index++) {
        const text = JSON.stringify({
          messages: [
            { role: 'user', content: 'cold payload 雪 '.repeat(1800) },
          ],
        });
        tokens += count(
          text,
          (piece) => {
            characters += piece.length;
            return oracle.encode(piece).length;
          },
          new Map<string, number>(),
        );
      }
      return { rows, characters, tokens };
    });
    expect(measured[1].tokens).toBe(measured[0].tokens * 2);
    expect(measured[1].characters).toBe(measured[0].characters * 2);
    const expected = oracle.encode(
      JSON.stringify({
        messages: [{ role: 'user', content: 'cold payload 雪 '.repeat(1800) }],
      }),
    ).length;
    for (const result of measured) {
      expect(result.tokens).toBe(expected * result.rows);
      expect(result.characters).toBeLessThan(result.rows * 256);
    }
  });

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
