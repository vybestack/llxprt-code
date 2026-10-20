/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

describe('normalized request query pin ownership', () => {
  const directory = useTempDir('tail-query-pins-');
  it('uses an older published root and its own tail after a newer append', async () => {
    const session = await JournalSession.create(`${directory()}/old.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'human', blocks: [call('a')] }]);
      const snapshot = await session.store.snapshot();
      await session.append([{ speaker: 'ai', blocks: [call('b')] }]);
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
        { speaker: 'ai', blocks: [call('a')] },
      ]);
      await snapshot.close();
      try {
        expect(await indexed.normalizedCount(1, 0, 'call_b')).toBe(0);
        expect(await indexed.normalizedPosition(1, 0, 'call_a', 1)).toBe(2);
        expect(indexed.pending.firstOutputIndex).toBe(1);
        expect(indexed.count).toBe(3);
      } finally {
        await indexed.close();
      }
      await expect(indexed.normalizedCount(1, 0, 'call_a')).rejects.toThrow(
        'closed',
      );
      await expect(snapshot.facts.fact('a')).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await session.close();
    }
  });

  it('preserves a preparation read error when the final release also fails', async () => {
    const session = await JournalSession.create(
      `${directory()}/prepare-failure.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      const primary = new Error('read failed');
      const { snapshot, stats } = await measuredRequestSnapshot(
        session,
        new Error('release failure'),
        async () => {
          await snapshot.close();
          throw primary;
        },
      );
      await expect(
        IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'tool', blocks: [response('a')] },
        ]),
      ).rejects.toBe(primary);
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('holds the query pin through asynchronous callback consumption after opener close', async () => {
    const session = await JournalSession.create(
      `${directory()}/callback.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      const { snapshot, stats } = await measuredRequestSnapshot(session);
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
        { speaker: 'tool', blocks: [response('a')] },
      ]);
      await indexed.withNormalized(1, 1, 'call_a', async (view) => {
        await snapshot.close();
        await indexed.close();
        await Promise.resolve();
        expect(stats.releases).toBe(0);
        expect(await view.position(1)).toBe(1);
      });
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('holds an iterator until explicit return after opener close', async () => {
    const session = await JournalSession.create(
      `${directory()}/iterator.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a'), call('a')] }]);
      const { snapshot, stats } = await measuredRequestSnapshot(session);
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
      const iterator = indexed.normalizedRange(1, 0, 'call_a');
      expect(await iterator.next()).toStrictEqual({ done: false, value: 0 });
      await snapshot.close();
      await indexed.close();
      expect(stats.releases).toBe(0);
      expect(await iterator.next()).toStrictEqual({ done: false, value: 0 });
      await iterator.return(undefined);
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });

  for (const abort of [false, true])
    it(`preserves the primary ${abort ? 'abort' : 'callback error'} when release also fails`, async () => {
      const session = await JournalSession.create(
        `${directory()}/failure-${abort}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
        const primary = new Error('primary');
        const { snapshot, stats } = await measuredRequestSnapshot(
          session,
          new Error('release failure'),
        );
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
        const controller = new AbortController();
        const result = indexed.withNormalized(
          1,
          0,
          'call_a',
          async () => {
            await snapshot.close();
            await indexed.close();
            if (abort) {
              controller.abort(primary);
              return;
            }
            throw primary;
          },
          undefined,
          controller.signal,
        );
        await expect(result).rejects.toBe(primary);
        expect(stats.releases).toBe(1);
      } finally {
        await session.close();
      }
    });

  it('preserves an iterator abort when its final release fails', async () => {
    const session = await JournalSession.create(`${directory()}/abort.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a'), call('a')] }]);
      const primary = new Error('abort reason');
      const { snapshot, stats } = await measuredRequestSnapshot(
        session,
        new Error('release failure'),
      );
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
      const controller = new AbortController();
      const iterator = indexed.normalizedRange(
        1,
        0,
        'call_a',
        undefined,
        controller.signal,
      );
      await iterator.next();
      await snapshot.close();
      await indexed.close();
      controller.abort(primary);
      await expect(iterator.next()).rejects.toBe(primary);
      expect(stats.releases).toBe(1);
    } finally {
      await session.close();
    }
  });
});
