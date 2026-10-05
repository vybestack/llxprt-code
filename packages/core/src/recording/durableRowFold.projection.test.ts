/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { foldDurableRows } from './durableRowFold.js';

function row(id: number, ai = false): IContent {
  return {
    speaker: ai ? 'ai' : 'human',
    blocks: [{ type: 'text', text: `row-${id}` }],
    metadata: {
      chronology: { seq: id, userTurn: id, step: 0, recordedAt: id },
      ...(ai ? { responsesStored: true } : {}),
    },
  };
}

async function fixture<T>(
  action: (root: string, recorder: SessionRecordingService) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projected-fold-'));
  const recorder = new SessionRecordingService({
    sessionId: 'projected-fold',
    projectHash: 'projected-fold',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  try {
    return await action(root, recorder);
  } finally {
    await recorder.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function projection(
  root: string,
  rows: readonly IContent[],
): { directory: string; filePath: string } {
  const directory = path.join(root, 'projection');
  fs.mkdirSync(directory);
  const filePath = path.join(directory, 'projection.jsonl');
  const fd = fs.openSync(filePath, 'wx');
  try {
    for (const content of rows)
      fs.writeSync(
        fd,
        JSON.stringify({ v: 2, type: 'content', payload: { content } }) + '\n',
      );
  } finally {
    fs.closeSync(fd);
  }
  return { directory, filePath };
}

async function verifyBoundProjection(
  filePath: string,
  maxBytes: number,
  boundary: number,
  projectionPath: string,
  scratchRoot: string,
): Promise<void> {
  const bound = await foldDurableRows({
    filePath,
    maxBytes,
    resumeBoundary: boundary,
    projectionPath,
    scratchRoot,
  });
  try {
    expect(bound.rowAt(0).source).toBe('projection');
    expect(bound.rowAt(0).invalidateResponses).toBe(true);
    const expected = row(2, true);
    const metadata = {
      ...expected.metadata,
      chronology: { seq: 12, userTurn: 3, step: 1, recordedAt: 12 },
    };
    delete metadata.responsesStored;
    expect(await bound.readRow(0)).toStrictEqual({ ...expected, metadata });
  } finally {
    await bound.close();
  }
}

async function verifyCompressedRewind(
  recorder: SessionRecordingService,
  filePath: string,
  boundary: number,
  projectionPath: string,
  scratchRoot: string,
): Promise<void> {
  const compressed = recorder.enqueue('compressed', {
    summary: row(30, true),
    itemsCompressed: 1,
  });
  if (compressed === null) throw new Error('No compression recorded');
  await recorder.waitForCommit(compressed);
  const rewind = recorder.enqueue('rewind', { itemsRemoved: 1 });
  if (rewind === null) throw new Error('No rewind recorded');
  await recorder.waitForCommit(rewind);
  const fresh = recorder.enqueue('content', { content: row(40, true) });
  if (fresh === null) throw new Error('No new content recorded');
  const maxBytes = (await recorder.waitForCommit(fresh)).byteOffset;
  const fold = await foldDurableRows({
    filePath,
    maxBytes,
    resumeBoundary: boundary,
    projectionPath,
    scratchRoot,
  });
  try {
    expect(fold.length).toBe(1);
    expect(fold.rowAt(0).source).toBe('durable');
    expect(await fold.readRow(0)).toStrictEqual(row(40, true));
  } finally {
    await fold.close();
  }
}

async function compareRows(input: {
  filePath: string;
  watermark: number;
  boundary: number;
  scratchRoot: string;
  expected: readonly IContent[];
  count: number;
  projectedRows?: ReturnType<typeof projection>;
}): Promise<void> {
  const { expected, count, projectedRows, ...options } = input;
  const readTrap = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('full-file read');
  });
  const materialize = HistoryJournalStore.prototype.materialize;
  HistoryJournalStore.prototype.materialize = () => {
    throw new Error('eager fold');
  };
  try {
    const fold = await foldDurableRows({
      filePath: options.filePath,
      maxBytes: options.watermark,
      resumeBoundary: options.boundary,
      projectionPath: projectedRows?.filePath,
      scratchRoot: options.scratchRoot,
      chunkBytes: 512,
    });
    try {
      expect(fold.length).toBe(expected.length);
      expect(fold.metrics().residentBufferBytes).toBe(64);
      expect(fold.metrics().fileBytes).toBe(expected.length * 64);
      expect(expected.length * 64).toBeGreaterThan(64);
      for (let index = 0; index < fold.length; index += 1) {
        expect(fold.rowAt(index).source).toBe(
          projectedRows && index < count - 1 ? 'projection' : 'durable',
        );
        expect(await fold.readRow(index)).toStrictEqual(expected[index]);
      }
      if (projectedRows)
        fs.rmSync(projectedRows.directory, { recursive: true });
      expect(await fold.readRow(0)).toStrictEqual(expected[0]);
    } finally {
      await fold.close();
      await fold.close();
    }
  } finally {
    HistoryJournalStore.prototype.materialize = materialize;
    readTrap.mockRestore();
  }
}

async function checkParity(
  root: string,
  recorder: SessionRecordingService,
  count: number,
  projected: boolean,
): Promise<number> {
  let last = recorder.enqueue('content', { content: row(0, true) });
  for (let index = 1; index < count; index += 1)
    last = recorder.enqueue('content', {
      content: row(index, index % 19 === 0),
    });
  if (last === null) throw new Error('No content recorded');
  const boundary = (await recorder.waitForCommit(last)).byteOffset;
  const projectedRows = projected
    ? projection(
        root,
        Array.from({ length: count }, (_, index) =>
          row(index === 0 ? 100_000 : index, index === 0 || index % 19 === 0),
        ),
      )
    : undefined;
  const store = new HistoryJournalStore();
  const adoption = store.adoptJournal(
    recorder,
    { seq: last.seq, byteOffset: boundary },
    true,
    projectedRows,
  );
  await adoption.commit();
  try {
    store.apply({ kind: 'rewind', itemsRemoved: 1, cutSeq: count - 1 });
    store.apply({ kind: 'content', content: row(count + 1, true) });
    await store.waitForDurable();
    const expected = store.materialize();
    const filePath = recorder.getFilePath();
    if (filePath === null) throw new Error('Missing journal');
    const watermark = fs.statSync(filePath).size;
    recorder.enqueue('content', { content: row(999_999) });
    const scratchRoot = path.join(root, 'scratch');
    fs.mkdirSync(scratchRoot);
    await compareRows({
      filePath,
      watermark,
      boundary,
      scratchRoot,
      expected,
      count,
      projectedRows,
    });
    expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
    return expected.length;
  } finally {
    store.dispose();
  }
}

for (const count of [512, 8192])
  for (const projected of [false, true])
    describe(`${count} ${projected ? 'projected' : 'original'} resume rows`, () => {
      it('matches eager materialization across restored AI state, rewind, new rows and a pinned watermark', async () => {
        expect(
          await fixture((root, recorder) =>
            checkParity(root, recorder, count, projected),
          ),
        ).toBe(count);
      });
    });

describe('projection ownership', () => {
  it('retains its opened projection after adoption commit and releases scratch on early close', async () => {
    await fixture(async (root, recorder) => {
      const last = recorder.enqueue('content', { content: row(1, true) });
      if (last === null) throw new Error('No content recorded');
      const boundary = (await recorder.waitForCommit(last)).byteOffset;
      const projectedRows = projection(root, [row(2, true)]);
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('Missing journal');
      const store = new HistoryJournalStore();
      const adoption = store.adoptJournal(
        recorder,
        { seq: last.seq, byteOffset: boundary },
        true,
        projectedRows,
      );
      const scratchRoot = path.join(root, 'scratch');
      fs.mkdirSync(scratchRoot);
      const fold = await foldDurableRows({
        filePath,
        maxBytes: boundary,
        resumeBoundary: boundary,
        projectionPath: projectedRows.filePath,
        scratchRoot,
      });
      try {
        adoption.prepareCommit();
        await adoption.commit();
        fs.rmSync(projectedRows.directory, { recursive: true });
        const expected = row(2, true);
        const metadata = { ...expected.metadata };
        delete metadata.responsesStored;
        expect(await fold.readRow(0)).toStrictEqual({ ...expected, metadata });
      } finally {
        await fold.close();
        store.dispose();
      }
      expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
    });
  });
});

describe('projection promotion and failure cleanup', () => {
  it('uses only durable spans after projection promotion and disposal', async () => {
    await fixture(async (root, recorder) => {
      const last = recorder.enqueue('content', { content: row(1, true) });
      if (last === null) throw new Error('No content recorded');
      const boundary = (await recorder.waitForCommit(last)).byteOffset;
      const projectedRows = projection(root, [row(2, true)]);
      const store = new HistoryJournalStore();
      const adoption = store.adoptJournal(
        recorder,
        { seq: last.seq, byteOffset: boundary },
        true,
        projectedRows,
      );
      const bound = recorder.enqueue('chronology_bind', {
        rowIndex: 0,
        chronology: { seq: 2, userTurn: 2, step: 0, recordedAt: 2 },
        content: row(2, true),
        invalidateResponses: true,
      });
      if (bound === null) throw new Error('Missing durable binding');
      const watermark = await recorder.waitForCommit(bound);
      adoption.useDurableProjection(watermark);
      await adoption.commit();
      fs.rmSync(projectedRows.directory, { recursive: true });
      const expected = store.materialize();
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('Missing journal');
      const scratchRoot = path.join(root, 'scratch');
      fs.mkdirSync(scratchRoot);
      const fold = await foldDurableRows({
        filePath,
        maxBytes: watermark.byteOffset,
        resumeBoundary: 0,
        scratchRoot,
      });
      try {
        expect(fold.rowAt(0).source).toBe('durable');
        expect(await fold.readRow(0)).toStrictEqual(expected[0]);
      } finally {
        await fold.close();
        store.dispose();
      }
      expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
    });
  });
  it('closes both sources and scratch when a post-boundary record fails', async () => {
    await fixture(async (root, recorder) => {
      const last = recorder.enqueue('content', { content: row(1) });
      if (last === null) throw new Error('No content recorded');
      const boundary = (await recorder.waitForCommit(last)).byteOffset;
      const projectedRows = projection(root, [row(2)]);
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('Missing journal');
      fs.appendFileSync(filePath, '{"v":99,"type":"content"}\n');
      const scratchRoot = path.join(root, 'scratch');
      fs.mkdirSync(scratchRoot);
      await expect(
        foldDurableRows({
          filePath,
          maxBytes: fs.statSync(filePath).size,
          resumeBoundary: boundary,
          projectionPath: projectedRows.filePath,
          scratchRoot,
        }),
      ).rejects.toThrow('Unsupported recording version');
      expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
      expect(fs.existsSync(projectedRows.filePath)).toBe(true);
    });
  });
});

// A zero boundary has no restored prefix; even a supplied projection is unused.
describe('resume boundary edge cases', () => {
  it('ignores a projection at byte offset zero and keeps new response chains intact', async () => {
    await fixture(async (root, recorder) => {
      const last = recorder.enqueue('content', { content: row(1, true) });
      if (last === null) throw new Error('No content recorded');
      const maxBytes = (await recorder.waitForCommit(last)).byteOffset;
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('Missing journal');
      const scratchRoot = path.join(root, 'scratch');
      fs.mkdirSync(scratchRoot);
      const fold = await foldDurableRows({
        filePath,
        maxBytes,
        resumeBoundary: 0,
        projectionPath: path.join(root, 'absent-projection'),
        scratchRoot,
      });
      try {
        expect(fold.rowAt(0).source).toBe('durable');
        expect(await fold.readRow(0)).toStrictEqual(row(1, true));
      } finally {
        await fold.close();
      }
      expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
    });
  });
  it('applies post-boundary bindings to projected rows, then compression and rewind to later rows', async () => {
    await fixture(async (root, recorder) => {
      const original = recorder.enqueue('content', { content: row(1, true) });
      if (original === null) throw new Error('No content recorded');
      const boundary = (await recorder.waitForCommit(original)).byteOffset;
      const projectedRows = projection(root, [row(2, true)]);
      const store = new HistoryJournalStore();
      const adoption = store.adoptJournal(
        recorder,
        { seq: original.seq, byteOffset: boundary },
        true,
        projectedRows,
      );
      await adoption.commit();
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('Missing journal');
      const bind = recorder.enqueue('chronology_bind', {
        rowIndex: 0,
        chronology: { seq: 12, userTurn: 3, step: 1, recordedAt: 12 },
        invalidateResponses: false,
      });
      if (bind === null) throw new Error('No binding recorded');
      const boundBytes = (await recorder.waitForCommit(bind)).byteOffset;
      const scratchRoot = path.join(root, 'scratch');
      fs.mkdirSync(scratchRoot);
      await verifyBoundProjection(
        filePath,
        boundBytes,
        boundary,
        projectedRows.filePath,
        scratchRoot,
      );
      try {
        await verifyCompressedRewind(
          recorder,
          filePath,
          boundary,
          projectedRows.filePath,
          scratchRoot,
        );
      } finally {
        store.dispose();
      }
      expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
    });
  });
});
