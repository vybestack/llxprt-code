/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdKeyHasher } from './idKeys.js';
import type { JournalReader } from './journalReader.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { KeyedMapReader } from './keyedMap.js';
import { listCheckpoints, type ListedCheckpoint } from './checkpointList.js';
import { readMapValues } from './mapEntries.js';
import { iterateRowEntries, rowTreeRootOf } from './rowTreeReader.js';
import { readStoredRow } from './rowReads.js';
import { RECORD_KIND } from './recordKinds.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';

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

/** The live checkpoints of the committed version of a read-only journal view. */
export function checkpointsOf(
  reader: JournalReader,
): AsyncGenerator<ListedCheckpoint> {
  const { trailer } = reader;
  return listCheckpoints(
    reader,
    new BoundedIdNodeCache(),
    trailer?.stateRoot ?? 0,
  );
}

/**
 * The state map entries of the committed version whose key starts with
 * `prefix`, in key-hash order. The walk is the one checkpoint listing uses:
 * one trie path and one value at a time, so a map with many entries is never
 * held whole.
 */
export async function* stateEntriesOf(
  reader: JournalReader,
  prefix: string,
): AsyncGenerator<{ readonly key: string; readonly value: Uint8Array }> {
  const stateRoot = reader.trailer?.stateRoot ?? 0;
  if (stateRoot === 0) return;
  yield* readMapValues(reader, new BoundedIdNodeCache(), stateRoot, prefix);
}

/**
 * The versioned metadata map entries of the committed version whose key
 * starts with `prefix`, walked the same way as {@link stateEntriesOf}.
 */
export async function* metaEntriesOf(
  reader: JournalReader,
  prefix: string,
): AsyncGenerator<{ readonly key: string; readonly value: Uint8Array }> {
  const metaRoot = reader.trailer?.metaRoot ?? 0;
  if (metaRoot === 0) return;
  yield* readMapValues(reader, new BoundedIdNodeCache(), metaRoot, prefix);
}

/**
 * The content rows of the committed version in label order, one decoded row
 * at a time. A transcript marker (a `VALUE` record in the row tree) is not
 * content and is passed over.
 */
export async function* contentRowsOf(
  reader: JournalReader,
): AsyncGenerator<IContent> {
  const root = rowTreeRootOf(reader.trailer);
  if (root === undefined) return;
  for await (const entry of iterateRowEntries(reader, root)) {
    const head = await reader.readRecordHead(entry.recordOffset, 'ROW');
    if (head.kind !== RECORD_KIND.ROW) continue;
    yield decodeStoredRow(await readStoredRow(reader, entry, head));
  }
}
