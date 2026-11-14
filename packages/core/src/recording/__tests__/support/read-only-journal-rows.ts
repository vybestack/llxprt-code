/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { openJournalReadOnly } from '../../../journal/journalReader.js';
import type { RowEntry } from '../../../journal/rowEntry.js';
import { readStoredRow } from '../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../journal/rowTreeReader.js';
import type { IContent } from '../../../services/history/IContent.js';
import { decodeStoredRow } from '../../../services/history/journalRowCodec.js';

export async function* readOnlyJournalRows(
  file: string,
): AsyncGenerator<{ readonly entry: RowEntry; readonly content: IContent }> {
  const reader = await openJournalReadOnly(file);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) return;
    for await (const entry of iterateRowEntries(reader, root)) {
      yield {
        entry,
        content: decodeStoredRow(await readStoredRow(reader, entry)),
      };
    }
  } finally {
    await reader.close();
  }
}
