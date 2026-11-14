/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { openOwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { journalRoutedHistory } from './support/journal-detached-history.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import type { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';

async function assertForkSnapshot(fork: JournalSession): Promise<void> {
  const saved = await fork.store.snapshot();
  try {
    expect(saved.rows).toBe(32);
    expect(
      decodeStoredRow(await saved.readRow(await saved.entryAt(0))).blocks,
    ).toStrictEqual(fallbackRow(0).blocks);
  } finally {
    await saved.close();
  }
}

describe('borrowed native fallback version lifecycle', () => {
  const directory = useTempDir('native-fallback-lifecycle-');
  it('keeps the borrowed checkpoint readable across awaited fork/compaction and publication while an old pin survives', async () => {
    const owned = await openOwnedJournal(
      join(directory(), 'primary.llxj'),
      Array.from({ length: 32 }, (_, index) => ({
        content:
          index === 1
            ? { ...fallbackRow(index), speaker: 'ai', blocks: [] }
            : fallbackRow(index),
        origin: index % 2 === 0 ? 'even' : 'odd',
      })),
    );
    const history = journalRoutedHistory(owned);
    history.setTokenizerFactory(exactTokenizer());
    history.syncTotalTokens(31);
    await history.waitForTokenUpdates();
    try {
      const prior = await owned.session.store.snapshot();
      try {
        await nativeFallback(history, 16, async (candidate) => {
          const fork = await owned.session.cloneUnlinked();
          try {
            await fork.store.compact();
            expect(await candidate.sourceOrdinalAt?.(candidate.start)).toBe(16);
            expect(
              (await candidate.rows.readRow(candidate.start)).blocks,
            ).toStrictEqual(fallbackRow(16).blocks);
            await publishProviderFallbackCandidate(
              history,
              candidate,
              'test-model',
            );
            expect(candidate.rows.length).toBe(31);
            expect((await candidate.rows.readRow(0)).blocks).toStrictEqual(
              fallbackRow(0).blocks,
            );
            await assertForkSnapshot(fork);
          } finally {
            await fork.close();
          }
        });
        expect(
          decodeStoredRow(await prior.readRow(await prior.entryAt(0))).blocks,
        ).toStrictEqual(fallbackRow(0).blocks);
      } finally {
        await prior.close();
      }
      await owned.session.store.compact();
      const actual = await Array.fromAsync(owned.store.streamRows());
      expect(actual.map((row) => row.blocks)).toStrictEqual(
        Array.from(
          { length: 16 },
          (_, index) => fallbackRow(index + 16).blocks,
        ),
      );
      expect(await owned.originsOfRows()).toStrictEqual(
        Array.from({ length: 16 }, (_, index) =>
          index % 2 === 0 ? 'even' : 'odd',
        ),
      );
    } finally {
      await history.dispose();
      await owned.dispose();
    }
  }, 180_000);

  it('preserves numeric-zero ownership when the minimum surviving turn starts at zero', async () => {
    const owned = await openOwnedJournal(join(directory(), 'zero.llxj'), [
      { content: fallbackRow(0), origin: 'zero' },
      {
        content: { ...fallbackRow(1), speaker: 'ai', blocks: [] },
        origin: 'hole',
      },
      { content: fallbackRow(2), origin: 'two' },
    ]);
    const history = journalRoutedHistory(owned);
    history.setTokenizerFactory(exactTokenizer());
    history.syncTotalTokens(2);
    await history.waitForTokenUpdates();
    try {
      const bytes = statSync(owned.session.path).size;
      expect(await nativeFallback(history, 2)).toStrictEqual({
        outcome: 'noop',
      });
      expect(statSync(owned.session.path).size).toBe(bytes);
      const result = await nativeFallback(history, 0, async (candidate) => {
        expect(candidate.start).toBe(0);
        expect(await candidate.sourceOrdinalAt?.(0)).toBe(0);
        expect(candidate.hasPendingRows).toBe(false);
        await publishProviderFallbackCandidate(
          history,
          candidate,
          'test-model',
        );
      });
      expect(result).toStrictEqual({ outcome: 'applied', summary: undefined });
      expect(await owned.originsOfRows()).toStrictEqual(['zero', 'two']);
    } finally {
      await history.dispose();
      await owned.dispose();
    }
  });
});
