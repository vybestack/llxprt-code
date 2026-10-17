/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import { exactTokenizer, rowsOf } from './chronology-rollback-test-helpers.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryTransform,
} from './detachedHistoryMutation.js';
import { ChronologyStamper } from './historyChronology.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';

const SEED = 8;
const SEED_BYTES = 256;
/** Large enough that rewriting a row would show in the file size. */
const BIG_BYTES = 8192;

/** What the two stores must agree on; the wall-clock `recordedAt` is left out. */
interface Outcome {
  readonly rows: unknown[];
  readonly tokens: number;
  readonly range: ContextRange;
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function shape(rows: readonly IContent[]): unknown[] {
  return rows.map((row) => {
    const chronology = row.metadata?.chronology;
    return [
      row.speaker,
      row.blocks,
      chronology && [chronology.seq, chronology.userTurn, chronology.step],
      row.metadata?.chronologyReplaced,
    ];
  });
}

function seedRows(bytes: number): IContent[] {
  return Array.from({ length: SEED }, (_, index) => detachedRow(index, bytes));
}

/** The old store: a HistoryService on its own journal, driven through the detached API. */
async function viaOldStore(
  transform: DetachedHistoryTransform,
  bytes = SEED_BYTES,
): Promise<Outcome> {
  return withDetachedFixture(async ({ history }) => {
    await history.detachedValues.replace(detachedRows(SEED, bytes));
    await history.waitForTokenUpdates();
    await history.detachedValues.transform(transform);
    await history.waitForTokenUpdates();
    return {
      rows: shape(await rowsOf(history)),
      tokens: history.getTotalTokens(),
      range: history.getContextRange(),
    };
  });
}

interface Observed {
  applied: Array<{ tokens: number; spans: readonly RemovedInteriorSpan[] }>;
  ranges: ContextRange[];
  /** Each `contentBatchAdded` the store announced, with the version that was acked when it fired. */
  batches: Array<{ source: HistoryBatchRowSource; ackedCommitSeq: number }>;
}

interface JournalFixture {
  readonly store: JournalHistoryStore;
  readonly host: DetachedHistoryHost;
  readonly stamper: ChronologyStamper;
  readonly session: JournalSession;
  readonly observed: Observed;
  readonly startTokens: number;
  readonly dispose: () => Promise<void>;
}

/** A detached host over a journal store seeded like the old store, with the estimate of a real HistoryService. */
async function openJournal(
  file: string,
  bytes = SEED_BYTES,
): Promise<JournalFixture> {
  const session = await JournalSession.create(file);
  const store = new JournalHistoryStore(session);
  const stamper = new ChronologyStamper(() => 0);
  const rows = seedRows(bytes);
  for (const content of rows) {
    stamper.stamp(content);
    store.apply({ kind: 'content', content });
  }
  await store.waitForDurable();
  const estimator = new HistoryService();
  estimator.setTokenizerFactory(exactTokenizer());
  const startTokens = await estimator.estimateTokensForContents(rows);
  const observed: Observed = { applied: [], ranges: [], batches: [] };
  const host: DetachedHistoryHost = {
    // The journal path never reads it; the old store's port is a placeholder.
    journal: new HistoryJournalStore(),
    chronology: stamper,
    snapshot: () => ({
      tokens: last(observed.applied)?.tokens ?? startTokens,
      spans: last(observed.applied)?.spans ?? [],
      chronology: stamper.snapshot(),
    }),
    apply: (tokens, spans) => {
      observed.applied.push({ tokens, spans });
    },
    waitForTokenUpdates: () => Promise.resolve(),
    estimate: (batch, model, signal) =>
      estimator.estimateTokensForContents(batch, model, signal),
    notify: (_delta, range) => {
      observed.ranges.push(range);
    },
    notifyBatch: () => {},
    notifyRows: (source) => {
      observed.batches.push({
        source,
        ackedCommitSeq: session.store.snapshot().version?.commitSeq ?? 0,
      });
    },
    notifyTokens: () => {},
    notifyRange: (range) => {
      observed.ranges.push(range);
    },
  };
  return {
    store,
    host,
    stamper,
    session,
    observed,
    startTokens,
    dispose: async () => {
      await store.dispose();
      await estimator.dispose();
    },
  };
}

async function viaJournalStore(
  file: string,
  transform: DetachedHistoryTransform,
  bytes = SEED_BYTES,
): Promise<Outcome> {
  const fixture = await openJournal(file, bytes);
  try {
    await fixture.store.publishDetached(
      { transform },
      fixture.host,
      undefined,
      {},
    );
    const { applied, ranges } = fixture.observed;
    return {
      rows: shape(await fixture.store.materialize()),
      tokens: last(applied)?.tokens ?? fixture.startTokens,
      range: ranges[ranges.length - 1],
    };
  } finally {
    await fixture.dispose();
  }
}

/** Keeps the first three rows, then adds two new ones: a copied head and a streamed tail. */
const keepHeadThenReplace: DetachedHistoryTransform = async (source, sink) => {
  let index = 0;
  for await (const row of source.streamRows()) {
    if (index++ < 3) await sink.appendValue(row);
  }
  await sink.appendValue(detachedRow(40, SEED_BYTES));
  await sink.appendValue(detachedRow(41, SEED_BYTES));
};

/** A compression: one summary of the first five rows, then the tail as it was. */
const compressKeepingTail: DetachedHistoryTransform = async (source, sink) => {
  await sink.appendValue({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'summary of the first five rows' }],
    metadata: { chronologyReplaced: { fromSeq: 1, toSeq: 5, itemCount: 5 } },
  });
  let index = 0;
  for await (const row of source.streamRows()) {
    if (index++ >= 5) await sink.appendValue(row);
  }
};

/** A density pass: drops row 1, swaps row 2 for another body, keeps the rest. */
const thinOut: DetachedHistoryTransform = async (source, sink) => {
  let index = 0;
  for await (const row of source.streamRows()) {
    if (index === 1) await sink.removeValue(index);
    else if (index === 2)
      await sink.appendReplacement(index, detachedRow(99, SEED_BYTES));
    else await sink.appendValue(row);
    index++;
  }
};

const keepAll: DetachedHistoryTransform = async (source, sink) => {
  for await (const row of source.streamRows()) await sink.appendValue(row);
};

const keepFirstThree: DetachedHistoryTransform = async (source, sink) => {
  let index = 0;
  for await (const row of source.streamRows()) {
    if (index++ < 3) await sink.appendValue(row);
  }
};

const keepNothing: DetachedHistoryTransform = async (source) => {
  for await (const row of source.streamRows()) void row;
};

async function commitSeqOf(file: string): Promise<number | undefined> {
  const reader = await openJournalReadOnly(file);
  try {
    return reader.trailer?.commitSeq;
  } finally {
    await reader.close();
  }
}

describe('JournalHistoryStore.publishDetached', () => {
  const directory = useTempDir('journal-publish-detached-');

  describe('gives the result the old store gives', () => {
    const cases: Array<[string, DetachedHistoryTransform]> = [
      ['a compression that keeps a tail', compressKeepingTail],
      ['a density pass (remove and replace)', thinOut],
      ['a result that keeps a head and replaces the rest', keepHeadThenReplace],
      ['a result that keeps every row', keepAll],
      ['a result cut to its first rows', keepFirstThree],
      ['an emptied result', keepNothing],
    ];
    for (const [name, transform] of cases) {
      it(`for ${name}: same rows, tokens and context range`, async () => {
        const expected = await viaOldStore(transform);
        const actual = await viaJournalStore(
          path.join(directory(), 'equal.llxj'),
          transform,
        );
        expect(actual.rows).toStrictEqual(expected.rows);
        expect(actual.tokens).toBe(expected.tokens);
        expect(actual.range).toStrictEqual(expected.range);
      });
    }

    it('records the spans a density pass leaves behind', async () => {
      const actual = await viaJournalStore(
        path.join(directory(), 'spans.llxj'),
        thinOut,
      );
      expect(actual.range.removedInterior).toStrictEqual([
        { start: 2, end: 2, reason: 'density-removed' },
        { start: 3, end: 3, reason: 'density-replaced' },
      ]);
    });
  });

  it('writes no bytes for a result equal to the rows it started from', async () => {
    const file = path.join(directory(), 'unchanged.llxj');
    const { store, host, observed, dispose } = await openJournal(
      file,
      BIG_BYTES,
    );
    try {
      const sizeBefore = fs.statSync(file).size;
      const commitBefore = await commitSeqOf(file);

      await store.publishDetached({ transform: keepAll }, host, undefined, {});

      expect(fs.statSync(file).size).toBe(sizeBefore);
      expect(await commitSeqOf(file)).toBe(commitBefore);
      expect(store.getLength()).toBe(SEED);
      expect(observed.applied).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it('writes one pop, not a rewritten group, for a result cut to its first rows', async () => {
    const file = path.join(directory(), 'cut.llxj');
    const { store, host, observed, dispose } = await openJournal(
      file,
      BIG_BYTES,
    );
    try {
      const sizeBefore = fs.statSync(file).size;
      const commitBefore = await commitSeqOf(file);

      await store.publishDetached(
        { transform: keepFirstThree },
        host,
        undefined,
        {},
      );

      expect(await commitSeqOf(file)).toBe((commitBefore ?? 0) + 1);
      expect(store.getLength()).toBe(3);
      // A pop copies no row: three rewritten rows would add at least 3 * BIG_BYTES.
      expect(fs.statSync(file).size - sizeBefore).toBeLessThan(BIG_BYTES / 2);
      expect(shape(await store.materialize())).toStrictEqual(
        shape(seedRows(BIG_BYTES).slice(0, 3)),
      );
      expect(last(observed.ranges)?.removedInterior).toStrictEqual([
        { start: 4, end: SEED, reason: 'rewound' },
      ]);
    } finally {
      await dispose();
    }
  });

  it('writes one clear for an emptied result', async () => {
    const file = path.join(directory(), 'empty.llxj');
    const { store, host, dispose } = await openJournal(file, BIG_BYTES);
    try {
      const sizeBefore = fs.statSync(file).size;
      const commitBefore = await commitSeqOf(file);

      await store.publishDetached(
        { transform: keepNothing },
        host,
        undefined,
        {},
      );

      expect(await commitSeqOf(file)).toBe((commitBefore ?? 0) + 1);
      expect(store.getLength()).toBe(0);
      expect(await store.materialize()).toStrictEqual([]);
      expect(fs.statSync(file).size - sizeBefore).toBeLessThan(BIG_BYTES / 2);
    } finally {
      await dispose();
    }
  });

  it('keeps the previous version published when the transform fails after two rows', async () => {
    const file = path.join(directory(), 'failure.llxj');
    const { store, host, stamper, observed, startTokens, dispose } =
      await openJournal(file);
    try {
      const commitBefore = await commitSeqOf(file);
      const chronologyBefore = stamper.snapshot();
      const boom = new Error('transform failed after two rows');
      const failing: DetachedHistoryTransform = async (_source, sink) => {
        await sink.appendValue(detachedRow(50, SEED_BYTES));
        await sink.appendValue(detachedRow(51, SEED_BYTES));
        throw boom;
      };

      await expect(
        store.publishDetached({ transform: failing }, host, undefined, {}),
      ).rejects.toBe(boom);

      expect(await commitSeqOf(file)).toBe(commitBefore);
      expect(shape(await store.materialize())).toStrictEqual(
        shape(seedRows(SEED_BYTES)),
      );
      expect(last(observed.applied)?.tokens).toBe(startTokens);
      expect(stamper.snapshot()).toStrictEqual(chronologyBefore);
      expect(store.getLength()).toBe(SEED);
      expect(observed.ranges).toStrictEqual([]);
      // The aborted group stays an uncommitted tail; a reader sees only the committed version.
      const reader = await openJournalReadOnly(file);
      try {
        expect(reader.trailer?.rootAggregate.rows).toBe(SEED);
      } finally {
        await reader.close();
      }
    } finally {
      await dispose();
    }
  });

  describe('with publishBatch', () => {
    async function readAll(source: HistoryBatchRowSource): Promise<IContent[]> {
      const rows: IContent[] = [];
      for await (const row of source.rows()) rows.push(row);
      return rows;
    }

    it('announces the replacement once, after its trailer is acked, with the committed rows', async () => {
      const file = path.join(directory(), 'batch-replace.llxj');
      const { store, host, observed, dispose } = await openJournal(file);
      try {
        const before = await commitSeqOf(file);
        await store.publishDetached(
          { transform: keepHeadThenReplace },
          host,
          undefined,
          { publishBatch: true },
        );
        const after = await commitSeqOf(file);
        if (after === undefined) throw new Error('Nothing was committed');

        expect(after).toBeGreaterThan(before ?? 0);
        expect(observed.batches).toHaveLength(1);
        const [batch] = observed.batches;
        expect(batch.ackedCommitSeq).toBe(after);
        expect(batch.source.length).toBe(5);
        const committed = shape(await store.materialize());
        expect(shape(await readAll(batch.source))).toStrictEqual(committed);
      } finally {
        await dispose();
      }
    });

    it('reads the rows of the announced version after later groups are published', async () => {
      const file = path.join(directory(), 'batch-pinned.llxj');
      const { store, host, observed, dispose } = await openJournal(file);
      try {
        await store.publishDetached(
          { transform: keepHeadThenReplace },
          host,
          undefined,
          { publishBatch: true },
        );
        const announced = shape(await store.materialize());
        store.apply({ kind: 'content', content: detachedRow(90, SEED_BYTES) });
        await store.waitForDurable();

        const [batch] = observed.batches;
        expect(shape(await readAll(batch.source))).toStrictEqual(announced);
        expect(shape(await readAll(batch.source))).toStrictEqual(announced);
      } finally {
        await dispose();
      }
    });

    it('announces only the appended rows in append mode, once, after the last ack', async () => {
      const file = path.join(directory(), 'batch-append.llxj');
      const { store, host, observed, dispose } = await openJournal(file);
      try {
        const appendTwo: DetachedHistoryTransform = async (_source, sink) => {
          await sink.appendValue(detachedRow(60, SEED_BYTES));
          await sink.appendValue(detachedRow(61, SEED_BYTES));
        };
        await store.publishDetached(
          { transform: appendTwo, append: true },
          host,
          undefined,
          { publishBatch: true },
        );
        const after = await commitSeqOf(file);
        if (after === undefined) throw new Error('Nothing was committed');

        expect(observed.batches).toHaveLength(1);
        const [batch] = observed.batches;
        expect(batch.ackedCommitSeq).toBe(after);
        expect(batch.source.length).toBe(2);
        const all = shape(await store.materialize());
        expect(shape(await readAll(batch.source))).toStrictEqual(all.slice(-2));
      } finally {
        await dispose();
      }
    });

    it('announces nothing when the transform fails', async () => {
      const file = path.join(directory(), 'batch-failure.llxj');
      const { store, host, observed, dispose } = await openJournal(file);
      try {
        const boom = new Error('transform failed after one row');
        const failing: DetachedHistoryTransform = async (_source, sink) => {
          await sink.appendValue(detachedRow(50, SEED_BYTES));
          throw boom;
        };
        await expect(
          store.publishDetached({ transform: failing }, host, undefined, {
            publishBatch: true,
          }),
        ).rejects.toBe(boom);
        expect(observed.batches).toHaveLength(0);
      } finally {
        await dispose();
      }
    });

    it('announces nothing when the publication is cancelled before its ack', async () => {
      const file = path.join(directory(), 'batch-cancelled.llxj');
      const { store, host, observed, dispose } = await openJournal(file);
      try {
        const controller = new AbortController();
        const cancelling: DetachedHistoryTransform = async (source, sink) => {
          for await (const row of source.streamRows()) {
            await sink.appendValue(row);
          }
          await sink.appendValue(detachedRow(70, SEED_BYTES));
          controller.abort(new Error('cancelled before the ack'));
        };
        await expect(
          store.publishDetached({ transform: cancelling }, host, undefined, {
            publishBatch: true,
            signal: controller.signal,
          }),
        ).rejects.toThrow('cancelled before the ack');
        expect(observed.batches).toHaveLength(0);
      } finally {
        await dispose();
      }
    });
  });
});
