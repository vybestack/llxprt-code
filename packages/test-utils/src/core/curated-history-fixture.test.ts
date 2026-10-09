/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture, suffixRow } from './history-suffix-test-helpers.js';
import {
  curatedHistoryForTest,
  withCuratedHistoryForTest,
} from './curated-history-fixture.js';
import { forbidHistoryMaterializationForTest } from './history-materialization-test-guard.js';

describe('independent curated test observations', () => {
  it('samples detached pending values without yielding or moving the compression event point', () => {
    const history = new HistoryService();
    const original = suffixRow(0);
    let yielded = false;
    queueMicrotask(() => {
      yielded = true;
    });
    try {
      history.add(original);
      history.add({ speaker: 'ai', blocks: [] });
      const observed = curatedHistoryForTest(history);
      expect(observed).toStrictEqual([original]);
      expect(observed[0]).not.toBe(original);
      expect(observed[0].blocks).not.toBe(original.blocks);
      const samples: IContent[][] = [];
      history.on('compressionLockReleased', () => {
        samples.push(curatedHistoryForTest(history));
      });
      history.startCompression();
      history.add(suffixRow(1));
      history.endCompression();
      expect(samples).toStrictEqual([[original]]);
      expect(samples[0][0]).not.toBe(original);
      expect(samples[0][0]).toStrictEqual(observed[0]);
      expect(curatedHistoryForTest(history)).toHaveLength(2);
      expect(yielded).toBe(false);
    } finally {
      history.dispose();
    }
  });

  for (const size of [512, 8192]) {
    it(`curates ${size} committed rows through raw streaming with a rejecting eager guard`, async () => {
      await withSuffixFixture(size, async (history) => {
        forbidHistoryMaterializationForTest(history);
        let retained: readonly IContent[] | undefined;
        await withCuratedHistoryForTest(history, (rows) => {
          retained = rows;
          expect(rows).toHaveLength(size);
          for (const [index, row] of rows.entries()) {
            expect(row).toStrictEqual(suffixRow(index));
          }
        });
        expect(retained).toHaveLength(0);
      });
    }, 120_000);
  }

  it('clears callback-owned rows and propagates the exact assertion failure', async () => {
    await withSuffixFixture(3, async (history) => {
      const failure = new Error('assertion failed');
      let retained: readonly IContent[] | undefined;
      await expect(
        withCuratedHistoryForTest(history, (rows) => {
          retained = rows;
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(retained).toHaveLength(0);
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row).toStrictEqual(suffixRow(count++));
      }
      expect(count).toBe(3);
    });
  });
});

describe('public curated observation boundary', () => {
  it('curates and restores an eager guard through the raw-history contract', async () => {
    const service = new HistoryService();
    const history: { streamRawHistory(): AsyncIterable<IContent> } = service;
    const original = suffixRow(2, 32);
    try {
      service.add(original);
      service.add({ speaker: 'ai', blocks: [] });
      const observed = curatedHistoryForTest(history);
      expect(observed).toStrictEqual([original]);
      expect(observed[0]).not.toBe(original);
      const restore = forbidHistoryMaterializationForTest(history);
      try {
        expect(() => curatedHistoryForTest(history)).toThrow(
          'eager history materialization forbidden',
        );
        let retained: readonly IContent[] | undefined;
        await withCuratedHistoryForTest(history, (rows) => {
          retained = rows;
          expect(rows).toStrictEqual([original]);
        });
        expect(retained).toHaveLength(0);
      } finally {
        restore();
      }
      expect(curatedHistoryForTest(history)).toStrictEqual([original]);
    } finally {
      service.dispose();
    }
  });

  it('rejects an imitation journal at the eager guard boundary', () => {
    const history = {
      async *streamRawHistory(): AsyncIterable<IContent> {
        yield suffixRow(0);
      },
      journal: { materialize: (): IContent[] => [suffixRow(1)] },
    };
    expect(() => forbidHistoryMaterializationForTest(history)).toThrow(
      'Materialization guard requires the service journal',
    );
  });
});
