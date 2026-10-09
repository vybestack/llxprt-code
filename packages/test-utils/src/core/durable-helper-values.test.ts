/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import { collectRawHistory } from './collect-raw-history.js';
import { collectRowsForAssertions } from './collect-rows-for-assertions.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';

describe('durable relocated helper values', () => {
  it('keeps independent decoded rows after clearing and releasing the producer', async () => {
    let retained: Awaited<ReturnType<typeof collectRawHistory>> = [];
    await withSuffixFixture(512, async (history, ownership) => {
      retained = await collectRawHistory(history);
      const observed = observeHistorySynchronouslyForTest(history);
      expect(observed).toStrictEqual(retained);
      expect(observed[0]).not.toBe(retained[0]);
      history.clear();
      await history.waitForCommit();
      gcAndSweep();
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await collectRawHistory(history)).toStrictEqual([]);
      expect(retained).toStrictEqual(
        Array.from({ length: 512 }, (_, index) => suffixRow(index)),
      );
    });
    gcAndSweep();
    expect(retained[511]).toStrictEqual(suffixRow(511));
  });

  it('clears borrowed callback rows while preserving explicitly copied values', async () => {
    await withSuffixFixture(512, async (history, ownership) => {
      let borrowed: readonly object[] = [];
      let values: string[] = [];
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        borrowed = rows;
        values = rows.flatMap((row) =>
          row.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        );
      });
      expect(borrowed).toHaveLength(0);
      expect(ownership.snapshot().liveRows).toBe(0);
      history.clear();
      await history.waitForCommit();
      expect(values).toStrictEqual(
        Array.from({ length: 512 }, (_, index) => `${index}:`),
      );
    });
  });
});
