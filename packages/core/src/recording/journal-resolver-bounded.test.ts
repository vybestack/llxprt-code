/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { JournalResolver, type SurvivorInterval } from './journalResolver.js';
import { replaySession } from './eager-replay.test.helpers.js';
import { createRowCounters } from './journalCounters.js';
import { writeRawJournal, buildContents } from './p05dTestKit.js';

let dir: string;

describe('bounded journal resolver', () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-bound-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  for (const count of [40, 4000]) {
    it(`streams ${count} uncompressed rows with bounded resident index and live counters`, async () => {
      const fixture = await writeRawJournal(dir, { rows: count });
      const meter = createRowCounters();
      const resolver = await JournalResolver.open(fixture.filePath, {
        counters: meter.counters,
      });
      let seen = 0;
      try {
        for await (const entry of resolver.resolve()) {
          expect(entry.content).toStrictEqual(fixture.contents[seen]);
          seen += 1;
        }
        expect(seen).toBe(count);
        expect(meter.snapshot().rowsDecoded).toBe(count);
        expect(meter.snapshot().recordsDecoded).toBeGreaterThan(count);
        expect(meter.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
        expect(resolver.metrics().residentIndexBufferBytes).toBeLessThanOrEqual(
          128,
        );
        expect(resolver.metrics().indexFileBytes).toBe(count * 96);
      } finally {
        await resolver.close();
      }
    });
  }

  it(
    'streams a large purge without materializing its array and balances cancellation',
    streamLargePurge,
  );

  it(
    'detects eager whole-history retention as a negative control',
    detectEagerRetention,
  );
  it(
    'uses the last duplicate purge history and handles UTF-8 split at one byte',
    readDuplicatePurge,
  );

  it(
    'releases private scratch files on close, cancellation and prepass failure',
    releaseScratchFiles,
  );
  it(
    'skips malformed blocks and purge elements without changing the survivor fold',
    skipMalformedRows,
  );
  it(
    'folds replacement, deletion, insertion and rewind inside purge rows on repeated reads',
    foldPurgeMutations,
  );

  it(
    'reports one purge interval when inserts split its fold order',
    reportSplitPurgeIntervals,
  );
  for (const count of [512, 8192])
    it(`streams ${count} discontiguous survivor intervals`, async () => {
      expect(await streamDiscontiguousIntervals(count)).toBe(count);
    });
});

async function streamDiscontiguousIntervals(count: number): Promise<number> {
  const filePath = path.join(dir, 'intervals.jsonl');
  const row = buildContents(1)[0];
  const expected: SurvivorInterval[] = [];
  const lines: string[] = [];
  let offset = 0;
  for (let index = 0; index < count * 2; index += 1) {
    const seq = index + 1;
    const content = index % 2 === 0;
    const line =
      JSON.stringify({
        v: 1,
        seq,
        type: content ? 'content' : 'unrecognized',
        payload: content ? { content: row } : {},
      }) + '\n';
    if (content)
      expected.push({
        fromSeq: seq,
        toSeq: seq,
        firstOffset: offset,
        rowCount: 1,
      });
    lines.push(line);
    offset += Buffer.byteLength(line);
  }
  await fs.writeFile(filePath, lines.join(''));
  const resolver = await JournalResolver.open(filePath, { scratchRoot: dir });
  let streamed = 0;
  try {
    expect(await resolver.countRows()).toBe(count);
    const stats = resolver.stats();
    expect(Array.isArray(stats.intervals)).toBe(false);
    const iterator = stats.intervals[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toStrictEqual(expected[0]);
    expect(first.done).toBe(false);
    expect(await hasDiskIntervals(dir, count)).toBe(true);
    await iterator.return?.();
    const actual: SurvivorInterval[] = [];
    for await (const interval of resolver.stats().intervals)
      actual.push(interval);
    expect(actual).toStrictEqual(expected);
    streamed = actual.length;
    expect(resolver.stats().resolvedRowCount).toBe(count);
    const paused = resolver.stats().intervals[Symbol.asyncIterator]();
    await paused.next();
    await resolver.close();
    expect(await hasDiskIntervals(dir, count)).toBe(false);
    await paused.return?.();
  } finally {
    await resolver.close();
  }
  expect(
    (await fs.readdir(dir)).some((name) => name.startsWith('llxprt-resolver-')),
  ).toBe(false);
  const checkpoint = await JournalResolver.open(filePath, {
    scratchRoot: dir,
    maxBytes: Buffer.byteLength(lines.slice(0, count).join('')),
  });
  try {
    const beforeCheckpoint: SurvivorInterval[] = [];
    for await (const interval of checkpoint.stats().intervals)
      beforeCheckpoint.push(interval);
    expect(beforeCheckpoint).toStrictEqual(expected.slice(0, count / 2));
  } finally {
    await checkpoint.close();
  }
  // A generator over a captured array has the same shape, but no backing index.
  const fakeStreaming = (async function* (): AsyncGenerator<SurvivorInterval> {
    for (const interval of expected) yield interval;
  })();
  expect(Array.isArray(fakeStreaming)).toBe(false);
  expect((await fakeStreaming.next()).value).toStrictEqual(expected[0]);
  expect(await hasDiskIntervals(dir, count)).toBe(false);
  await fakeStreaming.return(undefined);
  return streamed;
}

async function hasDiskIntervals(root: string, count: number): Promise<boolean> {
  const scratch = (await fs.readdir(root)).filter((name) =>
    name.startsWith('llxprt-resolver-'),
  );
  for (const name of scratch) {
    const size = await fs.stat(path.join(root, name, 'intervals')).then(
      (stat) => stat.size,
      () => 0,
    );
    if (size === count * 48) return true;
  }
  return false;
}

async function streamLargePurge(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 2 });
  const history = buildContents(4000);
  await fs.appendFile(
    fixture.filePath,
    JSON.stringify({
      v: 1,
      seq: 4,
      type: 'semantic_media_purge',
      payload: { history, frontier: { contentIndex: 0, blockIndex: 0 } },
    }) + '\n',
  );
  const meter = createRowCounters();
  let live = 0;
  const resolver = await JournalResolver.open(fixture.filePath, {
    counters: {
      recordDecoded: meter.counters.recordDecoded,
      rowDecoded: () => {
        live += 1;
        meter.counters.rowDecoded();
      },
      rowReleased: () => {
        live -= 1;
        meter.counters.rowReleased();
      },
    },
  });
  try {
    let seen = 0;
    for await (const entry of resolver.resolve()) {
      expect(entry.content).toStrictEqual(history[seen]);
      expect(live).toBe(1);
      expect(resolver.stats().resolvedRowCount).toBe(4000);
      seen += 1;
      if (seen === 5) break;
    }
    expect(live).toBe(0);
    expect(meter.snapshot().rowsDecoded).toBe(5);
    expect(meter.snapshot().peakDecodedRows).toBe(1);
  } finally {
    await resolver.close();
  }
}

async function detectEagerRetention(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 4000 });
  const meter = createRowCounters();
  await replaySession(fixture.filePath, 'p05d-project-hash', {
    counters: meter.counters,
  });
  expect(meter.snapshot().peakDecodedRows).toBeGreaterThanOrEqual(2000);
}

async function readDuplicatePurge(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 1 });
  const first = buildContents(3, 'discarded');
  const last = buildContents(2, 'é😀');
  await fs.appendFile(
    fixture.filePath,
    `{"v":1,"seq":3,"type":"semantic_media_purge","payload":{"history":${JSON.stringify(first)},"frontier":{"contentIndex":1,"blockIndex":0},"history":${JSON.stringify(last)}}}\n`,
  );
  const original = await fs.readFile(fixture.filePath);
  await fs.writeFile(
    fixture.filePath,
    Buffer.concat([Buffer.from('\uFEFF'), original]),
  );
  const resolver = await JournalResolver.open(fixture.filePath, {
    chunkBytes: 1,
  });
  try {
    const rows = [];
    for await (const entry of resolver.resolve()) rows.push(entry.content);
    expect(rows).toStrictEqual(last);
    expect(resolver.stats().skippedRecordCount).toBe(0);
  } finally {
    await resolver.close();
  }
}

async function releaseScratchFiles(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 3 });
  const resolver = await JournalResolver.open(fixture.filePath, {
    scratchRoot: dir,
  });
  for await (const entry of resolver.resolve()) {
    expect(entry.content).toStrictEqual(fixture.contents[0]);
    expect(
      (await fs.readdir(dir)).filter((name) =>
        name.startsWith('llxprt-resolver-'),
      ).length,
    ).toBe(1);
    break;
  }
  expect(
    (await fs.readdir(dir)).filter((name) =>
      name.startsWith('llxprt-resolver-'),
    ),
  ).toStrictEqual([]);
  await resolver.close();
  await fs.appendFile(fixture.filePath, '{"v":999}\n');
  const invalid = await JournalResolver.open(fixture.filePath, {
    scratchRoot: dir,
  });
  await expect(
    (async () => {
      for await (const entry of invalid.resolve()) void entry;
    })(),
  ).rejects.toThrow('Unsupported recording version');
  expect(
    (await fs.readdir(dir)).filter((name) =>
      name.startsWith('llxprt-resolver-'),
    ),
  ).toStrictEqual([]);
  await invalid.close();
}

async function skipMalformedRows(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 2 });
  for (const [seq, type, payload] of [
    [4, 'content', { content: { speaker: 'human', blocks: 2 } }],
    [
      5,
      'semantic_media_purge',
      { history: [1], frontier: { contentIndex: 0, blockIndex: 0 } },
    ],
    [6, 'content', { content: { speaker: 'human', blocks: { count: 2 } } }],
  ])
    await fs.appendFile(
      fixture.filePath,
      JSON.stringify({ v: 1, seq, type, payload }) + '\n',
    );
  const resolver = await JournalResolver.open(fixture.filePath);
  try {
    const rows = [];
    for await (const entry of resolver.resolve()) rows.push(entry.content);
    expect(rows).toStrictEqual(fixture.contents);
    expect(resolver.stats().skippedRecordCount).toBe(3);
  } finally {
    await resolver.close();
  }
}

async function foldPurgeMutations(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 0 });
  const marked = buildContents(5).map((row, index) => ({
    ...row,
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
    },
  }));
  const dense = { ...marked[2], blocks: [{ type: 'text', text: 'dense' }] };
  const events = [
    {
      type: 'semantic_media_purge',
      payload: {
        history: marked.slice(0, 3),
        frontier: { contentIndex: 0, blockIndex: 0 },
      },
    },
    {
      type: 'density_mutation',
      payload: {
        removedSeqs: [2, 3],
        replacements: [{ replacedSeq: 3, replacement: dense }],
      },
    },
    {
      type: 'synthetic_insert',
      payload: { content: marked[3], chronologySeq: 4, afterSeq: 1 },
    },
    { type: 'rewind', payload: { itemsRemoved: 1, cutSeq: 3 } },
    { type: 'content', payload: { content: marked[4] } },
  ];
  for (const [index, event] of events.entries())
    await fs.appendFile(
      fixture.filePath,
      JSON.stringify({ v: 1, seq: index + 2, ...event }) + '\n',
    );
  const meter = createRowCounters();
  const resolver = await JournalResolver.open(fixture.filePath, {
    counters: meter.counters,
  });
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const rows = [];
      for await (const entry of resolver.resolve()) rows.push(entry.content);
      expect(rows).toStrictEqual([marked[0], marked[3], marked[4]]);
      expect(resolver.stats().skippedRecordCount).toBe(0);
    }
    expect(meter.snapshot().rowsDecoded).toBe(6);
    expect(meter.snapshot().peakDecodedRows).toBe(1);
  } finally {
    await resolver.close();
  }
}

async function reportSplitPurgeIntervals(): Promise<void> {
  const fixture = await writeRawJournal(dir, { rows: 0 });
  const history = buildContents(2).map((row, index) => ({
    ...row,
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: 1, recordedAt: 0 },
    },
  }));
  const events = [
    {
      type: 'semantic_media_purge',
      payload: { history, frontier: { contentIndex: 0, blockIndex: 0 } },
    },
    {
      type: 'synthetic_insert',
      payload: {
        content: buildContents(1)[0],
        chronologySeq: 3,
        afterSeq: 1,
      },
    },
  ];
  for (const [index, event] of events.entries())
    await fs.appendFile(
      fixture.filePath,
      JSON.stringify({ v: 1, seq: index + 2, ...event }) + '\n',
    );
  const resolver = await JournalResolver.open(fixture.filePath);
  try {
    let count = 0;
    for await (const entry of resolver.resolve()) {
      expect(entry.content.speaker).toBeDefined();
      count += 1;
    }
    expect(count).toBe(3);
    const intervals = [];
    for await (const { fromSeq, toSeq, rowCount } of resolver.stats().intervals)
      intervals.push({ fromSeq, toSeq, rowCount });
    expect(intervals).toStrictEqual([
      { fromSeq: 2, toSeq: 2, rowCount: 2 },
      { fromSeq: 3, toSeq: 3, rowCount: 1 },
    ]);
  } finally {
    await resolver.close();
  }
}
