/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { PendingRequestOverlay } from './journal-indexed-overlay.js';
import { JournalTailSource } from './journal-tail-source.js';
import { call, response } from './__tests__/support/normalization-cases.js';

describe('pending request overlay input bound', () => {
  const directory = useTempDir('pending-overlay-');

  for (const size of [8, 128]) {
    it(`keeps only pending targets over ${size} journal rows`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${size}.llxj`,
        {
          journal: testJournalSeams().dependencies,
        },
      );
      try {
        await session.append(
          Array.from({ length: size }, (_, index) => ({
            speaker: 'ai',
            blocks: [call(`call-${index}`)],
          })),
        );
        const snapshot = await session.store.snapshot();
        try {
          const source = await JournalTailSource.create(snapshot, [
            { speaker: 'tool', blocks: [response('call-0')] },
          ]);
          const overlay = await PendingRequestOverlay.create(snapshot, source);
          expect(overlay.length).toBe(2);
          expect(overlay.maxRows).toBe(2);
          expect([...overlay].map((row) => row.entry.label)).toStrictEqual([
            (await snapshot.entryAt(0)).label,
            snapshot.version?.nextLabel ?? 1n,
          ]);
          expect(overlay.count).toBe(size * 2);
          expect(overlay.firstOutputIndex).toBe(1);
          expect(overlay.at(overlay.length)).toBeUndefined();
        } finally {
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    });
  }

  it('rejects a source that admits more journal targets than its pending input', async () => {
    const session = await JournalSession.create(`${directory()}/excess.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('first')] },
        { speaker: 'ai', blocks: [call('second')] },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const source = await JournalTailSource.create(snapshot, []);
        source.affectedJournalLabels = async () => ({
          labels: [(await snapshot.entryAt(0)).label],
          maxRows: 0,
        });
        await expect(
          PendingRequestOverlay.create(snapshot, source),
        ).rejects.toThrow('Pending request overlay exceeds its input bound');
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
