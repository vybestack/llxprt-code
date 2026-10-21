/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

describe('request Mistral pin and pending isolation', () => {
  const directory = useTempDir('mistral-tail-pins-');
  it('holds callback ownership across closed openers and isolates concurrent pending views', async () => {
    const session = await JournalSession.create(
      `${directory()}/isolation.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      const { snapshot, stats } = await measuredRequestSnapshot(session);
      const left = await IndexedJournalRequestSnapshot.create(snapshot, [
        { speaker: 'ai', blocks: [call('4SftZvDMX'), call('toolu_alpha-1')] },
      ]);
      const right = await IndexedJournalRequestSnapshot.create(snapshot, [
        { speaker: 'ai', blocks: [call('toolu_alpha-1'), call('4SftZvDMX')] },
      ]);
      await Promise.all([
        left.withMistral(0, async (view) => {
          await snapshot.close();
          await left.close();
          await Promise.resolve();
          expect((await view.mapping('toolu_alpha-1'))?.salt).toBe(1);
          expect(stats.releases).toBe(0);
        }),
        right.withMistral(0, async (view) => {
          expect((await view.mapping('toolu_alpha-1'))?.salt).toBe(0);
        }),
      ]);
      await right.close();
      expect(stats.releases).toBe(1);
      await expect(left.mistralMapping('toolu_alpha-1', 0)).rejects.toThrow(
        'closed',
      );
    } finally {
      await session.close();
    }
  });

  for (const abort of [false, true])
    it(`preserves the primary ${abort ? 'abort' : 'callback'} failure over final release`, async () => {
      const session = await JournalSession.create(
        `${directory()}/failure-${abort}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.store.commit([{ kind: 'mistral', slot: 0 }]);
        const primary = new Error('primary Mistral query');
        const { snapshot, stats } = await measuredRequestSnapshot(
          session,
          new Error('cleanup'),
        );
        const request = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'ai', blocks: [call('abcdefghi')] },
        ]);
        const controller = new AbortController();
        await expect(
          request.withMistral(
            0,
            async (view) => {
              await snapshot.close();
              await request.close();
              expect((await view.mapping('abcdefghi'))?.id).toBe('abcdefghi');
              if (abort) {
                controller.abort(primary);
                return;
              }
              throw primary;
            },
            controller.signal,
          ),
        ).rejects.toBe(primary);
        expect(stats.releases).toBe(1);
      } finally {
        await session.close();
      }
    });

  it('preserves a preparation read failure over final release', async () => {
    const session = await JournalSession.create(`${directory()}/read.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      const primary = new Error('Mistral preparation read');
      const { snapshot, stats } = await measuredRequestSnapshot(
        session,
        new Error('cleanup'),
        async () => {
          await snapshot.close();
          await request.close();
          throw primary;
        },
      );
      const request = await IndexedJournalRequestSnapshot.create(snapshot);
      await expect(request.mistralMapping('missing', 0)).rejects.toBe(primary);
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });
});
