/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';

function summary(index: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: `summary ${index}` }],
    metadata: {
      chronology: {
        seq: index * 4 + 2,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
      chronologyReplaced: {
        fromSeq: index * 4,
        toSeq: index * 4 + 1,
        itemCount: 2,
      },
    },
  };
}

describe('committed summary span attachment lifecycle', () => {
  it('does not apply the density cap to 1100 live summary annotations', async () => {
    const history = new HistoryService({ backend: 'journal' });
    try {
      await history.detachedValues.append(
        (function* (): Generator<IContent> {
          for (let index = 0; index < 1100; index++) yield summary(index);
        })(),
      );
      expect(history.getContextRange().removedInterior).toStrictEqual(
        Array.from({ length: 1100 }, (_, index) => ({
          start: index * 4,
          end: index * 4 + 1,
          reason: 'compressed',
        })),
      );
      await history.detachedValues.append([summary(1100)]);
      expect(history.getContextRange().removedInterior.length).toBe(1101);
    } finally {
      await history.dispose();
    }
  }, 180_000);

  it('keeps copied summaries on their own version across prefix pop, clone, compaction and clear', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append([summary(0), summary(1), summary(2)]);
      const fork = await session.cloneUnlinked();
      try {
        await session.store.commit([
          {
            kind: 'pop',
            cutLabel: (
              await session.store.snapshot().then(async (snapshot) => {
                try {
                  return await snapshot.entryAt(1);
                } finally {
                  await snapshot.close();
                }
              })
            ).label,
            expectedRemoved: 2,
          },
        ]);
        expect(session.store.contextSpans()).toStrictEqual([
          { start: 0, end: 1 },
        ]);
        await fork.store.compact();
        expect(fork.store.contextSpans()).toStrictEqual([
          { start: 0, end: 1 },
          { start: 4, end: 5 },
          { start: 8, end: 9 },
        ]);
        await session.store.commit([{ kind: 'replace', rows: [] }]);
        expect(session.store.contextSpans()).toStrictEqual([]);
        expect(fork.store.contextSpans().length).toBe(3);
      } finally {
        await fork.close();
      }
    } finally {
      await session.close();
    }
  });
});
