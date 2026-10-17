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
  rowsNotified: IContent[];
}

interface JournalFixture {
  readonly store: JournalHistoryStore;
  readonly host: DetachedHistoryHost;
  readonly stamper: ChronologyStamper;
  readonly observed: Observed;
  readonly startTokens: number;
  readonly dispose: () => Promise<void>;
}

/** A detached host over a journal store seeded like the old store, with the estimate of a real HistoryService. */
async function openJournal(
  file: string,
  bytes = SEED_BYTES,
): Promise<JournalFixture> {
  const store = new JournalHistoryStore(await JournalSession.create(file));
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
  const observed: Observed = { applied: [], ranges: [], rowsNotified: [] };
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
    notifyRow: (row) => {
      observed.rowsNotified.push(row);
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
});
