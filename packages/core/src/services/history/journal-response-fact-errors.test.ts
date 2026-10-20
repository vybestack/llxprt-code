/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { responseParts } from './journal-response-parts.js';
import { responseAdjacent } from './journal-response-slots.js';
import type { JournalResponseSource } from './journal-response-source.js';

describe('invalid native response index data', () => {
  const directory = useTempDir('journal-response-fact-errors-');
  it('rejects a real response with no best pointer before emitting a lazy plan', async () => {
    const session = await JournalSession.create(
      `${directory()}/missing-best.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('a')] },
        { speaker: 'tool', blocks: [response('a')] },
      ]);
      const snapshot = await session.store.snapshot();
      const parts = responseParts(snapshot);
      try {
        const part = await parts.next();
        const next = await parts.next();
        if (part.done === true || next.done === true)
          throw new Error('Missing source parts');
        const source: JournalResponseSource = {
          facts: {
            fact: async (id) => {
              const fact = await snapshot.facts.fact(id);
              return fact === undefined
                ? undefined
                : { ...fact, best: undefined, bestScore: 0 };
            },
          },
          entries: () => snapshot.entries(),
          entryByLabel: (label) => snapshot.entryByLabel(label),
          readIds: (entry) => snapshot.readIds(entry),
          readRow: (entry) => snapshot.readRow(entry),
          readBlock: (entry, index) => snapshot.readBlock(entry, index),
          readMetadata: (entry) => snapshot.readMetadata(entry),
        };
        await expect(
          responseAdjacent(source, part.value, next.value),
        ).rejects.toThrow('Real response fact has no best pointer');
      } finally {
        await parts.return(undefined);
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
