/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

function markedRow(index: number, bytes: number): IContent {
  return {
    ...suffixRow(index, bytes),
    metadata: {
      chronology: { seq: index + 10, userTurn: index, step: 0, recordedAt: 0 },
    },
  };
}

function legacyRow(index: number, bytes: number): IContent {
  const row = suffixRow(index, bytes);
  return { speaker: row.speaker, blocks: row.blocks };
}

function unmarkedFirst(index: number, bytes: number): IContent {
  return index === 0 ? legacyRow(index, bytes) : markedRow(index, bytes);
}

describe('indexed clear chronology boundaries', () => {
  for (const fixture of [
    { name: 'marked', size: 3, makeRow: markedRow, start: 10, end: 12 },
    {
      name: 'unmarked first',
      size: 3,
      makeRow: unmarkedFirst,
      start: 0,
      end: 12,
    },
    { name: 'legacy', size: 3, makeRow: legacyRow, start: 0, end: 0 },
    { name: 'empty', size: 0, makeRow: markedRow, start: 0, end: 0 },
  ]) {
    it(`clears ${fixture.name} rows without decoding bodies and preserves the removed span`, async () => {
      await withSuffixFixture(
        fixture.size,
        async (history, owners, counters) => {
          history.clear();
          expect(counters.snapshot().rowsDecoded).toBe(0);
          expect(owners.snapshot().acquisitions).toBe(0);
          expect(history.length()).toBe(0);
          expect(history.getContextRange().removedInterior).toStrictEqual(
            fixture.size === 0
              ? []
              : [{ start: fixture.start, end: fixture.end, reason: 'cleared' }],
          );
          expect((await history.streamRawHistory().next()).done).toBe(true);
        },
        2048,
        fixture.makeRow,
      );
    });
  }
});
