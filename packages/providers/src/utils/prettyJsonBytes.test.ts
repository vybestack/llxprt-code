/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { prettyJsonBytes } from './prettyJsonBytes.js';

async function* chunked(
  text: string,
  size: number,
): AsyncGenerator<Uint8Array> {
  const bytes = Buffer.from(text, 'utf8');
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

async function pretty(
  value: unknown,
  size: number,
  depth = 0,
): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of prettyJsonBytes(
    chunked(JSON.stringify(value), size),
    depth,
  )) {
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts).toString('utf8');
}

const VALUES: readonly unknown[] = [
  {},
  [],
  [[], {}, [[]], { a: {} }],
  { a: 1, b: [1, 2, { c: null }], d: { e: { f: [] } } },
  'text',
  42,
  { 'we"ird': 'quote " and backslash \\ and \\" pair', n: '{[,:]}' },
  { unicode: 'caf\u00e9 \u{1f600} \u2028 \u0007', list: ['\ud800', 'x'] },
  { key: 'a,b:c{d}[e]', arr: ['}', ']', '[', '{', ',', ':'] },
  {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', tool_calls: [] },
    ],
  },
];

describe('prettyJsonBytes', () => {
  for (const size of [1, 2, 3, 7, 64, 65536]) {
    it(`prints what JSON.stringify(value, null, 2) prints with ${size}-byte chunks`, async () => {
      for (const value of VALUES) {
        expect(await pretty(value, size)).toBe(JSON.stringify(value, null, 2));
      }
    });
  }

  it('indents a nested value from the depth it starts at', async () => {
    const value = { a: [1, { b: 2 }], c: {} };
    const wrapped = JSON.stringify({ request: { body: value } }, null, 2);
    const expectedBody = wrapped
      .slice(wrapped.indexOf('"body": ') + '"body": '.length)
      .replace(/\n {2}\}\n\}$/, '');
    expect(await pretty(value, 5, 2)).toBe(expectedBody);
  });

  it('rejects input that ends inside a value', async () => {
    await expect(
      (async () => {
        for await (const part of prettyJsonBytes(chunked('{"a":[1,', 4))) {
          void part;
        }
      })(),
    ).rejects.toThrow('JSON ended inside a value');
  });

  it('holds no output for a long string', async () => {
    const value = { text: 'x'.repeat(300_000) };
    let largest = 0;
    for await (const part of prettyJsonBytes(
      chunked(JSON.stringify(value), 65536),
    )) {
      largest = Math.max(largest, part.byteLength);
    }
    expect(largest).toBeLessThanOrEqual(65536 + 64);
  });
});
