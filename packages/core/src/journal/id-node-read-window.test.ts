/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { encodeBodylessFrame } from './frame.js';
import { encodeIdTrieNode } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { createRecordAccess } from './recordAccess.js';
import { ROW_READ_WINDOW_BYTES } from './row-read-window.js';
import { ID_TRIE_PREFETCH_BYTES, decodeIdTrieNode } from './idTrieNode.js';
import { mergeIdTrie } from './idTrieMerge.js';
import { PinLease, PinnedRead } from './pinLease.js';

function nodeFrame(value: number): Uint8Array {
  const record = encodeIdTrieNode({
    kind: 'leaf',
    entries: [{ hash: new Uint8Array(16), value: Uint8Array.of(value) }],
  });
  return encodeBodylessFrame(record.kind, record.kindHeader);
}

describe('bounded id node readback', () => {
  it.each([false, true])(
    'does not read neighboring payloads from published id metadata with readAhead=%s',
    async (readAhead) => {
      const frame = nodeFrame(7);
      const bytes = new Uint8Array(64 * 1024);
      bytes.set(frame);
      let furthestRead = 0;
      const access = createRecordAccess(
        '(published id metadata)',
        {
          readAt: async (offset, length) => {
            furthestRead = Math.max(furthestRead, offset + length);
            return bytes.slice(offset, offset + length);
          },
        },
        { selfOffset: 0, durableEnd: bytes.length },
        true,
        true,
      );
      const trie = new IdTrieReader(access, new BoundedIdNodeCache(0));
      expect(await trie.readNode(0, 0, readAhead)).toStrictEqual({
        kind: 'leaf',
        entries: [{ hash: new Uint8Array(16), value: Uint8Array.of(7) }],
      });
      expect(furthestRead).toBeLessThanOrEqual(frame.length);
    },
  );

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

  it.each([false, true])(
    'bounds sparse lookup and path-copy reads with pinned=%s',
    async (pinned) => {
      const count = 128;
      const stride = 2 * ROW_READ_WINDOW_BYTES;
      const bytes = new Uint8Array((count + 1) * stride);
      for (let index = 0; index < count; index++)
        bytes.set(nodeFrame(index), (index + 1) * stride);
      let readBytes = 0;
      const access = createRecordAccess(
        '(sparse id nodes)',
        {
          readAt: async (offset, length) => {
            readBytes += length;
            return bytes.slice(offset, offset + length);
          },
        },
        { selfOffset: 0, durableEnd: bytes.length },
      );
      const lease = new PinLease(() => {});
      const held = new PinnedRead(undefined, access, lease);
      const trie = new IdTrieReader(
        pinned ? held.access : access,
        new BoundedIdNodeCache(0),
      );
      for (let index = 0; index < count; index++) {
        const offset = (index + 1) * stride;
        const hash = new Uint8Array(16);
        expect(await trie.lookup(offset, hash)).toStrictEqual(
          Uint8Array.of(index),
        );
        const value = Uint8Array.of(index + 1);
        let nextOffset = bytes.length;
        const rewritten = await mergeIdTrie(
          {
            get nextOffset() {
              return nextOffset;
            },
            append: async (record) => {
              const start = nextOffset;
              nextOffset += encodeBodylessFrame(
                record.kind,
                record.kindHeader,
              ).length;
              expect(decodeIdTrieNode(record.kindHeader)).toStrictEqual({
                kind: 'leaf',
                entries: [{ hash, value }],
              });
              return start;
            },
            drain: async () => {},
          },
          trie,
          offset,
          [{ hash, value }],
        );
        expect(rewritten).toBe(bytes.length);
      }
      await held.close();
      expect(readBytes).toBeLessThanOrEqual(2 * count * ID_TRIE_PREFETCH_BYTES);
    },
  );
});
