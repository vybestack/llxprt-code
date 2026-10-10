/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { appendFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { RecordingWriterIo } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

function row(id: number, text = `row-${id}`): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq: id, userTurn: id, step: 0, recordedAt: id },
    },
  };
}

function textOf(content: IContent): string {
  const first = content.blocks[0];
  return first.type === 'text' ? first.text : '';
}

class AppendGate {
  private blocked = false;
  private readonly waiters: Array<() => void> = [];

  hold(): void {
    this.blocked = true;
  }

  release(): void {
    this.blocked = false;
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async wait(): Promise<void> {
    if (!this.blocked) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

function gatedIo(gate: AppendGate): RecordingWriterIo {
  return {
    appendFile: async (filePath, data, encoding) => {
      await gate.wait();
      await appendFile(filePath, data, encoding);
    },
  };
}

function recorder(
  root: string,
  sessionId: string,
  io?: RecordingWriterIo,
): SessionRecordingService {
  return new SessionRecordingService({
    sessionId,
    projectHash: 'history-journal-stream',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io,
    maxQueueBytes: Infinity,
  });
}

async function withFixture<T>(
  action: (root: string) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'history-live-rows-'));
  try {
    return await action(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function writeRows(
  recording: SessionRecordingService,
  count: number,
): Promise<{ readonly seq: number; readonly byteOffset: number }> {
  let last = null;
  for (let index = 0; index < count; index += 1)
    last = recording.enqueue('content', { content: row(index) });
  if (last === null) throw new Error('No journal row was enqueued');
  return recording.waitForCommit(last);
}

interface ResourceWatch {
  readonly directories: readonly string[];
  readonly journalFds: readonly number[];
  readonly maxReadBytes: () => number;
  restore(): void;
}

function watchScratchDirectories(directories: string[]): () => void {
  const originalMkdtemp = fs.mkdtempSync;
  function observeDirectory(created: string | NonSharedBuffer): void {
    const directory = created.toString();
    if (/llxprt-(row-directory|resolver|density-index)-/.test(directory))
      directories.push(directory);
  }
  function observedMkdtemp(prefix: string, options?: fs.EncodingOption): string;
  function observedMkdtemp(
    prefix: string,
    options: fs.BufferEncodingOption,
  ): NonSharedBuffer;
  function observedMkdtemp(
    prefix: string,
    options?: fs.EncodingOption,
  ): string | NonSharedBuffer;
  function observedMkdtemp(
    prefix: string,
    options?: fs.EncodingOption | fs.BufferEncodingOption,
  ): string | NonSharedBuffer {
    if (
      options === 'buffer' ||
      (typeof options === 'object' && options?.encoding === 'buffer')
    ) {
      const created = originalMkdtemp(prefix, options);
      observeDirectory(created);
      return created;
    }
    const created = originalMkdtemp(prefix, options);
    observeDirectory(created);
    return created;
  }
  const watched = spyOn(fs, 'mkdtempSync').mockImplementation(observedMkdtemp);
  return () => watched.mockRestore();
}

function watchResources(journalPath: string): ResourceWatch {
  const directories: string[] = [];
  const journalFds: number[] = [];
  let maxReadBytes = 0;
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const restoreMkdtemp = watchScratchDirectories(directories);
  function observedRead(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position: fs.ReadPosition | null,
  ): number;
  function observedRead(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    options?: fs.ReadOptions,
  ): number;
  function observedRead(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offsetOrOptions?: number | fs.ReadOptions,
    length?: number,
    position?: fs.ReadPosition | null,
  ): number {
    if (typeof offsetOrOptions !== 'number') {
      maxReadBytes = Math.max(
        maxReadBytes,
        offsetOrOptions?.length ?? buffer.byteLength,
      );
      return originalRead(fd, buffer, offsetOrOptions);
    }
    if (length === undefined) throw new Error('Missing observed read length');
    maxReadBytes = Math.max(maxReadBytes, length);
    return originalRead(fd, buffer, offsetOrOptions, length, position ?? null);
  }
  const open = spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    const fd = originalOpen(file, flags, mode);
    if (file === journalPath) journalFds.push(fd);
    return fd;
  });
  const read = spyOn(fs, 'readSync').mockImplementation(observedRead);
  return {
    directories,
    journalFds,
    maxReadBytes: () => maxReadBytes,
    restore: () => {
      read.mockRestore();
      open.mockRestore();
      restoreMkdtemp();
    },
  };
}

function expectReleased(resources: ResourceWatch): void {
  expect(resources.directories.length).toBeGreaterThan(0);
  expect(
    resources.directories.every((directory) => !fs.existsSync(directory)),
  ).toBe(true);
  expect(resources.journalFds.length).toBeGreaterThan(0);
  for (const fd of resources.journalFds)
    expect(() => fs.fstatSync(fd)).toThrow(/EBADF/);
}

function measuredStore(recording: SessionRecordingService): {
  readonly store: HistoryJournalStore;
  readonly ownership: RowOwnership;
  readonly counters: ReturnType<typeof createRowCounters>;
} {
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  return {
    store: new HistoryJournalStore(recording, {
      ...counters.counters,
      ownership,
    }),
    ownership,
    counters,
  };
}

async function collect(stream: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const content of stream) result.push(content);
  return result;
}

describe('HistoryJournalStore live row stream snapshot timing', () => {
  it('captures on first next and return before first next owns nothing', () =>
    withFixture(async (root) => {
      const recording = recorder(root, 'lazy-snapshot');
      const store = new HistoryJournalStore(recording);
      try {
        const before = store.streamRows()[Symbol.asyncIterator]();
        const scratchBefore = fs
          .readdirSync(getScratchRoot())
          .filter((entry) => entry.startsWith('llxprt-row-directory-')).length;
        await before.return?.();
        const scratchAfter = fs
          .readdirSync(getScratchRoot())
          .filter((entry) => entry.startsWith('llxprt-row-directory-')).length;
        expect(scratchAfter).toBe(scratchBefore);

        store.apply({ kind: 'content', content: row(1) });
        const stream = store.streamRows();
        store.apply({ kind: 'content', content: row(2) });
        expect((await collect(stream)).map(textOf)).toStrictEqual([
          'row-1',
          'row-2',
        ]);
      } finally {
        store.dispose();
        await recording.dispose();
      }
    }));
});

interface ParityCase {
  readonly recording: SessionRecordingService;
  readonly store: HistoryJournalStore;
  readonly gate: AppendGate;
  readonly expected: IContent[];
  readonly pending: IContent;
}

async function parityCase(root: string, count: number): Promise<ParityCase> {
  const gate = new AppendGate();
  const recording = recorder(root, `parity-${count}`, gatedIo(gate));
  const watermark = await writeRows(recording, count);
  const store = new HistoryJournalStore();
  await store.adoptJournal(recording, watermark, true).commit();
  gate.hold();
  recording.enqueue('content', { content: row(7_000_000) });
  store.apply({ kind: 'rewind', itemsRemoved: 3, cutSeq: count - 3 });
  store.apply({
    kind: 'syntheticInsert',
    payload: { content: row(8_000_000), chronologySeq: 8_000_000, afterSeq: 3 },
  });
  store.apply({
    kind: 'density',
    payload: {
      removedSeqs: [1],
      replacements: [
        { replacedSeq: 2, replacement: row(9_000_000, 'replacement') },
      ],
    },
  });
  const pending = row(10_000_000, 'pending-before');
  store.apply({ kind: 'content', content: pending });
  return { recording, store, gate, expected: store.materialize(), pending };
}

async function verifyParity(root: string, count: number): Promise<number> {
  const fixture = await parityCase(root, count);
  const journalPath = fixture.store.journalPath();
  if (journalPath === null) throw new Error('Missing journal path');
  const captured = fixture.store.capturePendingFold();
  const pendingArray = captured.pending;
  captured.release();
  const forbidden = () => {
    throw new Error('context materialization trap');
  };
  const map = Reflect.get(pendingArray, 'map');
  const slice = Reflect.get(pendingArray, 'slice');
  const iterator = Reflect.get(pendingArray, Symbol.iterator);
  Object.defineProperties(pendingArray, {
    map: { value: forbidden, configurable: true },
    slice: { value: forbidden, configurable: true },
    [Symbol.iterator]: { value: forbidden, configurable: true },
  });
  const eager = HistoryJournalStore.prototype.materialize;
  HistoryJournalStore.prototype.materialize = () => {
    throw new Error('eager materialize trap');
  };
  const readFile = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('whole-file read trap');
  });
  const resources = watchResources(journalPath);
  try {
    const actual: IContent[] = [];
    const stream = fixture.store.streamRows()[Symbol.asyncIterator]();
    const first = await stream.next();
    if (first.done !== true) actual.push(first.value);
    fixture.pending.blocks[0] = { type: 'text', text: 'pending-after' };
    for (;;) {
      const next = await stream.next();
      if (next.done === true) break;
      actual.push(next.value);
    }
    expect(actual).toStrictEqual(fixture.expected);
    expect(actual[actual.length - 1]).not.toBe(fixture.pending);
    expect(textOf(actual[actual.length - 1])).toBe('pending-before');
    expect(resources.maxReadBytes()).toBeLessThanOrEqual(64 * 1024);
    expectReleased(resources);
    return actual.length;
  } finally {
    resources.restore();
    readFile.mockRestore();
    HistoryJournalStore.prototype.materialize = eager;
    Object.defineProperties(pendingArray, {
      map: { value: map, configurable: true },
      slice: { value: slice, configurable: true },
      [Symbol.iterator]: { value: iterator, configurable: true },
    });
    fixture.gate.release();
    fixture.store.dispose();
    await fixture.recording.dispose();
  }
}

for (const count of [512, 8192])
  describe(`${count} live journal rows`, () => {
    it('matches eager resume, watermark and pending mutation ordering without materializing', async () => {
      expect(await withFixture((root) => verifyParity(root, count))).toBe(
        count - 2,
      );
    });
  });

async function durableFixture(
  root: string,
  id: string,
  count = 4,
): Promise<{
  readonly recording: SessionRecordingService;
  readonly store: HistoryJournalStore;
  readonly journalPath: string;
}> {
  const recording = recorder(root, id);
  await writeRows(recording, count);
  const store = new HistoryJournalStore(recording);
  const journalPath = store.journalPath();
  if (journalPath === null) throw new Error('Missing journal path');
  return { recording, store, journalPath };
}

async function cancelStream(
  store: HistoryJournalStore,
  mode: 'break' | 'throw' | 'return',
): Promise<boolean> {
  if (mode === 'return') {
    const iterator = store.streamRows()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.();
    return false;
  }
  const consumerFailure = new Error('consumer failure');
  try {
    for await (const content of store.streamRows()) {
      expect(textOf(content)).toBe('row-0');
      if (mode === 'throw') throw consumerFailure;
      break;
    }
  } catch (error) {
    if (error !== consumerFailure) throw error;
    return true;
  }
  return false;
}

async function verifyCancelled(
  root: string,
  mode: 'break' | 'throw' | 'return',
): Promise<number> {
  const fixture = await durableFixture(root, `cancel-${mode}`);
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const store = new HistoryJournalStore(fixture.recording, {
    ...counters.counters,
    ownership,
  });
  const resources = watchResources(fixture.journalPath);
  try {
    const consumerFailureObserved = await cancelStream(store, mode);
    expect(consumerFailureObserved).toBe(mode === 'throw');
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(counters.snapshot().peakDecodedRows).toBe(1);
    expectReleased(resources);
    return ownership.snapshot().liveRows;
  } finally {
    resources.restore();
    store.dispose();
    fixture.store.dispose();
    await fixture.recording.dispose();
  }
}

describe('HistoryJournalStore live row cancellation ownership', () => {
  for (const mode of ['break', 'throw', 'return'] as const)
    it(`releases the yielded row, descriptors and scratch on ${mode}`, async () => {
      expect(await withFixture((root) => verifyCancelled(root, mode))).toBe(0);
    });
});

async function verifyRetirementRace(
  root: string,
  action: 'adopt' | 'dispose',
): Promise<string[]> {
  const source = await durableFixture(root, `source-${action}`, 3);
  const destination = recorder(root, `destination-${action}`);
  const destinationWatermark = await writeRows(destination, 1);
  const resources = watchResources(source.journalPath);
  try {
    const iterator = source.store.streamRows()[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (action === 'adopt')
      await source.store
        .adoptJournal(destination, destinationWatermark)
        .commit();
    else source.store.dispose();
    const remaining: IContent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      remaining.push(next.value);
    }
    const texts = [first.value, ...remaining].map(textOf);
    expect(texts).toStrictEqual(['row-0', 'row-1', 'row-2']);
    expectReleased(resources);
    return texts;
  } finally {
    resources.restore();
    source.store.dispose();
    await source.recording.dispose();
    await destination.dispose();
  }
}

describe('HistoryJournalStore live row pinned binding', () => {
  for (const action of ['adopt', 'dispose'] as const)
    it(`finishes the pinned snapshot after ${action}`, async () => {
      expect(
        await withFixture((root) => verifyRetirementRace(root, action)),
      ).toStrictEqual(['row-0', 'row-1', 'row-2']);
    });
});

async function appendRaw(
  recording: SessionRecordingService,
  raw: string,
): Promise<string> {
  await writeRows(recording, 1);
  const journalPath = recording.getFilePath();
  if (journalPath === null) throw new Error('Missing journal path');
  fs.appendFileSync(journalPath, raw);
  return journalPath;
}

async function verifyFailureCleanup(
  root: string,
  id: string,
  raw: string,
  message: string,
): Promise<number> {
  const recording = recorder(root, id);
  const journalPath = await appendRaw(recording, raw);
  const store = new HistoryJournalStore(recording);
  const resources = watchResources(journalPath);
  try {
    await expect(collect(store.streamRows())).rejects.toThrow(message);
    expectReleased(resources);
    return resources.journalFds.length;
  } finally {
    resources.restore();
    store.dispose();
    await recording.dispose();
  }
}

describe('HistoryJournalStore live row failure cleanup', () => {
  it('releases descriptors and scratch on fold failure', async () => {
    const pinned = await withFixture((root) =>
      verifyFailureCleanup(
        root,
        'fold-failure',
        '{"v":99,"type":"content","payload":{}}\n',
        'Unsupported recording version',
      ),
    );
    expect(pinned).toBeGreaterThan(0);
  });

  it('releases descriptors and scratch on selected-row decode failure', async () => {
    const pinned = await withFixture((root) => {
      const oversized = row(2, 'x'.repeat(16 * 1024 * 1024));
      const raw = `${JSON.stringify({ v: 2, type: 'content', payload: { content: oversized } })}\n`;
      return verifyFailureCleanup(
        root,
        'decode-failure',
        raw,
        'exceeds record bound',
      );
    });
    expect(pinned).toBeGreaterThan(0);
  });

  it('streams an oversized v2 whole-history purge and cleans up its descriptors and scratch', async () => {
    const pinned = await withFixture(async (root) => {
      const purge = row(2, 'x'.repeat(8 * 1024 * 1024));
      const raw = `${JSON.stringify({ v: 2, type: 'semantic_media_purge', payload: { history: [purge] } })}\n`;
      const recording = recorder(root, 'purge-failure');
      const journalPath = await appendRaw(recording, raw);
      const store = new HistoryJournalStore(recording);
      const resources = watchResources(journalPath);
      try {
        expect(await collect(store.streamRows())).toStrictEqual([purge]);
        expectReleased(resources);
        return resources.journalFds.length;
      } finally {
        resources.restore();
        store.dispose();
        await recording.dispose();
      }
    });
    expect(pinned).toBeGreaterThan(0);
  });
});

describe('HistoryJournalStore live row oversize boundary', () => {
  it('streams one valid row larger than 8 MiB with one owner and bounded reads', () => {
    expect.hasAssertions();
    return withFixture(async (root) => {
      const recording = recorder(root, 'large-row');
      const large = row(2, 'x'.repeat(8 * 1024 * 1024));
      const journalPath = await appendRaw(
        recording,
        `${JSON.stringify({ v: 2, type: 'content', payload: { content: large } })}\n`,
      );
      const measured = measuredStore(recording);
      const resources = watchResources(journalPath);
      try {
        const streamed = await collect(measured.store.streamRows());
        expect(streamed).toHaveLength(2);
        expect(streamed[1]).toStrictEqual(large);
        expect(measured.ownership.snapshot().peakRows).toBe(1);
        expect(measured.ownership.snapshot().liveRows).toBe(0);
        expect(measured.counters.snapshot().peakDecodedRows).toBe(1);
        expect(resources.maxReadBytes()).toBeLessThanOrEqual(64 * 1024);
        expectReleased(resources);
      } finally {
        resources.restore();
        measured.store.dispose();
        await recording.dispose();
      }
    });
  });
});
