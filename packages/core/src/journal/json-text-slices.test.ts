/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { jsonTextSlices } from './json-text-slices.js';

async function* pieces(
  value: string,
  size: number,
): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  for (let at = 0; at < bytes.length; at += size)
    yield bytes.subarray(at, at + size);
}

describe('streamed journal string decoding', () => {
  for (const size of [1, 2, 7, 65536]) {
    it(`preserves JSON escapes and Unicode across ${size}-byte boundaries`, async () => {
      const text = '"\\\n\t\r\b\f🌙漢字\ud800'.repeat(1000);
      const slices = await Array.fromAsync(
        jsonTextSlices(
          pieces(
            JSON.stringify({
              type: 'text',
              text,
              metadata: { text: 'not selected' },
            }),
            size,
          ),
          'text',
          127,
        ),
      );
      expect(slices.join('')).toBe(text);
      expect(slices.every((slice) => slice.length <= 128)).toBe(true);
    });
  }
  it('fails on incomplete escapes and missing fields', async () => {
    await expect(
      Array.fromAsync(
        jsonTextSlices(pieces('{"text":"bad\\u00', 1), 'text', 32),
      ),
    ).rejects.toThrow(/Incomplete/);
    await expect(
      Array.fromAsync(
        jsonTextSlices(pieces('{"other":"value"}', 1), 'text', 32),
      ),
    ).rejects.toThrow('Incomplete');
  });
});
