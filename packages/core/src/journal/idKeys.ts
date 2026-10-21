/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { putU32, putU64, viewOf } from './bytes.js';
import { ID_HASH_BYTES } from './idTrieNode.js';

/** The namespaces of the id trie, numbered as design 3.3 numbers them. */
export const ID_NS = {
  /** The exact id: `IdFact`. */
  fact: 0,
  /** OpenAI-normalized call and response occurrences. */
  openai: 1,
  /** Anthropic-normalized use and result occurrences. */
  anthropic: 2,
  /** A format slot and a mapped id (Mistral): the used-set of the id mapper. */
  mistralUsed: 3,
  /** The exact id, the kind and an ordinal: the `k`-th occurrence. */
  occurrence: 4,
  /** An ordinal: the `k`-th Kimi exception id. */
  kimiException: 5,
  /** An old record offset: where compaction put the record. */
  relocation: 6,
  mistralScopeMapping: 7,
  mistralScopeUsed: 8,
  nativeScalar: 9,
  chronology: 10,
} as const;

export type IdNamespace = (typeof ID_NS)[keyof typeof ID_NS];

/** Which kind of block of an id an occurrence list holds: calls or responses (Anthropic: uses or results). */
export const OCCURRENCE_KIND = { call: 0, response: 1 } as const;
export type OccurrenceKind =
  (typeof OCCURRENCE_KIND)[keyof typeof OCCURRENCE_KIND];

/** The two provider families whose normalized ids have occurrence lists. */
export type NormalizedFamily = typeof ID_NS.openai | typeof ID_NS.anthropic;

/** Turns a namespace and the bytes of a key into the 128-bit lookup hash. A test may inject another. */
export type IdKeyHasher = (
  namespace: number,
  keyBytes: Uint8Array,
) => Uint8Array;

/**
 * The first 128 bits of `SHA-256(namespace byte, key bytes)`. It is unkeyed
 * on purpose (design 3.3): a keyed hash would give every file different
 * hashes and break the byte-for-byte copy of rows in a clone.
 */
export const sha256KeyHash: IdKeyHasher = (namespace, keyBytes) => {
  const hash = createHash('sha256');
  hash.update(Uint8Array.of(namespace));
  hash.update(keyBytes);
  return Uint8Array.from(hash.digest().subarray(0, ID_HASH_BYTES));
};

const UTF8 = new TextEncoder();
const KIND_BYTES = 1;
const ORDINAL_BYTES = 4;

/** `kind`, `k` and the id's UTF-8: the id is last because it is the only variable part. */
function ordinalKey(kind: number, ordinal: number, id: string): Uint8Array {
  const text = UTF8.encode(id);
  const bytes = new Uint8Array(KIND_BYTES + ORDINAL_BYTES + text.length);
  bytes[0] = kind;
  putU32(viewOf(bytes), KIND_BYTES, 'ordinal', ordinal);
  bytes.set(text, KIND_BYTES + ORDINAL_BYTES);
  return bytes;
}

/** Namespace 0: the exact id. */
export function fact0Key(rawId: string): Uint8Array {
  return UTF8.encode(rawId);
}

/**
 * Namespaces 1 and 2: a normalized id, the kind and an ordinal. Ordinal 0 is
 * the count entry; `1..count` are the positions in unit order.
 */
export function normalizedKey(
  kind: OccurrenceKind,
  ordinal: number,
  normalizedId: string,
): Uint8Array {
  return ordinalKey(kind, ordinal, normalizedId);
}

/** Namespace 4: the exact id, the kind and the occurrence ordinal `k >= 1`. */
export function occurrenceKey(
  kind: OccurrenceKind,
  ordinal: number,
  rawId: string,
): Uint8Array {
  return ordinalKey(kind, ordinal, rawId);
}

/** Namespace 3: a format slot byte and the mapped id. */
export function mistralUsedKey(slot: number, mappedId: string): Uint8Array {
  const text = UTF8.encode(mappedId);
  const bytes = new Uint8Array(KIND_BYTES + text.length);
  bytes[0] = slot;
  bytes.set(text, KIND_BYTES);
  return bytes;
}

/** Namespace 5: the position `k` in the Kimi exception list. */
export function kimiExceptionKey(ordinal: number): Uint8Array {
  const bytes = new Uint8Array(ORDINAL_BYTES);
  putU32(viewOf(bytes), 0, 'ordinal', ordinal);
  return bytes;
}

/** Namespace 6: the offset of a record in the file being replaced. */
export function relocationKey(oldOffset: number): Uint8Array {
  const bytes = new Uint8Array(8);
  putU64(viewOf(bytes), 0, 'offset', oldOffset);
  return bytes;
}
