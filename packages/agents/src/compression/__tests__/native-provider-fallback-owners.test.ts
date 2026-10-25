/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  openOwnedJournal,
  type OwnedJournal,
} from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { OwnerDictionary } from '@vybestack/llxprt-code-core/journal/ownerDictionary.js';
import { journalRoutedHistory } from './support/journal-detached-history.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';

async function persistedOrigins(
  owned: OwnedJournal,
): Promise<Array<string | undefined>> {
  const reader = await openJournalReadOnly(owned.session.path);
  try {
    const dictionary = await OwnerDictionary.load(owned.session.store);
    const actual: Array<string | undefined> = [];
    const root = rowTreeRootOf(reader.trailer);
    if (root !== undefined)
      for await (const entry of iterateRowEntries(reader, root))
        actual.push(dictionary.originOf(entry.owner));
    return actual;
  } finally {
    await reader.close();
  }
}

describe('native provider fallback current owners', () => {
  const directory = useTempDir('native-provider-fallback-owners-');
  const origins = [undefined, 'a', 'b'];
  it.each([3, 64, 65, 5000])(
    'keeps raw source ordinals after invalid AI holes at %i rows',
    async (size) => {
      const owned = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        Array.from({ length: size + 3 }, (_, index) => ({
          content:
            index === 1
              ? { ...fallbackRow(index), speaker: 'ai', blocks: [] }
              : fallbackRow(index),
          origin: origins[index % origins.length],
        })),
      );
      const history = journalRoutedHistory(owned);
      await history.waitForCommit();
      history.setTokenizerFactory(exactTokenizer());
      history.syncTotalTokens(size + 2);
      await history.waitForTokenUpdates();
      const pin = await owned.session.store.snapshot();
      try {
        const creates = await operationFileCreates(async () => {
          const result = await nativeFallback(history, size);
          expect(result.outcome).toBe('applied');
        }, true);
        const expected = Array.from({ length: size }, (_, offset) => {
          const index = offset + 3;
          return origins[index % origins.length];
        });
        expect(await owned.originsOfRows()).toStrictEqual(expected);
        expect(creates).toStrictEqual({ directories: [], files: [] });
        expect(pin.rows).toBe(size + 3);
        expect((await pin.readRow(await pin.entryAt(0))).blocks).toHaveLength(
          1,
        );
        expect(await persistedOrigins(owned)).toStrictEqual(expected);
      } finally {
        await pin.close();
        await history.dispose();
        await owned.dispose();
      }
    },
    180_000,
  );
});
