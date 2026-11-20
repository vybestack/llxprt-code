/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { jsonValueBytes } from './progressive-json-body.js';
import { BoundedJsonBody } from './boundedJsonBody.js';

const ITEMS = 2000;

function item(index: number): Record<string, unknown> {
  return {
    role: 'user',
    content: [{ type: 'input_text', text: `row-${index}:${'x'.repeat(400)}` }],
  };
}

describe('bounded JSON chunk backing memory', () => {
  it('does not pin a full-size buffer behind each small value a consumer retains', async () => {
    const retained: Uint8Array[] = [];
    for (let index = 0; index < ITEMS; index += 1)
      for await (const chunk of jsonValueBytes(item(index)))
        retained.push(chunk);
    const viewBytes = retained.reduce((sum, c) => sum + c.byteLength, 0);
    const backingBytes = retained.reduce(
      (sum, c) => sum + c.buffer.byteLength,
      0,
    );
    // Before the fix every value pinned a 64 KiB buffer (about 140x its bytes).
    expect(backingBytes).toBeLessThan(viewBytes * 3);
  });

  it('keeps bytes and chunk boundaries identical to JSON.stringify for large values', async () => {
    const value = { text: 'é😀"\n'.repeat(70_000), small: [1, 2, 3] };
    const expected = new TextEncoder().encode(JSON.stringify(value));
    const chunks: Uint8Array[] = [];
    const body = new BoundedJsonBody(value, {
      maxChunkBytes: 65_536,
      maxEnvelopeBytes: expected.byteLength,
    });
    const reader = body.createStream().getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read())
      chunks.push(next.value);
    const actual = Buffer.concat(chunks);
    expect(Buffer.compare(actual, Buffer.from(expected))).toBe(0);
    for (const chunk of chunks.slice(0, -1))
      expect(chunk.byteLength).toBeGreaterThan(65_536 - 4);
    for (const chunk of chunks)
      expect(chunk.byteLength).toBeLessThanOrEqual(65_536);
  });
});
