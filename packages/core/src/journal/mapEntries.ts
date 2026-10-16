/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { FrameHead } from './frame.js';
import type { IdNodeCache } from './idTrieCache.js';
import type { IdEntry } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { decodeMapRef } from './keyedMap.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';

/** A `VALUE` frame head plus a key and a small value arrive in one read. */
const VALUE_PREFETCH_BYTES = 1024;
const UTF8_DECODER = new TextDecoder();

/** One entry of a meta map or state map: the key hash, the key and where its `VALUE` record is. */
export interface MapEntry {
  readonly hash: Uint8Array;
  readonly key: string;
  readonly valueOffset: number;
  /** The `VALUE` record's frame head; its kind header is the key. */
  readonly head: FrameHead;
}

/** The entry of a map for one trie leaf fact: reads its `VALUE` record's head for the key. */
export async function readMapEntry(
  access: RecordAccess,
  entry: IdEntry,
): Promise<MapEntry> {
  const valueOffset = decodeMapRef(entry.value);
  const head = await access.readRecordHead(
    valueOffset,
    'VALUE',
    VALUE_PREFETCH_BYTES,
  );
  if (head.kind !== RECORD_KIND.VALUE) {
    throw new JournalFormatError(
      `Record at offset ${valueOffset} is not a value (kind ${head.kind})`,
    );
  }
  return {
    hash: entry.hash,
    key: UTF8_DECODER.decode(head.kindHeader),
    valueOffset,
    head,
  };
}

/**
 * Every entry of the map at `root` in ascending hash order, reading each
 * `VALUE` record's head for its key. The walk holds one path of trie nodes and
 * one entry, so it costs the same however many entries the map has.
 */
export async function* readMapEntries(
  access: RecordAccess,
  cache: IdNodeCache,
  root: number,
): AsyncGenerator<MapEntry> {
  const trie = new IdTrieReader(access, cache);
  for await (const entry of trie.entries(root)) {
    yield await readMapEntry(access, entry);
  }
}

/** The body of a `VALUE` record, whole: a map value is a small record. */
export async function readValueBody(
  access: RecordAccess,
  head: FrameHead,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of access.readRecordBody(head, undefined, 'VALUE')) {
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
