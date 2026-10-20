/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';
import { streamJournalResponseUnits } from './journal-response-units.js';

describe('native indexed unit metadata', () => {
  const directory = useTempDir('indexed-unit-metadata-');

  it('keeps empty-id Rt for reconstruction while excluding it from real-response targets', async () => {
    const session = await JournalSession.create(
      `${directory()}/empty-rt.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([
        { speaker: 'tool', blocks: [response(''), response('')] },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const first = await snapshot.entryAt(0);
        const fact = await snapshot.facts.fact('');
        expect(fact?.firstToolResponse).toStrictEqual({
          label: first.label,
          part: 0,
          block: 0,
        });
        expect(fact?.firstResponse).toBeUndefined();
        expect(fact?.best).toBeUndefined();
        expect(first.reconBlocks).toBe(2);
        expect(first.answered).toBe(0);
        expect(snapshot.units).toBe(1);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('counts reconstructed, split, stripped and cross-speaker adjacent units in the published tree', async () => {
    const session = await JournalSession.create(`${directory()}/units.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('a')] },
      { speaker: 'ai', blocks: [call('a')] },
      { speaker: 'tool', blocks: [response('b'), response('b')] },
      { speaker: 'tool', blocks: [call('c'), response('c')] },
      { speaker: 'human', blocks: [response('missing')] },
      { speaker: 'tool', blocks: [{ type: 'text', text: 'tool text' }] },
    ];
    try {
      await session.append(rows);
      const snapshot = await session.store.snapshot();
      try {
        const collected: IContent[] = [];
        for await (const unit of streamJournalResponseUnits(snapshot))
          collected.push(unit);
        expect(collected.map((unit) => unit.speaker)).toStrictEqual([
          'human',
          'tool',
          'ai',
          'ai',
          'tool',
          'ai',
          'tool',
          'tool',
        ]);
        expect(snapshot.units).toBe(collected.length);
        const entries = [];
        for await (const entry of snapshot.entries()) entries.push(entry);
        const expectedPrefixes = [0, 2, 3, 5, 7, 7];
        for (const [index, entry] of entries.entries()) {
          expect(await snapshot.unitsBelow(entry.label)).toBe(
            expectedPrefixes[index],
          );
        }
        for (let index = 0; index < collected.length; index++) {
          const selected = await snapshot.unitAt(index);
          expect(selected.entry.label).toBe(
            entries[[0, 0, 1, 2, 2, 3, 3, 5][index]].label,
          );
          expect(selected.unit).toBe([0, 1, 0, 0, 1, 0, 1, 0][index]);
        }
        await expect(snapshot.unitAt(-1)).rejects.toThrow(RangeError);
        await expect(snapshot.unitAt(collected.length)).rejects.toThrow(
          RangeError,
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
