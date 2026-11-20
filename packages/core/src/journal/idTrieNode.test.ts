/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  BODY_CRC_BYTES,
  FRAME_HEAD_BYTES,
  decodeFrameStart,
  encodeBodylessFrame,
} from './frame.js';
import { JournalFormatError } from './errors.js';
import {
  ID_HASH_BYTES,
  ID_TRIE_FANOUT,
  ID_TRIE_LEAF_CAPACITY,
  ID_TRIE_MAX_DEPTH,
  ID_TRIE_MAX_FRAME_BYTES,
  ID_TRIE_PREFETCH_BYTES,
  ID_VALUE_MAX_BYTES,
  compareIdHashes,
  decodeIdTrieNode,
  encodeIdTrieNode,
  nibbleAt,
  type IdEntry,
  type IdTrieNode,
} from './idTrieNode.js';
import { RECORD_KIND } from './recordKinds.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

function entry(random: SeededRandom, valueBytes: number): IdEntry {
  return {
    hash: random.bytes(ID_HASH_BYTES),
    value: random.bytes(valueBytes),
  };
}

function sortedEntries(
  random: SeededRandom,
  count: number,
  valueBytes: number,
): IdEntry[] {
  return Array.from({ length: count }, () => entry(random, valueBytes)).sort(
    (left, right) => compareIdHashes(left.hash, right.hash),
  );
}

function roundTrip(node: IdTrieNode): IdTrieNode {
  return decodeIdTrieNode(encodeIdTrieNode(node).kindHeader);
}

describe('ITNODE codec', () => {
  it('fixes the sizes of the design: 16 children, 8 facts, 128-bit keys, 32 nibbles', () => {
    expect(ID_TRIE_FANOUT).toBe(16);
    expect(ID_TRIE_LEAF_CAPACITY).toBe(8);
    expect(ID_HASH_BYTES).toBe(16);
    expect(ID_TRIE_MAX_DEPTH).toBe(32);
  });

  it('reads the high nibble of byte 0 first', () => {
    const hash = Uint8Array.from({ length: 16 }, (_, at) => at * 17);
    expect(nibbleAt(hash, 0)).toBe(0x0);
    expect(nibbleAt(hash, 1)).toBe(0x0);
    expect(nibbleAt(hash, 2)).toBe(0x1);
    expect(nibbleAt(hash, 3)).toBe(0x1);
    expect(nibbleAt(hash, 30)).toBe(0xf);
    expect(nibbleAt(hash, 31)).toBe(0xf);
    const high = Uint8Array.from({ length: 16 }, () => 0xa5);
    expect(nibbleAt(high, 0)).toBe(0xa);
    expect(nibbleAt(high, 1)).toBe(0x5);
  });

  it('round-trips an internal node with every child count', () => {
    const random = new SeededRandom(11);
    for (let count = 1; count <= ID_TRIE_FANOUT; count++) {
      const nibbles = [...Array(ID_TRIE_FANOUT).keys()]
        .sort(() => random.next() - 0.5)
        .slice(0, count)
        .sort((left, right) => left - right);
      const bitmap = nibbles.reduce((bits, nibble) => bits | (1 << nibble), 0);
      const children = nibbles.map(() => 1 + random.bits(40));
      const node: IdTrieNode = { kind: 'internal', bitmap, children };
      expect(roundTrip(node)).toStrictEqual(node);
    }
  });

  it('round-trips a leaf with every entry count and mixed value sizes', () => {
    const random = new SeededRandom(12);
    for (let count = 1; count <= ID_TRIE_LEAF_CAPACITY; count++) {
      const entries = sortedEntries(random, count, 0).map((item) => ({
        hash: item.hash,
        value: random.bytes(random.int(200)),
      }));
      const decoded = roundTrip({ kind: 'leaf', entries });
      expect(decoded).toStrictEqual({ kind: 'leaf', entries });
    }
  });

  it('keeps the largest values at the stated bound and refuses larger ones', () => {
    const random = new SeededRandom(13);
    const full = sortedEntries(
      random,
      ID_TRIE_LEAF_CAPACITY,
      ID_VALUE_MAX_BYTES,
    );
    const record = encodeIdTrieNode({ kind: 'leaf', entries: full });
    expect(record.kindHeader.length).toBeLessThanOrEqual(
      ID_TRIE_MAX_FRAME_BYTES,
    );
    const oversized = sortedEntries(random, 1, ID_VALUE_MAX_BYTES + 1);
    expect(() =>
      encodeIdTrieNode({ kind: 'leaf', entries: oversized }),
    ).toThrow(JournalFormatError);
  });

  it('is an ITNODE record without a body whose frame verifies', () => {
    const random = new SeededRandom(14);
    const record = encodeIdTrieNode({
      kind: 'leaf',
      entries: sortedEntries(random, 3, 40),
    });
    expect(record.kind).toBe(RECORD_KIND.ITNODE);
    expect(record.body).toBeUndefined();
    const frame = encodeBodylessFrame(record.kind, record.kindHeader);
    const head = decodeFrameStart(frame, 0);
    expect(head.kind).toBe(RECORD_KIND.ITNODE);
    expect(head.bodyLen).toBe(0);
    expect(decodeIdTrieNode(head.kindHeader)).toStrictEqual(
      decodeIdTrieNode(record.kindHeader),
    );
  });

  it('keeps a full internal node at 132 bytes and a leaf of 99-byte facts at 937', () => {
    const internal = encodeIdTrieNode({
      kind: 'internal',
      bitmap: 0xffff,
      children: Array.from({ length: 16 }, (_, at) => 100 + at),
    });
    expect(internal.kindHeader.length).toBe(4 + 16 * 8);
    const random = new SeededRandom(15);
    const leaf = encodeIdTrieNode({
      kind: 'leaf',
      entries: sortedEntries(random, 8, 99),
    });
    expect(leaf.kindHeader.length).toBe(4 + 8 * (16 + 2 + 99));
    expect(ID_TRIE_PREFETCH_BYTES).toBeGreaterThanOrEqual(
      FRAME_HEAD_BYTES + leaf.kindHeader.length + BODY_CRC_BYTES,
    );
  });

  it('refuses a leaf whose hashes do not ascend', () => {
    const random = new SeededRandom(16);
    const [first, second] = sortedEntries(random, 2, 4);
    expect(() =>
      encodeIdTrieNode({ kind: 'leaf', entries: [second, first] }),
    ).toThrow(JournalFormatError);
    expect(() =>
      encodeIdTrieNode({ kind: 'leaf', entries: [first, first] }),
    ).toThrow(JournalFormatError);
  });

  it('refuses nine facts, no facts, a zero child offset and a bitmap that disagrees with the children', () => {
    const random = new SeededRandom(17);
    expect(() =>
      encodeIdTrieNode({
        kind: 'leaf',
        entries: sortedEntries(random, ID_TRIE_LEAF_CAPACITY + 1, 4),
      }),
    ).toThrow(JournalFormatError);
    expect(() => encodeIdTrieNode({ kind: 'leaf', entries: [] })).toThrow(
      JournalFormatError,
    );
    expect(() =>
      encodeIdTrieNode({ kind: 'internal', bitmap: 0b11, children: [5, 0] }),
    ).toThrow(JournalFormatError);
    expect(() =>
      encodeIdTrieNode({ kind: 'internal', bitmap: 0b111, children: [5, 6] }),
    ).toThrow(JournalFormatError);
    expect(() =>
      encodeIdTrieNode({ kind: 'internal', bitmap: 0, children: [] }),
    ).toThrow(JournalFormatError);
  });

  it('refuses damaged bytes on decode', () => {
    const random = new SeededRandom(18);
    const leaf = encodeIdTrieNode({
      kind: 'leaf',
      entries: sortedEntries(random, 4, 20),
    }).kindHeader;
    const internal = encodeIdTrieNode({
      kind: 'internal',
      bitmap: 0b1010,
      children: [64, 128],
    }).kindHeader;
    const withByte = (bytes: Uint8Array, at: number, value: number) => {
      const copy = bytes.slice();
      copy[at] = value;
      return copy;
    };
    expect(() => decodeIdTrieNode(leaf.subarray(0, 3))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(withByte(leaf, 0, 9))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(withByte(leaf, 1, 5))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(leaf.subarray(0, leaf.length - 1))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(withByte(leaf, 2, 1))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(withByte(internal, 1, 3))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdTrieNode(withByte(internal, 4, 0))).toThrow(
      JournalFormatError,
    );
  });
});
