/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import { ROW_FLAG } from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { orphanAdjacent } from './journal-orphan-slots.js';

export function strippedSelf(row: IContent): IContent | undefined {
  if (!row.blocks.some((block) => block.type === 'tool_response')) return row;
  const blocks = row.blocks.filter(
    (block) => block.type !== 'tool_response' && block.type !== 'media',
  );
  return row.speaker === 'tool' || blocks.length === 0
    ? undefined
    : { ...row, blocks };
}

export async function* streamJournalOrphanUnits(
  snapshot: VersionSnapshot,
): AsyncGenerator<IContent> {
  for await (const entry of snapshot.entries()) {
    if ((entry.flags & ROW_FLAG.curated) === 0) continue;
    if ((entry.flags & ROW_FLAG.hasToolResponse) !== 0) {
      throw new JournalFormatError('Real response units are not implemented');
    }
    const row = decodeStoredRow(await snapshot.readRow(entry));
    const parts = HistoryToolNormalization.splitToolCallsOutOfToolMessages([
      row,
    ]);
    for (let part = 0; part < parts.length; part++) {
      const content = sanitizeProviderContentForSerialization(parts[part]);
      const self = strippedSelf(content);
      if (self !== undefined) yield self;
      const adjacent = await orphanAdjacent(
        content,
        entry.label,
        part,
        snapshot,
        snapshot.facts,
      );
      if (adjacent !== undefined)
        yield sanitizeProviderContentForSerialization(adjacent);
    }
  }
}
