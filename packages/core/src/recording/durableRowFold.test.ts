/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';
import { field } from './resolverProjection.js';
import type { SessionEventType, SessionRecordLine } from './types.js';
import { foldDurableRows, type DurableRowFold } from './durableRowFold.js';

function fixture<T>(
  action: (root: string, file: string) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-row-fold-test-'));
  const file = path.join(root, 'journal.jsonl');
  return action(root, file).finally(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
}
function line(type: string, payload: unknown, seq: number): string {
  return (
    JSON.stringify({ v: 2, seq, ts: '2026-09-24T00:00:00Z', type, payload }) +
    '\n'
  );
}
function content(id: number, seq = id): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${id}` }],
    metadata: {
      chronology: { seq, userTurn: seq, step: 0, recordedAt: seq },
      id: `meta-${id}`,
    },
  };
}
function aiContent(id: number, seq = id): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: `response-${id}` }],
    metadata: {
      chronology: { seq, userTurn: seq, step: 1, recordedAt: seq },
      id: `response-${id}`,
      responsesStored: true,
    },
  };
}
function enqueue(
  recording: SessionRecordingService,
  type: SessionEventType,
  payload: unknown,
): SessionRecordLine {
  const record = recording.enqueue(type, payload);
  if (record === null) throw new Error(`Failed to enqueue ${type}`);
  return record;
}
function writeHistory(file: string, count: number): number {
  const fd = fs.openSync(file, 'w');
  let bytes = 0;
  try {
    for (let index = 0; index < count; index += 1)
      bytes += fs.writeSync(
        fd,
        line('content', { content: content(index) }, index),
      );
    bytes += fs.writeSync(
      fd,
      line('rewind', { itemsRemoved: 9, cutSeq: count - 12 }, count),
    );
    for (let index = 0; index < 4; index += 1)
      bytes += fs.writeSync(
        fd,
        line('content', { content: content(count + index) }, count + index + 1),
      );
    bytes += fs.writeSync(
      fd,
      line('rewind', { itemsRemoved: 2, cutSeq: count + 200 }, count + 5),
    );
    const pinned = bytes;
    fs.writeSync(fd, line('content', { content: content(999999) }, count + 6));
    return pinned;
  } finally {
    fs.closeSync(fd);
  }
}
function isContent(value: unknown): value is IContent {
  const speaker = field(value, 'speaker');
  return (
    (speaker === 'human' || speaker === 'ai' || speaker === 'tool') &&
    Array.isArray(field(value, 'blocks'))
  );
}
function eagerOracle(file: string, pinned: number): IContent[] {
  const rows: IContent[] = [];
  const text = fs.readFileSync(file, 'utf8').slice(0, pinned);
  for (const raw of text.trimEnd().split('\n')) {
    const record: unknown = JSON.parse(raw);
    const type = field(record, 'type');
    const payload = field(record, 'payload');
    if (type === 'content') {
      const row = field(payload, 'content');
      if (!isContent(row)) throw new Error('Invalid fixture');
      rows.push(row);
    } else if (type === 'rewind') {
      const cut = field(payload, 'cutSeq');
      const at = rows.findIndex((row) => row.metadata?.chronology?.seq === cut);
      const removed = field(payload, 'itemsRemoved');
      if (typeof removed !== 'number') throw new Error('Invalid fixture');
      rows.length = at === -1 ? Math.max(0, rows.length - removed) : at;
    }
  }
  return rows;
}
async function assertParity(
  root: string,
  file: string,
  pinned: number,
): Promise<number> {
  const expected = eagerOracle(file, pinned);
  const original = HistoryJournalStore.prototype.materialize;
  HistoryJournalStore.prototype.materialize = () => {
    throw new Error('materialize trap');
  };
  const readTrap = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('readFileSync trap');
  });
  try {
    expect(() => fs.readFileSync(file)).toThrow('readFileSync trap');
    expect(() => new HistoryJournalStore().materialize()).toThrow(
      'materialize trap',
    );
    const folded = await foldDurableRows({
      filePath: file,
      maxBytes: pinned,
      scratchRoot: root,
      chunkBytes: 512,
    });
    try {
      expect(folded.length).toBe(expected.length);
      expect(folded.metrics().residentBufferBytes).toBe(64);
      expect(folded.metrics().fileBytes).toBe(expected.length * 64);
      // The same accounting detects the deliberately materializing control.
      expect(expected.length * 64 > folded.metrics().residentBufferBytes).toBe(
        true,
      );
      for (let index = 0; index < expected.length; index += 1) {
        expect(folded.rowAt(index).source).toBe('durable');
        expect(await folded.readRow(index)).toStrictEqual(expected[index]);
      }
    } finally {
      await folded.close();
    }
  } finally {
    readTrap.mockRestore();
    HistoryJournalStore.prototype.materialize = original;
  }
  expect(fs.readdirSync(root)).toStrictEqual(['journal.jsonl']);
  return expected.length;
}

interface CommittedParityCase {
  readonly recording: SessionRecordingService;
  readonly file: string;
  readonly scratch: string;
  readonly purge: readonly IContent[];
  readonly expected: readonly IContent[];
  readonly maxBytes: number;
}

function purgeRows(count: number): IContent[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 9) return aiContent(index);
    const seq = index === 8 ? 7 : index;
    return content(index, seq);
  });
}

function enqueueCommittedMutations(
  recording: SessionRecordingService,
  count: number,
  purge: readonly IContent[],
): SessionRecordLine {
  enqueue(recording, 'content', { content: content(900_000) });
  enqueue(recording, 'semantic_media_purge', {
    history: purge,
    frontier: { contentIndex: 0, blockIndex: 0 },
  });
  enqueue(recording, 'chronology_bind', {
    rowIndex: 9,
    chronology: {
      seq: count + 100,
      userTurn: 77,
      step: 3,
      recordedAt: 123_456,
    },
    invalidateResponses: true,
  });
  enqueue(recording, 'chronology_bind', {
    rowIndex: 10,
    chronology: {
      seq: count + 103,
      userTurn: 78,
      step: 4,
      recordedAt: 123_457,
    },
    content: aiContent(600_010, 5),
  });
  enqueue(recording, 'synthetic_insert', {
    content: content(800_000, count + 101),
    chronologySeq: count + 500,
    afterSeq: 1,
  });
  enqueue(recording, 'synthetic_insert', {
    content: content(800_001, count + 102),
    chronologySeq: count + 102,
    afterSeq: count + 999,
  });
  enqueue(recording, 'density_mutation', {
    removedSeqs: [3, 7],
    replacements: [
      { replacedSeq: 4, replacement: content(700_004, 4) },
      {
        replacedSeq: count + 101,
        replacement: content(700_101, count + 101),
      },
      {
        replacedSeq: count + 103,
        replacement: content(700_103, count + 104),
      },
      { replacedSeq: 7, replacement: content(700_006, count + 199) },
      {
        replacedSeq: 7,
        replacement: content(700_007, count + 200),
      },
    ],
  });
  return enqueue(recording, 'density_mutation', {
    removedSeqs: [count + 200],
    replacements: [],
  });
}

async function buildCommittedCase(
  root: string,
  count: number,
): Promise<CommittedParityCase> {
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  const recording = new SessionRecordingService({
    sessionId: `durable-fold-${count}`,
    projectHash: 'durable-fold-project',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const purge = purgeRows(count);
  const last = enqueueCommittedMutations(recording, count, purge);
  const watermark = await recording.waitForCommit(last);
  const file = recording.getFilePath();
  if (file === null) throw new Error('Recording did not create a journal');
  const eager = new HistoryJournalStore(recording);
  const expected = eager.materialize();
  eager.dispose();
  return {
    recording,
    file,
    scratch,
    purge,
    expected,
    maxBytes: watermark.byteOffset,
  };
}

function readRawRow(
  file: string,
  row: ReturnType<DurableRowFold['rowAt']>,
): unknown {
  const buffer = Buffer.alloc(row.bytes);
  const fd = fs.openSync(file, 'r');
  try {
    expect(fs.readSync(fd, buffer, 0, row.bytes, row.offset)).toBe(row.bytes);
  } finally {
    fs.closeSync(fd);
  }
  return JSON.parse(buffer.toString('utf8'));
}

async function assertFoldParity(
  fixtureCase: CommittedParityCase,
  count: number,
): Promise<void> {
  const { expected, file, maxBytes, purge, scratch } = fixtureCase;
  const folded = await foldDurableRows({
    filePath: file,
    maxBytes,
    scratchRoot: scratch,
    chunkBytes: 64 * 1024,
  });
  try {
    expect(folded.length).toBe(expected.length);
    const metrics = folded.metrics();
    expect(metrics.residentBufferBytes).toBeLessThanOrEqual(64 * 1024);
    expect(metrics.fileBytes).toBe(folded.length * metrics.residentBufferBytes);
    for (let index = 0; index < expected.length; index += 1) {
      const numeric = folded.rowAt(index);
      expect(numeric.source).toBe('durable');
      expect(numeric.bytes).toBeGreaterThan(0);
      expect(await folded.readRow(index)).toStrictEqual(expected[index]);
    }
    const rebound = expected.findIndex(
      (row) => row.metadata?.chronology?.seq === count + 100,
    );
    expect(rebound).toBeGreaterThanOrEqual(0);
    expect(expected[rebound].metadata?.responsesStored).toBeUndefined();
    expect(readRawRow(file, folded.rowAt(rebound))).toStrictEqual(purge[9]);
  } finally {
    await folded.close();
  }
}

async function assertCommittedParity(
  root: string,
  count: number,
): Promise<number> {
  const fixtureCase = await buildCommittedCase(root, count);
  const materialize = HistoryJournalStore.prototype.materialize;
  HistoryJournalStore.prototype.materialize = () => {
    throw new Error('materialize trap');
  };
  const readTrap = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('readFileSync trap');
  });
  try {
    await assertFoldParity(fixtureCase, count);
  } finally {
    readTrap.mockRestore();
    HistoryJournalStore.prototype.materialize = materialize;
    await fixtureCase.recording.dispose();
  }
  expect(fs.readdirSync(fixtureCase.scratch)).toStrictEqual([]);
  return fixtureCase.expected.length;
}

for (const count of [512, 8192]) {
  describe(`durable fold with ${count} events`, () => {
    it('matches an eager replay without hydrating the durable history', async () => {
      expect(
        await fixture(async (root, file) =>
          assertParity(root, file, writeHistory(file, count)),
        ),
      ).toBe(count - 10);
    });
    it('replaces survivors on compression and closes on early exit', async () => {
      await fixture(async (root, file) => {
        let text = '';
        for (let index = 0; index < count; index += 1)
          text += line('content', { content: content(index) }, index);
        const summary = content(123456, 27);
        text += line('compressed', { summary, itemsCompressed: count }, count);
        fs.writeFileSync(file, text);
        const fold = await foldDurableRows({
          filePath: file,
          maxBytes: Buffer.byteLength(text),
          scratchRoot: root,
        });
        try {
          expect(fold.length).toBe(1);
          expect(await fold.readRow(0)).toStrictEqual(summary);
        } finally {
          await fold.close();
        }
        expect(fs.readdirSync(root)).toStrictEqual(['journal.jsonl']);
      });
    });
    it('matches real eager materialization across purge, binding, inserts, duplicate sequences and density passes', async () => {
      expect(
        await fixture(async (root) => assertCommittedParity(root, count)),
      ).toBe(count - 2);
    });
  });
}

function largeDensityPayload(): {
  removedSeqs: number[];
  replacements: Array<{ replacedSeq: number; replacement: IContent }>;
} {
  return {
    removedSeqs: Array.from({ length: 4094 }, (_, index) => index % 32),
    replacements: Array.from({ length: 4094 }, (_, index) => ({
      replacedSeq: (index % 31) + (index % 31 >= 5 ? 1 : 0),
      replacement: content(
        index + 1_000_000,
        (index % 31) + (index % 31 >= 5 ? 1 : 0),
      ),
    })),
  };
}

async function densityCase(
  root: string,
  payload: unknown,
): Promise<{
  recording: SessionRecordingService;
  file: string;
  watermark: number;
  expected: IContent[];
}> {
  const recording = new SessionRecordingService({
    sessionId: 'durable-density-projection',
    projectHash: 'durable-fold-project',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  for (let index = 0; index < 32; index += 1)
    enqueue(recording, 'content', { content: content(index) });
  const last = enqueue(recording, 'density_mutation', payload);
  const watermark = (await recording.waitForCommit(last)).byteOffset;
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing density journal');
  const eager = new HistoryJournalStore(recording);
  const expected = eager.materialize();
  eager.dispose();
  return { recording, file, watermark, expected };
}

function retainedSlots(value: unknown, seen = new Set<object>()): number {
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  let children = Object.values(value);
  if (Array.isArray(value)) children = value;
  if (value instanceof Map || value instanceof Set)
    children = [...value.values()];
  const keys = value instanceof Map ? value.size : 0;
  return (
    keys +
    children.reduce((sum, child) => sum + 1 + retainedSlots(child, seen), 0)
  );
}

async function assertLiteralDensityParity(
  root: string,
  replacements: string,
  applied: boolean,
): Promise<number> {
  const { recording, file: journal } = await densityCase(root, {
    removedSeqs: [],
    replacements: [],
  });
  const raw = `{"v":2,"type":"density_mutation","payload":{"removedSeqs":[],"replacements":[${replacements}]}}\n`;
  fs.appendFileSync(journal, raw);
  const store = new HistoryJournalStore(recording);
  const expected = store.materialize();
  store.dispose();
  expect(expected[7]).toStrictEqual(content(applied ? 8 : 7));
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  try {
    const fold = await foldDurableRows({
      filePath: journal,
      maxBytes: fs.statSync(journal).size,
      scratchRoot: scratch,
      chunkBytes: 128,
    });
    try {
      expect(fold.length).toBe(expected.length);
      expect(await fold.readRow(7)).toStrictEqual(expected[7]);
    } finally {
      await fold.close();
    }
  } finally {
    await recording.dispose();
  }
  expect(fs.readdirSync(scratch)).toStrictEqual([]);
  return expected.length;
}

describe('literal density duplicates', () => {
  const row = JSON.stringify(content(8));
  const blocks = JSON.stringify(content(8).blocks);
  const metadata = JSON.stringify(content(8).metadata);
  it.each([
    [
      'blocks',
      `{"replacedSeq":7,"replacement":{"speaker":"human","blocks":{},"blocks":${blocks},"metadata":${metadata}}}`,
      `{"replacedSeq":7,"replacement":{"speaker":"human","blocks":${blocks},"blocks":{},"metadata":${metadata}}}`,
    ],
    [
      'replacement',
      `{"replacedSeq":7,"replacement":null,"replacement":${row}}`,
      `{"replacedSeq":7,"replacement":${row},"replacement":null}`,
    ],
    [
      'replacedSeq',
      `{"replacement":${row},"replacedSeq":-1,"replacedSeq":7}`,
      `{"replacement":${row},"replacedSeq":7,"replacedSeq":-1}`,
    ],
  ])(
    'matches eager JSON last-property precedence for %s in both orders',
    async (_name, valid, invalid) => {
      expect(
        await fixture(async (root) =>
          assertLiteralDensityParity(root, valid, true),
        ),
      ).toBe(32);
      await fixture(async (root) =>
        assertLiteralDensityParity(root, invalid, false),
      );
    },
  );
});

describe('density projection retention trap', () => {
  it('accounts for retained parser containers and rejects the materializing control', async () => {
    const observed = await fixture(async (root) => {
      const payload = largeDensityPayload();
      const removed = payload.removedSeqs.push(7, 7, 7, 7);
      expect(removed + payload.replacements.length).toBe(8192);
      const { recording, file, watermark } = await densityCase(root, payload);
      const raw = fs
        .readFileSync(file, 'utf8')
        .trimEnd()
        .split('\n')
        .slice(-1)
        .join('');
      const bound = 256;
      expect(retainedSlots(JSON.parse(raw))).toBeGreaterThan(bound);
      expect(
        retainedSlots(
          new Map(Array.from({ length: 8192 }, (_, index) => [index, index])),
        ),
      ).toBeGreaterThan(bound);
      let peak = 0;
      const push = MetadataJsonProjection.prototype.push;
      const finish = MetadataJsonProjection.prototype.finish;
      const pushWatch = spyOn(
        MetadataJsonProjection.prototype,
        'push',
      ).mockImplementation(function (
        this: MetadataJsonProjection,
        text: string,
      ) {
        push.call(this, text);
        const frames: unknown = Reflect.get(this, 'stack');
        if (!Array.isArray(frames)) throw new Error('Missing parser frames');
        const seen = new Set<object>();
        const slots = frames.reduce(
          (sum: number, frame: unknown) =>
            sum + retainedSlots(Reflect.get(frame as object, 'value'), seen),
          0,
        );
        peak = Math.max(peak, slots);
      });
      const finishWatch = spyOn(
        MetadataJsonProjection.prototype,
        'finish',
      ).mockImplementation(function (this: MetadataJsonProjection) {
        const result = finish.call(this);
        peak = Math.max(peak, retainedSlots(result));
        return result;
      });
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      try {
        const fold = await foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: scratch,
        });
        await fold.close();
        expect(peak).toBeLessThan(bound);
      } finally {
        finishWatch.mockRestore();
        pushWatch.mockRestore();
        await recording.dispose();
      }
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
      return peak;
    });
    expect(observed).toBe(17);
  });
});
async function assertLargeDensityFold(
  fold: DurableRowFold,
  expected: IContent[],
  inputEntries: number,
): Promise<void> {
  expect(inputEntries).toBe(8192);
  expect(expected[6]).toStrictEqual(content(2_000_002, 7));
  const metrics = fold.metrics();
  expect(metrics.densityIndexPeakEntries).toBe(inputEntries);
  expect(metrics.densityIndexResidentBufferBytes).toBe(48);
  expect(metrics.densityIndexPeakDiskBytes).toBe(
    2 * 4096 * 8 + inputEntries * 40,
  );
  expect(fold.length).toBe(expected.length);
  for (let index = 0; index < fold.length; index += 1)
    expect(await fold.readRow(index)).toStrictEqual(expected[index]);
}

describe('durable density entry projection', () => {
  it('bounds 8192 mutation entries while matching real eager materialization and duplicate precedence', async () => {
    await fixture(async (root) => {
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const payload = largeDensityPayload();
      payload.removedSeqs.push(7, 7);
      payload.replacements.push(
        { replacedSeq: 7, replacement: content(2_000_001, 7) },
        { replacedSeq: 7, replacement: content(2_000_002, 7) },
      );
      const inputEntries =
        payload.removedSeqs.length + payload.replacements.length;
      const { recording, file, watermark, expected } = await densityCase(
        root,
        payload,
      );
      try {
        const fold = await foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: scratch,
          chunkBytes: 64 * 1024,
        });
        try {
          await assertLargeDensityFold(fold, expected, inputEntries);
        } finally {
          await fold.close();
        }
      } finally {
        await recording.dispose();
      }
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
    });
  });

  it('skips an invalid density event atomically and releases projection scratch', async () => {
    await fixture(async (root) => {
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const payload = largeDensityPayload();
      payload.replacements.push({ replacedSeq: -1, replacement: content(99) });
      const { recording, file, watermark, expected } = await densityCase(
        root,
        payload,
      );
      try {
        const fold = await foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: scratch,
        });
        try {
          expect(expected).toHaveLength(32);
          expect(fold.length).toBe(expected.length);
          for (let index = 0; index < fold.length; index += 1)
            expect(await fold.readRow(index)).toStrictEqual(expected[index]);
        } finally {
          await fold.close();
        }
      } finally {
        await recording.dispose();
      }
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
    });
  });
});

describe('durable density validation and cleanup', () => {
  it('skips a late invalid replacement block shape like real eager materialization', async () => {
    await fixture(async (root) => {
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const payload = largeDensityPayload();
      const invalid = {
        ...payload,
        replacements: [
          ...payload.replacements,
          {
            replacedSeq: 7,
            replacement: { speaker: 'human', blocks: { count: 1 } },
          },
        ],
      };
      const { recording, file, watermark, expected } = await densityCase(
        root,
        invalid,
      );
      try {
        const fold = await foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: scratch,
        });
        try {
          expect(expected).toHaveLength(32);
          expect(fold.length).toBe(expected.length);
          for (let index = 0; index < fold.length; index += 1)
            expect(await fold.readRow(index)).toStrictEqual(expected[index]);
        } finally {
          await fold.close();
        }
      } finally {
        await recording.dispose();
      }
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
    });
  });

  it('releases density scratch on a typed invalid chronology error', async () => {
    await fixture(async (root) => {
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const { recording, file, watermark } = await densityCase(root, {
        removedSeqs: [7, 7],
        replacements: [{ replacedSeq: 7, replacement: content(99, -1) }],
      });
      try {
        await expect(
          foldDurableRows({
            filePath: file,
            maxBytes: watermark,
            scratchRoot: scratch,
          }),
        ).rejects.toMatchObject({
          name: 'UnsupportedDurableFoldEvent',
          eventType: 'non_numeric_chronology',
        });
      } finally {
        await recording.dispose();
      }
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
    });
  });
});

describe('durable prefix boundaries', () => {
  it('skips malformed records but accepts missing envelope seq like the eager store', async () => {
    await fixture(async (root, file) => {
      const newline = String.fromCharCode(10);
      const withoutSeq =
        JSON.stringify({
          v: 2,
          type: 'content',
          payload: { content: content(4) },
        }) + newline;
      const text =
        String.fromCharCode(0xfeff) +
        withoutSeq +
        'not-json' +
        newline +
        line('content', { content: content(5) }, 5) +
        '{"v":2';
      fs.writeFileSync(file, text);
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: Buffer.byteLength(text),
        scratchRoot: root,
      });
      try {
        expect(fold.length).toBe(2);
        expect(await fold.readRow(0)).toStrictEqual(content(4));
        expect(await fold.readRow(1)).toStrictEqual(content(5));
      } finally {
        await fold.close();
      }
      expect(fs.readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
});

describe('durable mutation fail-fast boundaries', () => {
  it('rejects a resume boundary past the pinned watermark without allocating scratch', async () => {
    await fixture(async (root, file) => {
      fs.writeFileSync(file, line('content', { content: content(1) }, 1));
      const watermark = fs.statSync(file).size;
      await expect(
        foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: root,
          resumeBoundary: watermark + 1,
        }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(fs.readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
  it('streams a v2 whole-history purge snapshot over 8 MiB and hydrates its row only on demand', async () => {
    await fixture(async (root, file) => {
      const oversized = aiContent(1);
      oversized.blocks = [{ type: 'text', text: 'x'.repeat(8 * 1024 * 1024) }];
      fs.writeFileSync(
        file,
        line(
          'semantic_media_purge',
          {
            history: [oversized],
            frontier: { contentIndex: 0, blockIndex: 0 },
          },
          1,
        ),
      );
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: fs.statSync(file).size,
        scratchRoot: root,
        chunkBytes: 64 * 1024,
      });
      try {
        expect(fold.length).toBe(1);
        expect(fold.metrics().residentBufferBytes).toBe(64);
        expect(await fold.readRow(0)).toStrictEqual(oversized);
      } finally {
        await fold.close();
      }
      expect(fs.readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
});
