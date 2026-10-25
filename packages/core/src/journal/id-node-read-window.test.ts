/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { encodeBodylessFrame } from './frame.js';
import { encodeIdTrieNode } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { createRecordAccess } from './recordAccess.js';
import { ROW_READ_WINDOW_BYTES } from './row-read-window.js';

function nodeFrame(value: number): Uint8Array {
  const record = encodeIdTrieNode({
    kind: 'leaf',
    entries: [{ hash: new Uint8Array(16), value: Uint8Array.of(value) }],
  });
  return encodeBodylessFrame(record.kind, record.kindHeader);
}

describe('bounded id node readback', () => {
  it('reads adjacent spilled nodes through one bounded range and preserves every value', async () => {
    const frames = Array.from({ length: 128 }, (_, index) => nodeFrame(index));
    const bytes = Buffer.concat(frames);
    let reads = 0;
    let readBytes = 0;
    const access = createRecordAccess(
      '(id node readback)',
      {
        readAt: async (offset, length) => {
          reads++;
          readBytes += length;
          return bytes.slice(offset, offset + length);
        },
      },
      { selfOffset: 0, durableEnd: bytes.length },
    );
    const trie = new IdTrieReader(access, new BoundedIdNodeCache(0));
    let offset = 0;
    for (let index = 0; index < frames.length; index++) {
      const node = await trie.readNode(offset);
      expect(node).toStrictEqual({
        kind: 'leaf',
        entries: [{ hash: new Uint8Array(16), value: Uint8Array.of(index) }],
      });
      offset += frames[index].length;
    }
    expect(reads).toBe(1);
    expect(readBytes).toBeLessThanOrEqual(ROW_READ_WINDOW_BYTES);
  });
});
