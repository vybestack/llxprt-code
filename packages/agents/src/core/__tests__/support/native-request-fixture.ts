/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-request-options.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export async function nativeRequestFixture(
  rows: AsyncIterable<IContent>,
  tail: readonly IContent[] = [],
  options: ProviderCuratedStreamOptions = {},
  sessionOptions: JournalSessionOptions = {},
): Promise<ProviderRequestSnapshot> {
  const store = new JournalHistoryStore(
    await JournalSession.createUnlinked(sessionOptions),
  );
  try {
    await store.replaceStreamed(rows);
    const snapshot = await store.prepareCurated({
      tail,
      logger: new DebugLogger('agents-native-request-fixture'),
      isCompressing: false,
      options,
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
