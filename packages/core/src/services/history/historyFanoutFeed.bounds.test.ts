/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryFanoutFeed } from './historyFanoutFeed.js';
import {
  scanJournalRecords,
  type JournalRecordScan,
} from './historyJournalRecordScan.js';
import { HistoryRecorderFanout } from './historyRecorderFanout.js';
import type { IContent } from './IContent.js';

const BATCHES = 50;
const ROWS_PER_BATCH = 10;

let dir: string;
const recorders: SessionRecordingService[] = [];
let counter = 0;

function recorder(id: string): SessionRecordingService {
  const created = new SessionRecordingService({
    sessionId: `bounds-${id}-${counter++}`,
    projectHash: 'bounds',
    chatsDir: dir,
    workspaceDirs: [dir],
    provider: 'test',
    model: 'test',
  });
  recorders.push(created);
  return created;
}

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function enqueueRow(
  primary: SessionRecordingService,
  text: string,
  origin: string,
): number {
  const line = primary.enqueue('content', { content: row(text), origin });
  if (line === null) throw new Error('primary refused a record');
  return line.seq;
}

/** Rows of a batch plus one rewind of its last row, so the pump must translate. */
function enqueueBatch(primary: SessionRecordingService, batch: number): number {
  for (let index = 0; index < ROWS_PER_BATCH - 1; index++)
    enqueueRow(primary, `b${batch}-r${index}`, batch % 2 === 0 ? 'A' : 'B');
  const line = primary.enqueue('rewind', { itemsRemoved: 1 });
  if (line === null) throw new Error('primary refused a rewind');
  return line.seq;
}

function batchOfRow(record: { payload: unknown }): number | undefined {
  const content = (record.payload as { content?: IContent }).content;
  const block = content?.blocks[0];
  if (block?.type !== 'text') return undefined;
  const match = /^b(\d+)-r\d+$/.exec(block.text);
  return match === null ? undefined : Number(match[1]);
}

describe('history fan-out pump memory and read bounds', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fanout-bounds-'));
  });

  afterEach(async () => {
    for (const created of recorders.splice(0)) await created.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  async function fixture(scan: JournalRecordScan) {
    const fanout = new HistoryRecorderFanout();
    const feed = new HistoryFanoutFeed(fanout, scan);
    const primary = recorder('primary');
    const mirrors = { A: recorder('mirror-a'), B: recorder('mirror-b') };
    fanout.bind('A', mirrors.A);
    fanout.bind('B', mirrors.B);
    fanout.active = true;
    const seed = enqueueRow(primary, 'seed', 'A');
    await primary.waitForCommitSequence(seed);
    const path = primary.getFilePath();
    if (path === null) throw new Error('primary was not materialized');
    const seedBytes = (await stat(path)).size;
    feed.reset(primary, seedBytes);
    return { feed, primary, path, seedBytes, mirrors };
  }

  async function runBatch(
    context: Awaited<ReturnType<typeof fixture>>,
    batch: number,
  ): Promise<void> {
    const seq = enqueueBatch(context.primary, batch);
    await context.primary.waitForCommitSequence(seq);
    context.feed.schedule(context.primary, seq, 'deliver');
    await context.feed.settle();
    await context.mirrors.A.flush();
    await context.mirrors.B.flush();
  }

  it('reads only the journal bytes a batch appended, however long the history is', async () => {
    let scannedBytes = 0;
    let scannedRecords = 0;
    const countingScan: JournalRecordScan = async function* (path, start, end) {
      for await (const record of scanJournalRecords(path, start, end)) {
        scannedBytes += record.end - record.start;
        scannedRecords++;
        yield record;
      }
    };
    const context = await fixture(countingScan);
    const perBatch: Array<{ scanned: number; appended: number; rows: number }> =
      [];
    let previousSize = context.seedBytes;
    for (let batch = 0; batch < BATCHES; batch++) {
      scannedBytes = 0;
      scannedRecords = 0;
      await runBatch(context, batch);
      const size = (await stat(context.path)).size;
      perBatch.push({
        scanned: scannedBytes,
        appended: size - previousSize,
        rows: scannedRecords,
      });
      previousSize = size;
    }
    // The first batch also folds the seed row the pump was pointed past.
    expect(perBatch[0].scanned).toBe(context.seedBytes + perBatch[0].appended);
    for (const entry of perBatch.slice(1)) {
      expect(entry.scanned).toBe(entry.appended);
      expect(entry.rows).toBe(ROWS_PER_BATCH);
    }
  }, 120_000);

  it('retains no row of an earlier batch while a later batch is pumped', async () => {
    const seen: Array<{ batch: number; ref: WeakRef<object> }> = [];
    let current = 0;
    const retained: number[] = [];
    const watchingScan: JournalRecordScan = async function* (path, start, end) {
      for await (const record of scanJournalRecords(path, start, end)) {
        const batch = batchOfRow(record);
        const content = (record.payload as { content?: object }).content;
        if (batch !== undefined && content !== undefined)
          seen.push({ batch, ref: new WeakRef(content) });
        yield record;
      }
      // The consumer is suspended here with whatever it holds for the batch.
      // The recorders a batch was delivered to may still reference its last
      // rows, so only rows older than the previous batch must be gone.
      let alive = 0;
      for (const entry of seen.filter((item) => item.batch < current - 1)) {
        if (await collectedWithin(entry.ref))
          seen.splice(seen.indexOf(entry), 1);
        else {
          alive++;
          break;
        }
      }
      retained.push(alive);
    };
    const context = await fixture(watchingScan);
    for (current = 0; current < BATCHES / 2; current++)
      await runBatch(context, current);
    expect(retained.length).toBeGreaterThan(0);
    expect(Math.max(...retained)).toBe(0);
  }, 120_000);
});
