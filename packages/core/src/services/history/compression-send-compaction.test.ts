import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
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
const historyScratchRoots = createTestScratchOwner();

const MIB = 1024 * 1024;
const RETAINED_BOUND = MIB;

async function seed(history: HistoryService, bytes: number): Promise<string> {
  await history.addBatch([
    { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
  ]);
  const text = 'x'.repeat(bytes - 4) + 'last';
  const digest = createHash('sha256').update(text).digest('hex');
  await history.addBatch([{ speaker: 'ai', blocks: [{ type: 'text', text }] }]);
  await history.waitForCommit();
  return digest;
}

async function consumeLarge(
  stream: AsyncGenerator<IContent, void, unknown>,
  bytes: number,
  retained: IContent[],
): Promise<string> {
  const next = await stream.next();
  if (next.done === true) throw new Error('Pinned large row was lost');
  retained.push(next.value);
  const block = next.value.blocks[0];
  if (block.type !== 'text') throw new Error('Expected text');
  expect(Buffer.byteLength(block.text)).toBe(bytes);
  expect(block.text.slice(-4)).toBe('last');
  return createHash('sha256').update(block.text).digest('hex');
}

async function exercisePin(
  history: HistoryService,
  stream: AsyncGenerator<IContent, void, unknown>,
  reader: RowOwnership,
  counters: ReturnType<typeof createRowCounters>,
  bytes: number,
  retained: IContent[],
): Promise<void> {
  const expected = await seed(history, bytes);
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
  expect(store.published?.durableEnd).toBeGreaterThan(bytes);
  expect(store.published?.selfOffset).toBeGreaterThan(before?.selfOffset ?? 0);
  await expect(store.compact()).rejects.toThrow('live pin');
  expect(await consumeLarge(stream, bytes, retained)).toBe(expected);
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
    expect(entries[1].recordLength).toBeGreaterThan(bytes);
    expect(entries[2].rowRef).toBe(0);
  } finally {
    await read.close();
  }
  const retainedBytes = store.published?.durableEnd;
  if (retainedBytes === undefined) throw new Error('Missing compacted version');
  expect(retainedBytes).toBeGreaterThan(bytes);
  expect(retainedBytes - bytes).toBeLessThan(MIB);
  expect(store.published?.rows).toBe(0);
  expect(counters.snapshot().peakDecodedRows).toBe(1);
  expect(reader.snapshot().liveRows).toBe(0);
}

describe('service send pin defers real compaction', () => {
  it.each([128_000, 1_000_000])(
    'finishes the original %i-byte model output after clear, then compacts and retains no decoded row',
    async (bytes) => {
      const histories: HistoryService[] = [];
      const completed: Array<AsyncGenerator<IContent, void, unknown>> = [];
      try {
        const retained = await medianSettledDelta(async () => {
          const reader = new RowOwnership();
          const counters = createRowCounters();
          const history = new HistoryService({
            scratchRoots: historyScratchRoots,
            attachmentCounters: { ...counters.counters, ownership: reader },
          });
          histories.push(history);
          history.setTokenizerFactory(exactTokenizer());
          const stream = history.streamCuratedHistory();
          completed.push(stream);
          try {
            await exercisePin(history, stream, reader, counters, bytes, []);
          } finally {
            await stream.return();
          }
        });
        expect(retained).toBeLessThan(RETAINED_BOUND);
      } finally {
        for (const stream of completed) await stream.return();
        for (const history of histories) await history.dispose();
      }
    },
    180_000,
  );

  it('control: retaining a realistic model output exceeds the same heap bound', async () => {
    const held: IContent[] = [];
    const retained = await medianSettledDelta(async () => {
      for (let index = 0; index < 2; index++) {
        const reader = new RowOwnership();
        const counters = createRowCounters();
        const history = new HistoryService({
          scratchRoots: historyScratchRoots,
          attachmentCounters: { ...counters.counters, ownership: reader },
        });
        history.setTokenizerFactory(exactTokenizer());
        const stream = history.streamCuratedHistory();
        try {
          await exercisePin(history, stream, reader, counters, 1_000_000, held);
        } finally {
          await stream.return();
          await history.dispose();
        }
      }
    });
    expect(held.length).toBeGreaterThan(0);
    expect(retained).toBeGreaterThan(RETAINED_BOUND);
  }, 180_000);
});
