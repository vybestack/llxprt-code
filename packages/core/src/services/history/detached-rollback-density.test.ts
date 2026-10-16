/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import type { ContextRange } from './historyEventTypes.js';
import {
  withDetachedFixture,
  detachedRows,
  detachedRow,
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';

describe('ordinal detached density values', () => {
  it('inherits original ordinal chronology, records membership spans and restores them after acknowledged rollback', async () => {
    await withDetachedFixture(async ({ history, recorder, owners }) => {
      await history.detachedValues.replace(detachedRows(4));
      const caller: IContent = {
        ...detachedRow(99),
        metadata: Object.freeze(detachedRow(99).metadata),
      };
      const expectedCaller = detachedRow(99);
      await history.detachedValues.transform(async (source, sink) => {
        let index = 0;
        for await (const row of source.streamRows()) {
          if (index === 1) sink.removeValue(index);
          else if (index === 2) sink.appendReplacement(index, caller);
          else sink.appendValue(row);
          index++;
        }
      });
      expect(caller).toStrictEqual(expectedCaller);
      const stored = await rowsOf(history);
      expect(stored.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
        1, 3, 4,
      ]);
      expect(stored[1].blocks).toStrictEqual(detachedRow(99).blocks);
      const range: ContextRange = {
        firstSeq: 1,
        lastSeq: 4,
        totalEntries: 3,
        approximate: false,
        removedInterior: [
          { start: 2, end: 2, reason: 'density-removed' },
          { start: 3, end: 3, reason: 'density-replaced' },
        ],
      };
      const committedRange = history.getContextRange();
      expect(committedRange).toStrictEqual(range);
      const oracle = async function* (): AsyncGenerator<
        (typeof stored)[number],
        void,
        unknown
      > {
        yield detachedRow(0);
        yield {
          ...detachedRow(99),
          metadata: {
            id: 'duplicate',
            chronology: detachedRow(2).metadata?.chronology,
          },
        };
        yield detachedRow(3);
      };
      const expected = await detachedDigest(oracle());
      const failure = new Error('density rollback');
      expect(
        await rejectedValue(
          history.detachedValues.replace(detachedRows(8), undefined, {
            onAcknowledged: () => {
              throw failure;
            },
          }),
        ),
      ).toBe(failure);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(history.getContextRange()).toStrictEqual(range);
      expect(history.getTotalTokens()).toBe(12);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
