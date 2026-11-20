/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function* nativeFileRows(
  path: string,
): AsyncGenerator<IContent, void, unknown> {
  const reader = await openJournalReadOnly(path);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) return;
    for await (const entry of iterateRowEntries(reader, root)) {
      yield decodeStoredRow(await readStoredRow(reader, entry));
    }
  } finally {
    await reader.close();
  }
}
