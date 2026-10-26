/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withCoreSuffixFixture } from '../services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  mergeRow,
  MergeRowHistory,
} from '../services/history/__tests__/support/history-merge-test-helpers.js';
import {
  createCursorJournal,
  replaceJournalRows,
  journalHistoryDigest,
} from './cursor-persistence-test-helpers.js';

function expectedHistory(size: number, bytes: number): string {
  return JSON.stringify(
    Array.from({ length: size }, (_unused, index) => mergeRow(index, bytes)),
  );
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('streamed session row persistence scale', () => {
  for (const size of [512, 8192]) {
    it(`persists ${size} complete mixed media and tool rows against an independent fixture oracle`, async () => {
      await withCoreSuffixFixture(
        size,
        async (history, owners) => {
          const { session, probe: persistence } = await createCursorJournal(
            history,
            'scale-save',
          );
          try {
            let observed = 0;
            let peakPending = 0;
            async function* rows() {
              for await (const row of history.streamRawHistory()) {
                observed++;
                yield row;
              }
            }
            await persistence.measureWrite(
              () => replaceJournalRows(session, rows()),
              async () => {
                peakPending = persistence.getPendingByteCount();
              },
            );
            peakPending = Math.max(
              peakPending,
              persistence.getPeakPendingByteCount(),
            );
            expect(await journalHistoryDigest(session)).toBe(
              digest(expectedHistory(size, 2048)),
            );
            expect(observed).toBe(size);
            expect(peakPending).toBeGreaterThan(0);
            expect(peakPending).toBeLessThanOrEqual(8 * 1024 * 1024);
            expect(persistence.getPendingByteCount()).toBe(0);
            expect(owners.snapshot().peakRows).toBe(1);
            expect(owners.snapshot().liveRows).toBe(0);
          } finally {
            await session.close();
          }
        },
        2048,
        mergeRow,
        undefined,
        (options) => new MergeRowHistory(options),
      );
    }, 600_000);
  }
});

describe('streamed persistence accepts large rows', () => {
  it('persists a valid nine MiB row without a JSON snapshot', async () => {
    const bytes = 9 * 1024 * 1024;
    await withCoreSuffixFixture(
      1,
      async (history) => {
        const { session, probe: persistence } = await createCursorJournal(
          history,
          'large-save',
        );
        try {
          await replaceJournalRows(session, history.streamRawHistory());
          expect(await journalHistoryDigest(session)).toBe(
            digest(expectedHistory(1, bytes)),
          );
          expect(persistence.getPendingByteCount()).toBe(0);
        } finally {
          await session.close();
        }
      },
      bytes,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  }, 120_000);
});
