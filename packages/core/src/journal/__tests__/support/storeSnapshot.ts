/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from '../../aggregate.js';
import type { JournalStore } from '../../journalStore.js';
import type { RowEntry } from '../../rowEntry.js';
import type { VersionRoots } from '../../version.js';
import { factSnapshot, metaSnapshot } from './storeFixtures.js';

/** An entry with its summaries as hex, which compares much faster than byte arrays. */
export type SnapshotEntry = Omit<RowEntry, 'summary'> & {
  readonly summary: readonly string[];
};

/** A stored row as a reader sees it: the entry, the raw ids and the text block. */
export interface SnapshotRow {
  readonly entry: SnapshotEntry;
  readonly rawIds: readonly string[];
  readonly text: string;
}

/**
 * Everything a reader can tell about the published version of a store: the
 * version fields, the rows with their owners and content, and the facts of the
 * ids it is asked about. Two stores that are the same version compare equal.
 */
export interface StoreSnapshot {
  readonly commitSeq: number;
  readonly groupTag: bigint;
  readonly lineage: bigint;
  readonly lineageDepth: number;
  readonly parent: number;
  readonly nextLabel: bigint;
  readonly roots: VersionRoots;
  readonly aggregate: Aggregate;
  readonly rows: readonly SnapshotRow[];
  readonly facts: readonly string[];
  readonly meta: readonly string[];
}

export async function snapshotStore(
  store: JournalStore,
  ids: readonly string[],
): Promise<StoreSnapshot> {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  const rows: SnapshotRow[] = [];
  const decoder = new TextDecoder();
  for await (const entry of store.rows()) {
    const stored = await store.readRow(entry);
    rows.push({
      entry: {
        ...entry,
        summary: entry.summary.map((bytes) =>
          Buffer.from(bytes).toString('hex'),
        ),
      },
      rawIds: stored.rawIds,
      text: decoder.decode(stored.blocks[0]),
    });
  }
  return {
    commitSeq: version.commitSeq,
    groupTag: version.groupTag,
    lineage: version.lineage,
    lineageDepth: version.lineageDepth,
    parent: version.parent,
    nextLabel: version.nextLabel,
    roots: version.roots,
    aggregate: version.aggregate,
    rows,
    facts: await factSnapshot(store, ids),
    meta: await metaSnapshot(store),
  };
}
