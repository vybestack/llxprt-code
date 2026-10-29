/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '../services/history/journalSession.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('journal-owned ordinal sorting', () => {
  const directory = useTempDir('journal-ordinal-sort-');

  it('sorts and deduplicates spill chunks without replacing history roots or charging scratch as live history', async () => {
    const session = await JournalSession.create(`${directory()}/sort.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'preserved' }] },
      ]);
      const pin = await session.store.snapshot();
      try {
        const before = session.store.published;
        if (before === undefined) throw new Error('Missing published history');
        async function* labels(): AsyncGenerator<bigint> {
          for (let i = 1023; i >= 0; i--) {
            yield BigInt(i + 1) * 1048576n;
            yield BigInt(i + 1) * 1048576n;
          }
        }
        const actual: bigint[] = [];
        for await (const label of session.store.sortedLabels(labels()))
          actual.push(label);
        const after = session.store.published;
        if (after === undefined) throw new Error('Lost published history');
        expect(actual).toStrictEqual(
          Array.from({ length: 1024 }, (_, i) => BigInt(i + 1) * 1048576n),
        );
        expect(after.roots).toStrictEqual(before.roots);
        expect(after.aggregate).toStrictEqual(before.aggregate);
        expect(after.durableEnd - after.aggregate.liveBytes).toBeGreaterThan(
          before.durableEnd - before.aggregate.liveBytes,
        );
        expect(after.aggregate.liveBytes).toBe(before.aggregate.liveBytes);
        expect(pin.rows).toBe(1);
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it.each(['stop', 'error'])(
    'releases the admitted descriptor after consumer $s',
    async (mode) => {
      let closed = 0;
      let inputClosed = false;
      const seams = testJournalSeams({}, 1, false);
      const session = await JournalSession.create(`${directory()}/close.llxj`, {
        journal: {
          ...seams.dependencies,
          open: async (path, flags) => {
            const file = await seams.dependencies.open(path, flags);
            return {
              ...file,
              close: async () => {
                closed++;
                await file.close();
              },
            };
          },
        },
      });
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'pinned' }] },
      ]);
      const inputFailure = new Error('ordinal input failed');
      async function* labels(): AsyncGenerator<bigint> {
        try {
          yield 3n;
          if (mode === 'error') throw inputFailure;
          yield 1n;
        } finally {
          inputClosed = true;
        }
      }
      const sorted = session.store.sortedLabels(labels());
      try {
        let first: unknown;
        let failure: unknown;
        try {
          first = await sorted.next();
        } catch (error) {
          failure = error;
        }
        expect(failure).toBe(mode === 'error' ? inputFailure : undefined);
        expect(first).toStrictEqual(
          mode === 'stop' ? { done: false, value: 1n } : undefined,
        );
        await session.close();
        expect(closed).toBe(mode === 'stop' ? 0 : 1);
        await sorted.return(undefined);
      } finally {
        await sorted.return(undefined);
        await session.close();
      }
      expect(inputClosed).toBe(true);
      expect(closed).toBe(1);
    },
  );
});
