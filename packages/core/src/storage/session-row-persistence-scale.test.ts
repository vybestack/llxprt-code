/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { withCoreSuffixFixture } from '../services/history/core-suffix-fixture-test-helpers.js';
import {
  mergeRow,
  MergeRowHistory,
} from '../services/history/history-merge-test-helpers.js';
import { createCursorPersistence } from './cursor-persistence-test-helpers.js';

function expectedHistory(size: number, bytes: number): string {
  return JSON.stringify(
    Array.from({ length: size }, (_unused, index) => mergeRow(index, bytes)),
  );
}

function savedHistory(session: unknown): string {
  if (
    typeof session !== 'object' ||
    session === null ||
    !('history' in session)
  )
    throw new Error('Missing persisted history');
  return JSON.stringify(session.history);
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
          const persistence = createCursorPersistence(history, 'scale-save');
          let observed = 0;
          let peakPending = 0;
          await persistence.saveRows(history.streamRawHistory(), async () => {
            observed++;
            peakPending = Math.max(
              peakPending,
              persistence.getPendingByteCount(),
            );
          });
          const session: unknown = JSON.parse(
            await readFile(persistence.getSessionFilePath(), 'utf8'),
          );
          expect(digest(savedHistory(session))).toBe(
            digest(expectedHistory(size, 2048)),
          );
          expect(observed).toBe(size);
          expect(peakPending).toBeGreaterThan(0);
          expect(peakPending).toBeLessThanOrEqual(8 * 1024 * 1024);
          expect(persistence.getPendingByteCount()).toBe(0);
          expect(owners.snapshot().peakRows).toBe(1);
          expect(owners.snapshot().liveRows).toBe(0);
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
  it('persists a valid nine MiB row when the configured queue permits it', async () => {
    const bytes = 9 * 1024 * 1024;
    await withCoreSuffixFixture(
      1,
      async (history) => {
        const persistence = createCursorPersistence(history, 'large-save');
        await persistence.saveRows(history.streamRawHistory());
        const session: unknown = JSON.parse(
          await readFile(persistence.getSessionFilePath(), 'utf8'),
        );
        expect(digest(savedHistory(session))).toBe(
          digest(expectedHistory(1, bytes)),
        );
        expect(persistence.getPendingByteCount()).toBe(0);
      },
      bytes,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  }, 120_000);
});
