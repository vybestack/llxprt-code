/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

describe('request Kimi query pin ownership', () => {
  const directory = useTempDir('kimi-tail-pins-');
  it('holds the selected pin across asynchronous callback use after both openers close', async () => {
    const session = await JournalSession.create(
      `${directory()}/callback.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      await session.store.commit([{ kind: 'kimi' }]);
      const { snapshot, stats } = await measuredRequestSnapshot(session);
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
        { speaker: 'human', blocks: [call('a', 'tail')] },
      ]);
      await indexed.withKimi(async (view) => {
        await snapshot.close();
        await indexed.close();
        await Promise.resolve();
        expect(stats.releases).toBe(0);
        expect(await view.mappedId('a')).toBe('functions.tail:1');
        expect(await view.ordinal('a')).toBe(1);
        expect(await view.counterBefore()).toBe(2);
      });
      expect(stats.releases).toBe(1);
      await expect(indexed.kimiEligibleCount()).rejects.toThrow('closed');
      await expect(indexed.kimiCounterBefore(0)).rejects.toThrow('closed');
    } finally {
      await session.close();
    }
  });

  for (const abort of [false, true])
    it(`preserves the primary ${abort ? 'abort' : 'callback'} error if final release fails`, async () => {
      const session = await JournalSession.create(
        `${directory()}/failure-${abort}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.store.commit([{ kind: 'kimi' }]);
        const primary = new Error('primary Kimi query error');
        const { snapshot, stats } = await measuredRequestSnapshot(
          session,
          new Error('cleanup'),
        );
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'ai', blocks: [call('a')] },
        ]);
        const controller = new AbortController();
        await expect(
          indexed.withKimi(async (view) => {
            await snapshot.close();
            await indexed.close();
            expect(await view.name('a')).toBe('inspect');
            expect(await view.counterBefore()).toBe(1);
            if (abort) {
              controller.abort(primary);
              return;
            }
            throw primary;
          }, controller.signal),
        ).rejects.toBe(primary);
        expect(stats.releases).toBe(1);
      } finally {
        await session.close();
      }
    });

  it('preserves a failed preparation read when final release fails', async () => {
    const session = await JournalSession.create(`${directory()}/read.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      await session.store.commit([{ kind: 'kimi' }]);
      const primary = new Error('Kimi preparation read');
      const { snapshot, stats } = await measuredRequestSnapshot(
        session,
        new Error('cleanup'),
        async () => {
          await snapshot.close();
          await indexed.close();
          throw primary;
        },
      );
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
      await expect(indexed.kimiEligibleCount()).rejects.toBe(primary);
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });
});
