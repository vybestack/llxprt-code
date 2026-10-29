/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { JournalTailSource } from './journal-tail-source.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import {
  digest,
  frozenUnits,
} from './__tests__/support/normalization-oracle.js';
import { streamJournalResponseUnitRecords } from './journal-response-units.js';
import type { IContent } from './IContent.js';

describe('tail source bounded preparation and ownership', () => {
  const directory = useTempDir('journal-tail-resources-');

  it('rejects cached tail facts after the native pin is released', async () => {
    const session = await JournalSession.create(`${directory()}/closed.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      const snapshot = await session.store.snapshot();
      const source = await JournalTailSource.create(snapshot, [
        { speaker: 'ai', blocks: [call('tail-only')] },
      ]);
      await snapshot.close();
      await expect(source.facts.fact('tail-only')).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await session.close();
    }
  });

  it('selects a pending response before visiting a 2000-row journal prefix', async () => {
    const reads = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/bounded.llxj`, {
      journal: testJournalSeams({ readCounter: reads }, 1, false).dependencies,
    });
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('pending')] },
        ...Array.from(
          { length: 2000 },
          (_, index): IContent => ({
            speaker: 'human',
            blocks: [{ type: 'text', text: `untouched-${index}` }],
          }),
        ),
      ]);
      const snapshot = await session.store.snapshot();
      const reader = streamJournalResponseUnitRecords(snapshot, [
        { speaker: 'tool', blocks: [response('pending')] },
      ]);
      reads.reads = 0;
      try {
        await reader.next();
        const selected = await reader.next();
        if (selected.done === true) throw new Error('Missing pending response');
        expect({
          blocks: selected.value.content.blocks,
          pending: selected.value.pending,
        }).toStrictEqual({ blocks: [response('pending')], pending: true });
        expect(reads.reads).toBeLessThan(100);
      } finally {
        await reader.return(undefined);
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  }, 120000);

  it('owns pending payloads before yielding and reads the held pin after opener close', async () => {
    const session = await JournalSession.create(`${directory()}/owned.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const rows: IContent[] = [{ speaker: 'ai', blocks: [call('a')] }];
    const payload = { text: 'original' };
    const tail: IContent[] = [
      { speaker: 'tool', blocks: [{ ...response('a'), result: payload }] },
    ];
    const expected = frozenUnits({ id: 'owned', rows, tail });
    try {
      await session.append(rows);
      const snapshot = await session.store.snapshot();
      const reader = streamJournalResponseUnitRecords(snapshot, tail);
      const units: IContent[] = [];
      try {
        const first = await reader.next();
        if (first.done === true) throw new Error('Missing call');
        units.push(first.value.content);
        payload.text = 'changed after ownership transfer';
        await snapshot.close();
        for await (const unit of reader) units.push(unit.content);
        expect(digest(units)).toBe(expected.outputHash);
        await expect(snapshot.facts.fact('a')).rejects.toThrow(
          'pin was released',
        );
      } finally {
        await reader.return(undefined);
      }
    } finally {
      await session.close();
    }
  });
});
