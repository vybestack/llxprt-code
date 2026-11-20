/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeBodylessFrame } from './frame.js';
import { VectoredRecordAppender } from './groupAppender.js';
import { GroupCopier } from './groupCopier.js';
import { sha256KeyHash } from './idKeys.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { encodeIdTrieNode, ID_TRIE_PREFETCH_BYTES } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { createFileHandleReader } from './positionalFile.js';
import { createRecordAccess } from './recordAccess.js';
import { emptyCopyStats } from './recordTransfer.js';
import { RelocationIndex } from './relocationIndex.js';
import { ROW_READ_WINDOW_BYTES } from './row-read-window.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function sparseTrie(): { bytes: Uint8Array; root: number } {
  const stride = 2 * ROW_READ_WINDOW_BYTES;
  const root = 17 * stride;
  const bytes = new Uint8Array(root + stride);
  const children = Array.from({ length: 16 }, (_, index) => {
    const hash = new Uint8Array(16);
    hash[0] = index << 4;
    const record = encodeIdTrieNode({
      kind: 'leaf',
      entries: [{ hash, value: Uint8Array.of(index) }],
    });
    const offset = (index + 1) * stride;
    bytes.set(encodeBodylessFrame(record.kind, record.kindHeader), offset);
    return offset;
  });
  const record = encodeIdTrieNode({
    kind: 'internal',
    bitmap: 0xffff,
    children,
  });
  bytes.set(encodeBodylessFrame(record.kind, record.kindHeader), root);
  return { bytes, root };
}

describe('compaction ID-node read cost', () => {
  const directory = useTempDir('compaction-id-cost-');
  it('copies sparse trie paths without reading unrelated neighboring records', async () => {
    const { bytes, root } = sparseTrie();
    let reads = 0;
    let readBytes = 0;
    const source = createRecordAccess(
      '(sparse compaction source)',
      {
        readAt: async (offset, length) => {
          reads++;
          readBytes += length;
          return bytes.slice(offset, offset + length);
        },
      },
      { selfOffset: 0, durableEnd: bytes.length },
    );
    const path = join(directory(), 'copy.llxj');
    const handle = await open(path, 'w+');
    const target = createFileHandleReader(handle);
    const appender = new VectoredRecordAppender(handle, 1);
    const copiedReader = (): IdTrieReader =>
      new IdTrieReader(
        createRecordAccess(path, target, {
          selfOffset: 0,
          durableEnd: appender.nextOffset,
        }),
        new BoundedIdNodeCache(),
      );
    try {
      const copier = new GroupCopier(
        {
          copiedAccess: (end) =>
            createRecordAccess(path, target, {
              selfOffset: 0,
              durableEnd: end,
            }),
          source,
          relocation: new RelocationIndex(path, target, sha256KeyHash),
          stats: emptyCopyStats(),
          sourceCache: new BoundedIdNodeCache(),
          readCopiedNode: (offset) => copiedReader().readNode(offset),
        },
        appender,
        false,
      );
      const copiedRoot = await copier.copyIdNode(root, async (value) =>
        Uint8Array.of(value[0] + 1),
      );
      await appender.drain();
      const reader = copiedReader();
      for (let index = 0; index < 16; index++) {
        const hash = new Uint8Array(16);
        hash[0] = index << 4;
        expect(await reader.lookup(copiedRoot, hash)).toStrictEqual(
          Uint8Array.of(index + 1),
        );
      }
      expect(reads).toBe(17);
      expect(readBytes).toBeLessThanOrEqual(17 * ID_TRIE_PREFETCH_BYTES);
    } finally {
      await handle.close();
    }
  });
});
