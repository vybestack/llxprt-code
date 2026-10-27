/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { medianSettledDelta } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalSession } from './journalSession.js';
import {
  decodeTranscriptHead,
  TRANSCRIPT_HEAD_KEY,
} from '../../journal/transcript-head.js';
import { transcriptEntries } from '../../journal/transcript-tree.js';

const MIB = 1024 * 1024;
const ROW_BYTES = 70 * MIB;

async function seed(history: HistoryService): Promise<string> {
  await history.addBatch([
    { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
  ]);
  const text = 'x'.repeat(ROW_BYTES - 4) + 'last';
  const digest = createHash('sha256').update(text).digest('hex');
  await history.addBatch([{ speaker: 'ai', blocks: [{ type: 'text', text }] }]);
  await history.waitForCommit();
  return digest;
}

async function consumeLarge(
  stream: AsyncGenerator<IContent, void, unknown>,
): Promise<string> {
  const next = await stream.next();
  if (next.done === true) throw new Error('Pinned large row was lost');
  const block = next.value.blocks[0];
  if (block.type !== 'text') throw new Error('Expected text');
  expect(Buffer.byteLength(block.text)).toBe(ROW_BYTES);
  expect(block.text.slice(-4)).toBe('last');
  return createHash('sha256').update(block.text).digest('hex');
}

async function exercisePin(
  history: HistoryService,
  stream: AsyncGenerator<IContent, void, unknown>,
  reader: RowOwnership,
  counters: ReturnType<typeof createRowCounters>,
): Promise<void> {
  const expected = await seed(history);
  const session: unknown = Reflect.get(
    history.detachedValues.host().journal,
    'session',
  );
  if (!(session instanceof JournalSession)) throw new Error('Expected journal');
  const store = session.store;
  const first = await stream.next();
  expect(first.value).toMatchObject({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'first' }],
  });
  const before = store.published;
  await history.clear();
  await history.waitForCommit();
  await store.idle();
  expect(history.length()).toBe(0);
  expect(store.published?.durableEnd).toBeGreaterThan(ROW_BYTES);
  expect(store.published?.selfOffset).toBeGreaterThan(before?.selfOffset ?? 0);
  await expect(store.compact()).rejects.toThrow('live pin');
  expect(await consumeLarge(stream)).toBe(expected);
  expect((await stream.next()).done).toBe(true);
  await store.idle();
  expect(await store.compact()).toBe('swapped');
  const head = decodeTranscriptHead(await store.getState(TRANSCRIPT_HEAD_KEY));
  expect(head.count).toBe(3);
  const read = await store.openRead();
  try {
    const entries = [];
    for await (const entry of transcriptEntries(
      read.access,
      head.root,
      'transcript',
      1n,
      false,
    ))
      entries.push(entry);
    expect(entries.map((entry) => entry.audience)).toStrictEqual([0, 0, 2]);
    expect(entries[1].recordLength).toBeGreaterThan(ROW_BYTES);
    expect(entries[2].rowRef).toBe(0);
  } finally {
    await read.close();
  }
  const retainedBytes = store.published?.durableEnd;
  if (retainedBytes === undefined) throw new Error('Missing compacted version');
  expect(retainedBytes).toBeGreaterThan(ROW_BYTES);
  expect(retainedBytes - ROW_BYTES).toBeLessThan(MIB);
  expect(store.published?.rows).toBe(0);
  expect(counters.snapshot().peakDecodedRows).toBe(1);
  expect(reader.snapshot().liveRows).toBe(0);
}

describe('service send pin defers real compaction', () => {
  it('finishes the original 70 MiB row after clear, then compacts and retains no decoded row', async () => {
    const histories: HistoryService[] = [];
    const completed: Array<AsyncGenerator<IContent, void, unknown>> = [];
    try {
      const retained = await medianSettledDelta(async () => {
        const reader = new RowOwnership();
        const counters = createRowCounters();
        const history = new HistoryService({
          attachmentCounters: { ...counters.counters, ownership: reader },
        });
        histories.push(history);
        history.setTokenizerFactory(exactTokenizer());
        const stream = history.streamCuratedHistory();
        completed.push(stream);
        try {
          await exercisePin(history, stream, reader, counters);
        } finally {
          await stream.return();
        }
      });
      expect(retained).toBeLessThan(MIB);
    } finally {
      for (const stream of completed) await stream.return();
      for (const history of histories) await history.dispose();
    }
  }, 180_000);
});
