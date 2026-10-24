/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '../../../../debug/index.js';
import type { RowOwnership } from '../../../../recording/rowOwnership.js';
import type { IContent } from '../../IContent.js';
import { JournalHistoryStore } from '../../journalHistoryStore.js';
import { JournalSession } from '../../journalSession.js';
import type { ProviderRequestSnapshot } from '../../provider-request-snapshot.js';

export async function openNativeProviderFixture(
  root: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  count: number,
  ownership?: RowOwnership,
): Promise<ProviderRequestSnapshot> {
  const session = await JournalSession.createUnlinked({
    unlinkedDirectory: root,
  });
  const store = new JournalHistoryStore(session);
  try {
    await store.replaceFrom(contents, count);
    const snapshot = await store.prepareCurated({
      tail: [],
      logger: new DebugLogger('native-provider-fixture'),
      isCompressing: false,
      options: { ownership },
    });
    let closing: Promise<void> | undefined;
    const retire = async (): Promise<void> => {
      try {
        await snapshot.close();
      } finally {
        await store.dispose();
      }
    };
    return {
      native: snapshot.native,
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      readAt: (index, signal) => snapshot.readAt(index, signal),
      openReader: (signal) => snapshot.openReader(signal),
      close: () => (closing ??= retire()),
    };
  } catch (error) {
    await store.dispose();
    throw error;
  }
}
