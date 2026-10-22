/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BlockPosition, IdFact } from '../../journal/idFactCodec.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import type { IContent } from './IContent.js';

export interface JournalResponseSource {
  readonly header?: (row: IContent, entry: RowEntry) => IContent;
  readonly facts: { fact(rawId: string): Promise<IdFact | undefined> };
  entries(): AsyncGenerator<RowEntry>;
  entryByLabel(label: bigint): Promise<RowEntry | undefined>;
  readIds(entry: RowEntry): Promise<RowIds>;
  readRow(entry: RowEntry): Promise<StoredRow>;
  readBlock(entry: RowEntry, index: number): Promise<Uint8Array>;
  readMetadata(entry: RowEntry): Promise<StoredRow>;
  readonly isTail?: (label: bigint) => boolean;
  readonly sameBlock?: (left: BlockPosition, right: BlockPosition) => boolean;
}
