/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import { ChronologyStamper } from './historyChronology.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import type {
  DensityRowDecision,
  DiskDensityOptimizer,
} from './historyDiskDensity.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { HistoryDensityRequest } from './historyStorePort.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(
  speaker: IContent['speaker'],
  text: string,
  seq: number,
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 7 } },
  };
}

const SEED = [
  row('human', 'zero', 1),
  row('ai', 'one', 2),
  row('human', 'two', 3),
  row('ai', 'three', 4),
];

/** Removes row 1 and replaces row 2 with a shorter row that carries no marker of its own. */
function optimizer(decisions: Map<number, DensityRowDecision>) {
  const optimize: DiskDensityOptimizer = () => ({
    removalCount: [...decisions.values()].filter((d) => d.kind === 'removed')
      .length,
    replacementCount: [...decisions.values()].filter(
      (d) => d.kind === 'replaced',
    ).length,
    metadata: {
      readWritePairsPruned: 0,
      fileDeduplicationsPruned: 0,
      recencyPruned: 0,
    },
    decision: (index) => decisions.get(index),
    close: () => {},
  });
  return optimize;
}

function decisionsOf(): Map<number, DensityRowDecision> {
  return new Map<number, DensityRowDecision>([
    [1, { kind: 'removed' }],
    [
      2,
      {
        kind: 'replaced',
        row: { speaker: 'human', blocks: [{ type: 'text', text: 'short' }] },
      },
    ],
  ]);
}

function textsOf(rows: readonly IContent[]): unknown[] {
  return rows.map((content) => [
    content.speaker,
    content.blocks
      .map((block) => (block.type === 'text' ? block.text : block.type))
      .join(''),
    content.metadata?.chronology?.seq,
  ]);
}

describe('HistoryStorePort.optimizeDensity', () => {
  it('old store: removes and replaces the rows the optimizer decided on, keeping the markers', async () => {
    const history = new HistoryService();
    history.setTokenizerFactory(exactTokenizer());
    try {
      history.addAll(SEED.map((content) => structuredClone(content)));
      await history.waitForTokenUpdates();

      await history.optimizeDensityRows(optimizer(decisionsOf()));

      const rows: IContent[] = [];
      for await (const content of history.streamRawHistory())
        rows.push(content);
      expect(textsOf(rows)).toStrictEqual(EXPECTED);
    } finally {
      await history.dispose();
    }
  });

  describe('journal store', () => {
    const directory = useTempDir('journal-density-');
    const open: JournalHistoryStore[] = [];
    let counter = 0;
    let estimates = 0;

    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
      estimates = 0;
    });

    async function openStore(): Promise<JournalHistoryStore> {
      const session = await JournalSession.create(
        path.join(directory(), `density-${counter++}.llxj`),
      );
      const store = new JournalHistoryStore(session);
      open.push(store);
      for (const content of SEED)
        store.apply({ kind: 'content', content: structuredClone(content) });
      await store.waitForDurable();
      return store;
    }

    function hostFor(batches: HistoryBatchRowSource[]): DetachedHistoryHost {
      return {
        // The journal path never reads it.
        journal: new HistoryJournalStore(),
        chronology: new ChronologyStamper(() => 0),
        snapshot: () => ({
          tokens: 0,
          spans: [],
          chronology: new ChronologyStamper(() => 0).snapshot(),
        }),
        apply: () => {},
        waitForTokenUpdates: () => Promise.resolve(),
        estimate: (rows) => {
          estimates++;
          return Promise.resolve([...rows].length);
        },
        notify: () => {},
        notifyBatch: () => {},
        notifyRows: (source) => {
          batches.push(source);
        },
        notifyTokens: () => {},
        notifyRange: () => {},
      };
    }

    function requestOf(
      optimize: DiskDensityOptimizer,
      batches: HistoryBatchRowSource[],
    ): HistoryDensityRequest {
      return {
        optimize,
        host: hostFor(batches),
        mutate: () => Promise.reject(new Error('the old store arm')),
      };
    }

    it('removes and replaces the rows the optimizer decided on, keeping the markers, as the old store does', async () => {
      const store = await openStore();

      await store.optimizeDensity(requestOf(optimizer(decisionsOf()), []));

      expect(textsOf(await store.materialize())).toStrictEqual(EXPECTED);
    });

    it('hands the optimizer the rows in order, one indexed read each', async () => {
      const store = await openStore();
      const seen: IContent[] = [];
      const observing: DiskDensityOptimizer = (source) => {
        for (let index = 0; index < source.length; index++)
          seen.push(source.readRow(index));
        return optimizer(decisionsOf())(source);
      };

      await store.optimizeDensity(requestOf(observing, []));

      expect(textsOf(seen)).toStrictEqual(textsOf(SEED));
    });

    it('writes, estimates and announces nothing when the optimizer changes nothing', async () => {
      const store = await openStore();
      const batches: HistoryBatchRowSource[] = [];

      await store.optimizeDensity(requestOf(optimizer(new Map()), batches));

      expect(textsOf(await store.materialize())).toStrictEqual(textsOf(SEED));
      expect(batches).toHaveLength(0);
      expect(estimates).toBe(0);
    });

    it('closes the optimizer result when the publication fails', async () => {
      const store = await openStore();
      let closed = 0;
      const failing: DiskDensityOptimizer = (source) => ({
        ...optimizer(decisionsOf())(source),
        decision: () => {
          throw new Error('decision failed');
        },
        close: () => closed++,
      });

      await expect(
        store.optimizeDensity(requestOf(failing, [])),
      ).rejects.toThrow('decision failed');

      expect(closed).toBe(1);
      expect(textsOf(await store.materialize())).toStrictEqual(textsOf(SEED));
    });
  });
});

const EXPECTED = [
  ['human', 'zero', 1],
  ['human', 'short', 3],
  ['ai', 'three', 4],
];
