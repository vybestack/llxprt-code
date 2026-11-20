/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_BLOCK_TYPE, ROW_FLAG } from '../../journal/rowRecord.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { ContentBlock, IContent } from './IContent.js';
import type { JournalTailSource } from './journal-tail-source.js';
import { decodeStoredBlock, decodeStoredRow } from './journalRowCodec.js';

export interface JournalRequestMediaRow {
  readonly label: bigint;
  readonly header: IContent;
  readonly media: ReadonlyArray<{
    readonly index: number;
    readonly block: ContentBlock;
  }>;
}

async function* mediaEntries(
  snapshot: VersionSnapshot,
  source: JournalTailSource,
): AsyncGenerator<RowEntry> {
  yield* snapshot.mediaEntries();
  yield* source.tailEntries();
}

/** Reads media directories and metadata, never unrelated history text. */
export async function* journalRequestMediaRows(
  snapshot: VersionSnapshot,
  source: JournalTailSource,
  requireOpen: () => void,
  signal?: AbortSignal,
): AsyncGenerator<JournalRequestMediaRow> {
  for await (const original of mediaEntries(snapshot, source)) {
    requireOpen();
    signal?.throwIfAborted();
    const entry = await source.entryByLabel(original.label);
    if (entry === undefined || (entry.flags & ROW_FLAG.curated) === 0) continue;
    const ids = await source.readIds(entry);
    const media: Array<{ index: number; block: ContentBlock }> = [];
    for (const [index, descriptor] of ids.header.blocks.entries()) {
      if (descriptor.type !== ROW_BLOCK_TYPE.media) continue;
      signal?.throwIfAborted();
      media.push({
        index,
        block: decodeStoredBlock(
          await source.readBlock(entry, index, ids),
          descriptor.type,
        ),
      });
    }
    if (media.length > 0) {
      const header = source.header(
        decodeStoredRow(await source.readMetadata(entry, ids)),
        entry,
      );
      yield { label: entry.label, header, media };
    }
  }
}
