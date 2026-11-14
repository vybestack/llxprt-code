/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readSync } from 'node:fs';
import { decodeFrameStart, FRAME_HEAD_BYTES } from './frame.js';
import { JournalFormatError } from './errors.js';
import { JournalShortReadError } from './positionalFile.js';
import type { IdNodeCache } from './idTrieCache.js';
import {
  compareIdHashes,
  decodeIdTrieNode,
  ID_TRIE_MAX_FRAME_BYTES,
  nibbleAt,
  popcount16,
  type IdTrieNode,
} from './idTrieNode.js';
import { RECORD_KIND } from './recordKinds.js';

function bytesAt(fd: number, offset: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const count = readSync(fd, bytes, read, length - read, offset + read);
    if (count === 0) throw new JournalShortReadError(offset, length, read);
    read += count;
  }
  return bytes;
}

function nodeAt(
  fd: number,
  offset: number,
  end: number,
  cache: IdNodeCache,
): IdTrieNode {
  const cached = cache.get(offset);
  if (cached !== undefined) return decodeIdTrieNode(cached);
  if (offset < 0 || offset + FRAME_HEAD_BYTES > end)
    throw new JournalFormatError(
      'Context span node is outside the published version',
    );
  const head = bytesAt(fd, offset, FRAME_HEAD_BYTES);
  const view = new DataView(head.buffer);
  const length = FRAME_HEAD_BYTES + view.getUint32(4, true) + 4;
  if (
    view.getBigUint64(8, true) !== 0n ||
    length > ID_TRIE_MAX_FRAME_BYTES ||
    offset + length > end
  )
    throw new JournalFormatError('Invalid context span trie node');
  const bytes = bytesAt(fd, offset, length);
  const frame = decodeFrameStart(bytes, offset);
  if (
    frame.kind !== RECORD_KIND.ITNODE ||
    new DataView(bytes.buffer).getUint32(length - 4, true) !== 0
  )
    throw new JournalFormatError('Invalid context span trie frame');
  const node = decodeIdTrieNode(frame.kindHeader);
  cache.put(offset, frame.kindHeader);
  return node;
}

export function synchronousIdValue(
  fd: number,
  root: number,
  end: number,
  hash: Uint8Array,
  cache: IdNodeCache,
): Uint8Array | undefined {
  let offset = root;
  for (let depth = 0; offset !== 0; depth++) {
    const node = nodeAt(fd, offset, end, cache);
    if (node.kind === 'leaf')
      return node.entries
        .find((entry) => compareIdHashes(entry.hash, hash) === 0)
        ?.value.slice();
    if (depth >= hash.length * 2)
      throw new JournalFormatError('Context span trie exceeds hash depth');
    const bit = 1 << nibbleAt(hash, depth);
    if ((node.bitmap & bit) === 0) return undefined;
    offset = node.children[popcount16(node.bitmap & (bit - 1))];
  }
  return undefined;
}
