/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { journalPathOf } from './__tests__/support/journalPathOf.js';
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { MIB } from '../../journal/__tests__/support/streamedBody.js';
import type { IContent } from './IContent.js';
import { pulledRows } from './journalDetachedStream.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(seq: number, text = `r${seq}`): IContent {
  return {
    speaker: seq % 2 === 0 ? 'ai' : 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function texts(contents: readonly IContent[]): string[] {
  return contents.map((content) =>
    content.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
  );
}

const OLD = [row(1, 'old one'), row(2, 'old two')];
const RETAINED_BOUND = 4 * MIB;

describe('a transform streamed into one replace group', () => {
  const directory = useTempDir('journal-history-streamed-');

  async function withOld(name: string): Promise<JournalHistoryStore> {
    const store = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), name)),
    );
    for (const content of OLD) store.apply({ kind: 'content', content });
    await store.waitForDurable();
    return store;
  }

  it('publishes the rows the producer pushes, with the same result as replaceFrom over the same rows', async () => {
    const next = [row(3), row(4), row(5), row(6)];
    const viaArray = await withOld('array.llxj');
    await viaArray.replaceFrom(next, next.length);
    const streamed = await withOld('streamed.llxj');

    const ack = await streamed.replaceStreamed(
      pulledRows<IContent>(async (put) => {
        for (const content of next) await put(content);
      }),
    );

    expect(ack.commitSeq).toBe(viaArray.lastAck?.commitSeq ?? -1);
    expect(streamed.getLength()).toBe(next.length);
    expect(await streamed.materialize()).toStrictEqual(
      await viaArray.materialize(),
    );
    expect(texts(await streamed.materialize())).toStrictEqual([
      'r3',
      'r4',
      'r5',
      'r6',
    ]);
    await viaArray.dispose();
    await streamed.dispose();
  });

  it('a failure in the middle of the stream propagates and leaves the previous version published', async () => {
    const store = await withOld('failure.llxj');
    const boom = new Error('transform failed on row 3');

    await expect(
      store.replaceStreamed(
        pulledRows<IContent>(async (put) => {
          await put(row(10));
          await put(row(11));
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);

    const reader = await openJournalReadOnly(journalPathOf(store));
    try {
      expect(reader.trailer?.commitSeq).toBe(2);
      expect(reader.trailer?.rootAggregate.rows).toBe(2);
    } finally {
      await reader.close();
    }
    await expect(store.waitForDurable()).rejects.toBe(boom);
    await store.dispose();
  });

  it('a transform that fails before its first row leaves the previous version and the failure on the store', async () => {
    const store = await withOld('first.llxj');
    const boom = new Error('transform failed at once');
    await expect(
      store.replaceStreamed(
        pulledRows<IContent>(() => {
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);
    const reader = await openJournalReadOnly(journalPathOf(store));
    try {
      expect(reader.trailer?.rootAggregate.rows).toBe(2);
    } finally {
      await reader.close();
    }
    await store.dispose();
  });
});

describe('the transform cannot run ahead of the writer', () => {
  const directory = useTempDir('journal-history-streamed-heap-');
  const ROWS = 40;
  const ROW_BYTES = 4 * MIB;

  /** The largest number of rows the producer had made that the writer had not yet finished. */
  function leadGauge() {
    const state = { made: 0, written: 0, maxLead: 0 };
    return {
      state,
      made(): void {
        state.made++;
        state.maxLead = Math.max(state.maxLead, state.made - state.written);
      },
    };
  }

  function bigRow(seq: number): IContent {
    return row(seq, String.fromCharCode(97 + (seq % 26)).repeat(ROW_BYTES));
  }

  async function* counted(
    rows: AsyncIterable<IContent>,
    gauge: ReturnType<typeof leadGauge>,
  ): AsyncGenerator<IContent> {
    for await (const content of rows) {
      yield content;
      gauge.state.written++;
    }
  }

  it('holds one row at most between the transform and the writer, and nothing after', async () => {
    const store = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), 'bounded.llxj')),
    );
    const gauge = leadGauge();
    const baseline = await settledHeap();

    await store.replaceStreamed(
      counted(
        pulledRows<IContent>(async (put) => {
          for (let seq = 1; seq <= ROWS; seq++) {
            const content = bigRow(seq);
            gauge.made();
            await put(content);
          }
        }),
        gauge,
      ),
    );
    const after = await settledHeap();

    expect(gauge.state.written).toBe(ROWS);
    expect(gauge.state.maxLead).toBe(1);
    expect(store.getLength()).toBe(ROWS);
    expect(after - baseline).toBeLessThan(RETAINED_BOUND);
    await store.dispose();
  });

  it('control: a channel that buffers what the transform makes shows the lead and the retained rows', async () => {
    const store = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), 'control.llxj')),
    );
    const gauge = leadGauge();
    const baseline = await settledHeap();
    const buffer: IContent[] = [];
    for (let seq = 1; seq <= ROWS; seq++) {
      buffer.push(bigRow(seq));
      gauge.made();
    }
    async function* drained(): AsyncGenerator<IContent> {
      for (const content of buffer) yield content;
    }

    await store.replaceStreamed(counted(drained(), gauge));
    const withBuffer = await settledHeap();

    expect(buffer).toHaveLength(ROWS);
    expect(gauge.state.maxLead).toBe(ROWS);
    expect(withBuffer - baseline).toBeGreaterThan(ROWS * ROW_BYTES * 0.5);
    await store.dispose();
  });
});
