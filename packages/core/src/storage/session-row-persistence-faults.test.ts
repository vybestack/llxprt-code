/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import type { IContent } from '../services/history/IContent.js';
import { JournalSession } from '../services/history/journalSession.js';
import { withCoreSuffixFixture } from '../services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { mergeRow } from '../services/history/__tests__/support/history-merge-test-helpers.js';
import {
  createCursorJournal,
  replaceJournalRows,
  journalHistoryDigest,
} from './cursor-persistence-test-helpers.js';

async function* rowsForSave(
  row: IContent,
): AsyncGenerator<IContent, void, unknown> {
  yield row;
}

describe('journal row persistence failures', () => {
  it('observes actual charged row writes and compensates a rejecting observer', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const { session, probe } = await createCursorJournal(
        history,
        'write-observation',
      );
      try {
        await session.append([mergeRow(0)]);
        const before = await journalHistoryDigest(session);
        let observed = 0;
        const primary = new Error('row observation failed');
        await expect(
          probe.measureWrite(
            () => replaceJournalRows(session, rowsForSave(mergeRow(1))),
            async () => {
              observed = probe.getPendingByteCount();
              throw primary;
            },
          ),
        ).rejects.toBe(primary);
        expect(observed).toBeGreaterThan(0);
        expect(probe.getPendingByteCount()).toBe(0);
        await session.close();
        const reopened = await JournalSession.open(session.path);
        try {
          expect(await journalHistoryDigest(reopened)).toBe(before);
        } finally {
          await reopened.close();
        }
      } finally {
        await session.close();
      }
    });
  });

  it('leaves the prior target intact when the row producer fails after a written row', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const { session, probe } = await createCursorJournal(
        history,
        'producer-failure',
      );
      try {
        await session.append([mergeRow(0)]);
        const before = await journalHistoryDigest(session);
        const primary = new Error('producer failure after row');
        let closed = false;
        async function* failedRows(): AsyncGenerator<IContent, void, unknown> {
          try {
            yield mergeRow(1);
            throw primary;
          } finally {
            closed = true;
          }
        }
        await expect(replaceJournalRows(session, failedRows())).rejects.toBe(
          primary,
        );
        expect(await journalHistoryDigest(session)).toBe(before);
        expect(closed).toBe(true);
        expect(probe.getPendingByteCount()).toBe(0);
        expect(
          (await readdir(new URL('.', `file://${session.path}`))).filter(
            (name) => name.endsWith('.tmp'),
          ),
        ).toStrictEqual([]);
      } finally {
        await session.close();
      }
    });
  });
});
