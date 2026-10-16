/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { assertAllZero, putU8, putU16, span, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import { BODY_CRC_BYTES, FRAME_HEAD_BYTES } from './frame.js';
import type { GroupRecord } from './groupAppender.js';
import { RECORD_KIND } from './recordKinds.js';

/** The lookup key is the first 128 bits of a SHA-256 (design 3.3). */
export const ID_HASH_BYTES = 16;
/** Each level of the trie consumes 4 bits of the hash. */
export const ID_TRIE_FANOUT = 16;
/** A leaf holds up to 8 facts; a ninth makes it an internal node. */
export const ID_TRIE_LEAF_CAPACITY = 8;
/** 128 bits at 4 bits a level. */
export const ID_TRIE_MAX_DEPTH = ID_HASH_BYTES * 2;
/** The largest fact value (an `IdFact` is about 100 bytes), so one read gets any node. */
export const ID_VALUE_MAX_BYTES = 1024;

const NODE_HEADER_BYTES = 4;
const CHILD_OFFSET_BYTES = 8;
const LEAF_ENTRY_FIXED_BYTES = ID_HASH_BYTES + 2;

const NODE_HEADER_LAYOUT = {
  type: span(0, 1),
  count: span(1, 1),
  bitmap: span(2, 2),
};

const NODE_TYPE = { internal: 0, leaf: 1 } as const;

/** The largest kind header of an `ITNODE`: a leaf of eight facts of the largest value. */
export const ID_TRIE_MAX_KIND_HEADER_BYTES =
  NODE_HEADER_BYTES +
  ID_TRIE_LEAF_CAPACITY * (LEAF_ENTRY_FIXED_BYTES + ID_VALUE_MAX_BYTES);
/** The largest frame of an `ITNODE`. */
export const ID_TRIE_MAX_FRAME_BYTES =
  FRAME_HEAD_BYTES + ID_TRIE_MAX_KIND_HEADER_BYTES + BODY_CRC_BYTES;
/**
 * How much of a node to read with its head. A full internal node is 156 bytes
 * of frame and a leaf of eight 99-byte facts is 961, so one read gets nearly
 * every node; a larger leaf costs a second read.
 */
export const ID_TRIE_PREFETCH_BYTES = 1024;

/** A key (the 128-bit hash) and the opaque fact stored under it. */
export interface IdEntry {
  readonly hash: Uint8Array;
  readonly value: Uint8Array;
}

export interface InternalIdNode {
  readonly kind: 'internal';
  /** Bit `n` is set when the child for nibble `n` exists. */
  readonly bitmap: number;
  /** Child offsets in ascending nibble order, `popcount(bitmap)` of them. */
  readonly children: readonly number[];
}

export interface LeafIdNode {
  readonly kind: 'leaf';
  /** One to eight facts, ascending by hash. */
  readonly entries: readonly IdEntry[];
}

export type IdTrieNode = InternalIdNode | LeafIdNode;

function fail(message: string): never {
  throw new JournalFormatError(message);
}

export function popcount16(bits: number): number {
  let count = 0;
  for (let rest = bits & 0xffff; rest !== 0; rest &= rest - 1) count += 1;
  return count;
}

/** Nibble `depth` of the hash: depth 0 is the high half of byte 0. */
export function nibbleAt(hash: Uint8Array, depth: number): number {
  const byte = hash[depth >> 1];
  return depth % 2 === 0 ? byte >> 4 : byte & 0x0f;
}

export function compareIdHashes(left: Uint8Array, right: Uint8Array): number {
  for (let at = 0; at < ID_HASH_BYTES; at++) {
    if (left[at] !== right[at]) return left[at] - right[at];
  }
  return 0;
}

function assertEntry(entry: IdEntry): void {
  if (entry.hash.length !== ID_HASH_BYTES) {
    fail(`An id hash is ${ID_HASH_BYTES} bytes, got ${entry.hash.length}`);
  }
  if (entry.value.length > ID_VALUE_MAX_BYTES) {
    fail(
      `An id fact value holds at most ${ID_VALUE_MAX_BYTES} bytes, got ${entry.value.length}`,
    );
  }
}

function assertAscending(entries: readonly IdEntry[]): void {
  for (let at = 1; at < entries.length; at++) {
    if (compareIdHashes(entries[at - 1].hash, entries[at].hash) >= 0) {
      fail('Leaf hashes must be unique and ascend');
    }
  }
}

function encodeLeaf(entries: readonly IdEntry[]): Uint8Array {
  if (entries.length < 1 || entries.length > ID_TRIE_LEAF_CAPACITY) {
    fail(
      `A leaf holds 1 to ${ID_TRIE_LEAF_CAPACITY} facts, not ${entries.length}`,
    );
  }
  entries.forEach(assertEntry);
  assertAscending(entries);
  const size = entries.reduce(
    (total, entry) => total + LEAF_ENTRY_FIXED_BYTES + entry.value.length,
    NODE_HEADER_BYTES,
  );
  const bytes = new Uint8Array(size);
  const view = viewOf(bytes);
  putU8(view, NODE_HEADER_LAYOUT.type.offset, 'type', NODE_TYPE.leaf);
  putU8(view, NODE_HEADER_LAYOUT.count.offset, 'count', entries.length);
  let at = NODE_HEADER_BYTES;
  for (const entry of entries) {
    bytes.set(entry.hash, at);
    putU16(view, at + ID_HASH_BYTES, 'valueLen', entry.value.length);
    bytes.set(entry.value, at + LEAF_ENTRY_FIXED_BYTES);
    at += LEAF_ENTRY_FIXED_BYTES + entry.value.length;
  }
  return bytes;
}

function encodeInternal(
  bitmap: number,
  children: readonly number[],
): Uint8Array {
  const count = popcount16(bitmap);
  if (count < 1 || count !== children.length) {
    fail(
      `Bitmap ${bitmap.toString(2)} names ${count} children, the node has ${children.length}`,
    );
  }
  const bytes = new Uint8Array(NODE_HEADER_BYTES + count * CHILD_OFFSET_BYTES);
  const view = viewOf(bytes);
  putU8(view, NODE_HEADER_LAYOUT.type.offset, 'type', NODE_TYPE.internal);
  putU8(view, NODE_HEADER_LAYOUT.count.offset, 'count', count);
  putU16(view, NODE_HEADER_LAYOUT.bitmap.offset, 'bitmap', bitmap);
  children.forEach((offset, index) => {
    if (offset === 0) fail('An internal node has no child offset of 0');
    view.setBigUint64(
      NODE_HEADER_BYTES + index * CHILD_OFFSET_BYTES,
      BigInt(offset),
      true,
    );
  });
  return bytes;
}

/**
 * An `ITNODE` record. The whole node is the kind header and the record has no
 * body, so the frame CRC covers it and one read verifies it.
 */
export function encodeIdTrieNode(node: IdTrieNode): GroupRecord {
  const kindHeader =
    node.kind === 'leaf'
      ? encodeLeaf(node.entries)
      : encodeInternal(node.bitmap, node.children);
  return { kind: RECORD_KIND.ITNODE, kindHeader };
}

function decodeLeaf(bytes: Uint8Array, count: number): LeafIdNode {
  const view = viewOf(bytes);
  const entries: IdEntry[] = [];
  let at = NODE_HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    if (at + LEAF_ENTRY_FIXED_BYTES > bytes.length) {
      fail('Leaf ends inside a fact');
    }
    const valueLen = view.getUint16(at + ID_HASH_BYTES, true);
    const end = at + LEAF_ENTRY_FIXED_BYTES + valueLen;
    if (valueLen > ID_VALUE_MAX_BYTES || end > bytes.length) {
      fail(`Leaf fact ${index} claims ${valueLen} value bytes`);
    }
    entries.push({
      hash: bytes.subarray(at, at + ID_HASH_BYTES),
      value: bytes.subarray(at + LEAF_ENTRY_FIXED_BYTES, end),
    });
    at = end;
  }
  if (at !== bytes.length) {
    fail(`Leaf has ${bytes.length - at} bytes after its last fact`);
  }
  assertAscending(entries);
  return { kind: 'leaf', entries };
}

function decodeInternal(
  bytes: Uint8Array,
  count: number,
  bitmap: number,
): InternalIdNode {
  if (popcount16(bitmap) !== count || count < 1) {
    fail(`Bitmap ${bitmap.toString(2)} does not name ${count} children`);
  }
  if (bytes.length !== NODE_HEADER_BYTES + count * CHILD_OFFSET_BYTES) {
    fail(`Internal node of ${count} children is ${bytes.length} bytes`);
  }
  const view = viewOf(bytes);
  const children: number[] = [];
  for (let index = 0; index < count; index++) {
    const offset = view.getBigUint64(
      NODE_HEADER_BYTES + index * CHILD_OFFSET_BYTES,
      true,
    );
    if (offset === 0n || offset > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(`Internal node child ${index} has offset ${offset}`);
    }
    children.push(Number(offset));
  }
  return { kind: 'internal', bitmap, children };
}

/**
 * Decodes the kind header of an `ITNODE` whose frame has been verified. A leaf's
 * hashes and values are views into `kindHeader`; copy them to keep them.
 */
export function decodeIdTrieNode(kindHeader: Uint8Array): IdTrieNode {
  if (kindHeader.length < NODE_HEADER_BYTES) {
    fail(`ITNODE of ${kindHeader.length} bytes has no header`);
  }
  const view = viewOf(kindHeader);
  const type = view.getUint8(NODE_HEADER_LAYOUT.type.offset);
  const count = view.getUint8(NODE_HEADER_LAYOUT.count.offset);
  const bitmap = view.getUint16(NODE_HEADER_LAYOUT.bitmap.offset, true);
  if (type === NODE_TYPE.leaf) {
    assertAllZero(
      kindHeader,
      NODE_HEADER_LAYOUT.bitmap.offset,
      NODE_HEADER_BYTES,
      'Leaf bitmap',
    );
    if (count < 1 || count > ID_TRIE_LEAF_CAPACITY) {
      fail(`A leaf holds 1 to ${ID_TRIE_LEAF_CAPACITY} facts, not ${count}`);
    }
    return decodeLeaf(kindHeader, count);
  }
  if (type === NODE_TYPE.internal)
    return decodeInternal(kindHeader, count, bitmap);
  return fail(`Unknown ITNODE type ${type}`);
}
