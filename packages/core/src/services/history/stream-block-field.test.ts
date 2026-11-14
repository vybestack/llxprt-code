/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { DirectoryBlock } from '../../journal/row-directory.js';
import { streamBlockField } from './stream-block-field.js';
function block(text: string, size: number): DirectoryBlock {
  const bytes = Buffer.from(text);
  return {
    ordinal: 0,
    type: 0,
    length: bytes.length,
    async *parts() {
      for (let offset = 0; offset < bytes.length; offset += size)
        yield bytes.subarray(offset, offset + size);
    },
  };
}
async function projected(
  text: string,
  field: string,
  size: number,
  raw = false,
): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of streamBlockField(block(text, size), field, raw))
    parts.push(Buffer.from(part));
  return Buffer.concat(parts).toString();
}
describe('bounded block field projection', () => {
  it('decodes selected strings and preserves structured JSON across byte seams', async () => {
    const value = {
      type: 'text',
      ignored: 'before',
      text: '雪😀\n\t"\\\u0000\ufeff',
      parameters: { nested: ['x', { a: 3 }] },
      after: 'after',
    };
    const text = JSON.stringify(value).replace('😀', '\\ud83d\\ude00');
    for (const size of [1, 2, 7, 64]) {
      expect(await projected(text, 'text', size)).toBe(value.text);
      expect(await projected(text, 'parameters', size, true)).toBe(
        JSON.stringify(value.parameters),
      );
      expect(await projected(text, 'missing', size)).toBe('');
    }
  });
});
