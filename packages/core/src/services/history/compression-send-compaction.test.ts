import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { medianSettledDelta } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
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
const COMPACTION_CALIBRATION_BYTES = 256;
const COMPACTION_ROW_BYTES = 32_768;
const COMPACTION_ROW_COUNT = 128;
// Maximum median from two complete 256-byte lifecycle calibrations.
const COMPACTION_FIXED_OVERHEAD_BYTES = 512_570;
// UTF-16 decoding plus a serialized row and the compaction read chunk.
const COMPACTION_ENCODING_FACTOR = 4;

function compactionAllowance(bytes: number): number {
  const row: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'x'.repeat(bytes - 4) + 'last' }],
  };
  return Math.min(
    RETAINED_BOUND,
    COMPACTION_FIXED_OVERHEAD_BYTES +
      COMPACTION_ENCODING_FACTOR * Buffer.byteLength(JSON.stringify(row)),
  );
}

async function seed(
  history: HistoryService,
  bytes: number,
  rows: number,
): Promise<string> {
  await history.addBatch([
    { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
  ]);
  const hash = createHash('sha256');
  for (let index = 0; index < rows; index++) {
    const text = 'x'.repeat(bytes - 4) + 'last';
    hash.update(text);
    await history.addBatch([
      { speaker: 'ai', blocks: [{ type: 'text', text }] },
    ]);
  }
  await history.waitForCommit();
  return hash.digest('hex');
}

async function consumeLarge(
  stream: AsyncGenerator<IContent, void, unknown>,
  bytes: number,
  retained: IContent[] | undefined,
  rows: number,
): Promise<string> {
  const hash = createHash('sha256');
  for (let index = 0; index < rows; index++) {
    const next = await stream.next();
    if (next.done === true) throw new Error('Pinned large row was lost');
    retained?.push(next.value);
    const block = next.value.blocks[0];
    if (block.type !== 'text') throw new Error('Expected text');
    expect(Buffer.byteLength(block.text)).toBe(bytes);
    expect(block.text.slice(-4)).toBe('last');
    hash.update(block.text);
  }
  return hash.digest('hex');
}

async function exercisePin(
  history: HistoryService,
  stream: AsyncGenerator<IContent, void, unknown>,
  reader: RowOwnership,
  counters: ReturnType<typeof createRowCounters>,
  bytes: number,
  retained: IContent[] | undefined,
  rows = 1,
): Promise<void> {
  const expected = await seed(history, bytes, rows);
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
  expect(await consumeLarge(stream, bytes, retained, rows)).toBe(expected);
  expect((await stream.next()).done).toBe(true);
  await store.idle();
  expect(await store.compact()).toBe('swapped');
  const head = decodeTranscriptHead(await store.getState(TRANSCRIPT_HEAD_KEY));
  expect(head.count).toBe(rows + 2);
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
    expect(entries.map((entry) => entry.audience)).toStrictEqual([
      ...Array.from({ length: rows + 1 }, () => 0),
      2,
    ]);
    for (let index = 1; index <= rows; index++)
      expect(entries[index].recordLength).toBeGreaterThan(bytes);
    expect(entries[rows + 1].rowRef).toBe(0);
  } finally {
    await read.close();
  }
  const retainedBytes = store.published?.durableEnd;
  if (retainedBytes === undefined) throw new Error('Missing compacted version');
  expect(retainedBytes).toBeGreaterThan(bytes);
  expect(retainedBytes - rows * bytes).toBeLessThan(MIB);
  expect(store.published?.rows).toBe(0);
  expect(counters.snapshot().peakDecodedRows).toBe(1);
  expect(reader.snapshot().liveRows).toBe(0);
}

describe('service send pin defers real compaction', () => {
  it.each([
    { bytes: COMPACTION_CALIBRATION_BYTES, rows: 1 },
    { bytes: 128_000, rows: 1 },
    { bytes: 1_000_000, rows: 1 },
    { bytes: COMPACTION_ROW_BYTES, rows: COMPACTION_ROW_COUNT },
  ])(
    'finishes the original model output after clear, then compacts and retains no decoded row: %j',
    async ({ bytes, rows }) => {
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
            await exercisePin(
              history,
              stream,
              reader,
              counters,
              bytes,
              undefined,
              rows,
            );
          } finally {
            await stream.return();
          }
        });
        const evidence = process.env['H3_ALLOWANCE_EVIDENCE'];
        if (evidence !== undefined)
          appendFileSync(
            evidence,
            `${JSON.stringify({ suite: 'compaction', bytes, rows, retained })}
`,
          );
        const allowance = compactionAllowance(bytes);
        // Cold calibration varied beyond its formula; preserve the original
        // ceiling there without widening the many-row discrimination bound.
        expect(retained).toBeLessThan(
          bytes === COMPACTION_CALIBRATION_BYTES ? RETAINED_BOUND : allowance,
        );
        expect(rows === 1 || rows * bytes >= 4 * allowance).toBe(true);
      } finally {
        for (const stream of completed) await stream.return();
        for (const history of histories) await history.dispose();
      }
    },
    180_000,
  );

  it.each([
    { bytes: 1_000_000, rows: 1 },
    { bytes: COMPACTION_ROW_BYTES, rows: COMPACTION_ROW_COUNT },
  ])(
    'control: retaining model output exceeds the same heap bound: %j',
    async ({ bytes, rows }) => {
      const held: IContent[] = [];
      const retained = await medianSettledDelta(async () => {
        for (let index = 0; index < 4; index++) {
          const reader = new RowOwnership();
          const counters = createRowCounters();
          const history = new HistoryService({
            scratchRoots: historyScratchRoots,
            attachmentCounters: { ...counters.counters, ownership: reader },
          });
          history.setTokenizerFactory(exactTokenizer());
          const stream = history.streamCuratedHistory();
          try {
            await exercisePin(
              history,
              stream,
              reader,
              counters,
              bytes,
              held,
              rows,
            );
          } finally {
            await stream.return();
            await history.dispose();
          }
        }
      });
      const evidence = process.env['H3_ALLOWANCE_EVIDENCE'];
      if (evidence !== undefined)
        appendFileSync(
          evidence,
          `${JSON.stringify({ suite: 'compaction', bytes, rows, retain: true, retained })}
`,
        );
      expect(held.length).toBeGreaterThan(0);
      expect(retained).toBeGreaterThan(RETAINED_BOUND);
      expect(retained).toBeGreaterThan(3 * compactionAllowance(bytes));
    },
    180_000,
  );
});
