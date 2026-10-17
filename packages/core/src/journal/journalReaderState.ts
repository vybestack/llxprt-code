/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdKeyHasher } from './idKeys.js';
import type { JournalReader } from './journalReader.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { KeyedMapReader } from './keyedMap.js';

/** Reads one entry of the state map of the version a reader was opened on. */
export type StateReader = (key: string) => Promise<Uint8Array | undefined>;

/**
 * The state map of the committed version of a read-only journal view. A
 * journal with no committed group has an empty state map. Nothing is written,
 * and each lookup reads only the trie nodes on the way to the key.
 */
export function stateReaderOf(
  reader: JournalReader,
  hasher: IdKeyHasher,
): StateReader {
  const { trailer } = reader;
  if (trailer === undefined) return () => Promise.resolve(undefined);
  const map = new KeyedMapReader(
    reader,
    new BoundedIdNodeCache(),
    'state',
    hasher,
  );
  return (key) => map.get(trailer.stateRoot, key);
}
