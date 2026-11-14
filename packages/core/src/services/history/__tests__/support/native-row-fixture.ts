/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../../../recording/rowOwnership.js';
import { HistoryReaderScope } from '../../historyReaderScope.js';
import type { IContent } from '../../IContent.js';
import { JournalHistoryStore } from '../../journalHistoryStore.js';
import { decodeStoredRow } from '../../journalRowCodec.js';
import { JournalSession } from '../../journalSession.js';
import {
  assertRowIndex,
  type ProviderRequestSelection,
} from '../../provider-request-snapshot.js';

export async function openNativeRowFixture(
  root: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  count: number,
  ownership?: RowOwnership,
): Promise<ProviderRequestSelection> {
  const session = await JournalSession.createUnlinked({
    unlinkedDirectory: root,
  });
  const store = new JournalHistoryStore(session);
  try {
    await store.replaceFrom(contents, count);
    const snapshot = await session.store.snapshot();
    const scope = new HistoryReaderScope('Provider request snapshot is closed');
    const readAt = (index: number, signal?: AbortSignal): Promise<IContent> =>
      scope.read(async () => {
        signal?.throwIfAborted();
        assertRowIndex(index, snapshot.rows);
        return decodeStoredRow(
          await snapshot.readRow(await snapshot.entryAt(index)),
        );
      });
    async function* rows(
      signal?: AbortSignal,
    ): AsyncGenerator<IContent, void, unknown> {
      for (let index = 0; index < snapshot.rows; index++) {
        const row = await readAt(index, signal);
        ownership?.retain(row);
        try {
          yield row;
        } finally {
          ownership?.release(row);
        }
      }
    }
    let closing: Promise<void> | undefined;
    const retire = async (): Promise<void> => {
      try {
        await scope.close();
      } finally {
        try {
          await snapshot.close();
        } finally {
          await store.dispose();
        }
      }
    };
    return {
      count: snapshot.rows,
      readAt,
      openReader: (signal) => {
        scope.requireOpen();
        signal?.throwIfAborted();
        return scope.open(rows(signal));
      },
      close: () => (closing ??= retire()),
    };
  } catch (error) {
    await store.dispose();
    throw error;
  }
}
