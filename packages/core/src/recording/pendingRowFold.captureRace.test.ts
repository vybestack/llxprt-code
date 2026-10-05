/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { pinReadableFile, foldDurableRows } from './durableRowFold.js';
import { foldPendingRows, type PendingRowFold } from './pendingRowFold.js';

function row(id: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${id}` }],
    metadata: {
      chronology: { seq: id, userTurn: id, step: 0, recordedAt: id },
    },
  };
}

function recording(root: string, sessionId: string): SessionRecordingService {
  return new SessionRecordingService({
    sessionId,
    projectHash: 'capture-race',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
}

async function useFixture<T>(action: (root: string) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-race-'));
  try {
    return await action(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

interface Watermark {
  readonly seq: number;
  readonly byteOffset: number;
}

async function writeJournalRows(
  recorder: SessionRecordingService,
  count: number,
): Promise<Watermark> {
  let last = null;
  for (let index = 0; index < count; index++)
    last = recorder.enqueue('content', { content: row(index) });
  if (last === null) throw new Error('No durable rows recorded');
  return recorder.waitForCommit(last);
}

function projection(
  root: string,
  rows: readonly IContent[],
): { directory: string; filePath: string } {
  const directory = path.join(root, 'projection');
  fs.mkdirSync(directory);
  const filePath = path.join(directory, 'projection.jsonl');
  const lines = rows.map(
    (content) =>
      JSON.stringify({ v: 2, type: 'content', payload: { content } }) + '\n',
  );
  fs.writeFileSync(filePath, lines.join(''));
  return { directory, filePath };
}

async function verifyRows(
  fold: PendingRowFold,
  expected: readonly IContent[],
): Promise<void> {
  expect(fold.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++)
    expect(await fold.readRow(index)).toStrictEqual(expected[index]);
}

function pinnedFd(snapshot: {
  readonly pinnedJournal: { readonly fd: number } | null;
}): number {
  const pinned = snapshot.pinnedJournal;
  if (pinned === null) throw new Error('Expected a pinned journal descriptor');
  return pinned.fd;
}

async function foldPinnedSnapshot(
  snapshot: Parameters<typeof foldPendingRows>[0],
  root: string,
  expected: readonly IContent[],
): Promise<void> {
  const trap = spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('full read');
  });
  try {
    const fold = await foldPendingRows(snapshot, {
      scratchRoot: root,
      chunkBytes: 512,
    });
    try {
      await verifyRows(fold, expected);
      expect(await fold.readRow(expected.length - 1)).toBe(
        expected[expected.length - 1],
      );
      expect(fold.metrics().residentBufferBytes).toBeLessThanOrEqual(64 * 1024);
    } finally {
      await fold.close();
    }
  } finally {
    trap.mockRestore();
  }
}

interface ParityFixture {
  readonly recorder: SessionRecordingService;
  readonly store: HistoryJournalStore;
  readonly snapshot: Parameters<typeof foldPendingRows>[0];
  readonly expected: IContent[];
  readonly journalPath: string;
  readonly projected: { readonly directory: string };
}

async function prepareParity(
  root: string,
  count: number,
): Promise<ParityFixture> {
  const recorder = recording(root, `race-parity-${count}`);
  const boundary = await writeJournalRows(recorder, count);
  const projected = projection(
    root,
    Array.from({ length: count }, (_, index) => row(index)),
  );
  const store = new HistoryJournalStore();
  await store.adoptJournal(recorder, boundary, true, projected).commit();
  store.apply({ kind: 'rewind', itemsRemoved: 1, cutSeq: count - 1 });
  store.apply({
    kind: 'syntheticInsert',
    payload: {
      content: row(2_000_000),
      chronologySeq: 2_000_000,
      afterSeq: 3,
    },
  });
  await store.waitForDurable();
  store.apply({ kind: 'content', content: row(3_000_000) });
  const expected = store.materialize();
  const snapshot = store.capturePendingFold();
  const journalPath = recorder.getFilePath();
  if (journalPath === null) throw new Error('Missing journal');
  return { recorder, store, snapshot, expected, journalPath, projected };
}

function pausePinnedRead(snapshot: Parameters<typeof foldPendingRows>[0]): {
  entered: Promise<void>;
  resume: () => void;
  cancel: (error: Error) => void;
} {
  const pinned = snapshot.pinnedJournal;
  if (pinned === null) throw new Error('Expected synchronously pinned journal');
  let signalEntered: () => void = () => {};
  let resume: () => void = () => {};
  let cancel: (error: Error) => void = () => {};
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const barrier = new Promise<void>((resolve, reject) => {
    resume = resolve;
    cancel = reject;
  });
  const read = pinned.handle.read;
  let first = true;
  pinned.handle.read = async (buffer, offset, length, position) => {
    if (first) {
      first = false;
      signalEntered();
      await barrier;
    }
    return read(buffer, offset, length, position);
  };
  return { entered, resume, cancel };
}

describe('private pending fold capture/open race', () => {
  it('folds a journal whose path is unlinked after capture', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'race-journal');
      try {
        await writeJournalRows(recorder, 4);
        const store = new HistoryJournalStore(recorder);
        store.apply({ kind: 'content', content: row(500) });
        await store.waitForDurable();
        const journalPath = store.journalPath();
        if (journalPath === null) throw new Error('Missing journal path');
        const expected = store.materialize();
        const snapshot = store.capturePendingFold();
        fs.rmSync(journalPath);
        expect(fs.existsSync(journalPath)).toBe(false);
        const fold = await foldPendingRows(snapshot, {
          scratchRoot: root,
          chunkBytes: 512,
        });
        try {
          await verifyRows(fold, expected);
        } finally {
          await fold.close();
          store.dispose();
        }
      } finally {
        await recorder.dispose();
      }
    }));

  it('folds a projection whose directory is removed after capture', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'race-projection');
      try {
        const boundary = await writeJournalRows(recorder, 2);
        const projected = projection(root, [row(200)]);
        const store = new HistoryJournalStore();
        await store.adoptJournal(recorder, boundary, true, projected).commit();
        store.apply({ kind: 'content', content: row(300) });
        await store.waitForDurable();
        const expected = store.materialize();
        const snapshot = store.capturePendingFold();
        store.dispose();
        expect(fs.existsSync(projected.filePath)).toBe(false);
        const fold = await foldPendingRows(snapshot, {
          scratchRoot: root,
          chunkBytes: 512,
        });
        try {
          await verifyRows(fold, expected);
        } finally {
          await fold.close();
        }
      } finally {
        await recorder.dispose();
      }
    }));
});

describe('private pending fold retirement race', () => {
  it('reads an owned journal retired during adoption through the pinned descriptor', () =>
    useFixture(async (root) => {
      const store = new HistoryJournalStore();
      const destination = recording(root, 'race-adopt-destination');
      try {
        for (let index = 0; index < 3; index++)
          store.apply({ kind: 'content', content: row(index) });
        await store.waitForDurable();
        const ownedPath = store.journalPath();
        if (ownedPath === null) throw new Error('Missing owned journal');
        const expected = store.materialize();
        const snapshot = store.capturePendingFold();
        const watermark = await writeJournalRows(destination, 1);
        store.onRetired(() => fs.rmSync(ownedPath));
        const adoption = store.adoptJournal(destination, watermark);
        adoption.prepareCommit();
        expect(fs.existsSync(ownedPath)).toBe(false);
        const fold = await foldPendingRows(snapshot, {
          scratchRoot: root,
          chunkBytes: 512,
        });
        try {
          await verifyRows(fold, expected);
        } finally {
          await fold.close();
          await adoption.commit();
          store.dispose();
        }
      } finally {
        await destination.dispose();
      }
    }));
});

describe('private pending fold paused I/O races', () => {
  it('survives unlink of both pinned sources while durable scanning is paused', () =>
    useFixture(async (root) => {
      const fixture = await prepareParity(root, 8);
      const journalFd = pinnedFd(fixture.snapshot);
      const projectionFd = fixture.snapshot.pinnedProjection?.fd;
      if (projectionFd === undefined) throw new Error('Missing projection pin');
      const pause = pausePinnedRead(fixture.snapshot);
      try {
        expect(fs.fstatSync(journalFd).size).toBeGreaterThan(0);
        expect(fs.fstatSync(projectionFd).size).toBeGreaterThan(0);
        const folding = foldPendingRows(fixture.snapshot, {
          scratchRoot: root,
        });
        await pause.entered;
        fs.rmSync(fixture.journalPath);
        fixture.store.dispose();
        expect(fs.existsSync(fixture.journalPath)).toBe(false);
        expect(fs.existsSync(fixture.projected.directory)).toBe(false);
        pause.resume();
        const fold = await folding;
        try {
          await verifyRows(fold, fixture.expected);
        } finally {
          await fold.close();
        }
        expect(() => fs.fstatSync(journalFd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionFd)).toThrow(/EBADF/);
      } finally {
        pause.resume();
        fixture.store.dispose();
        await fixture.recorder.dispose();
      }
    }));

  it('survives owned journal retirement and adoption commit during a paused read', () =>
    useFixture(async (root) => {
      const store = new HistoryJournalStore();
      const destination = recording(root, 'paused-adoption');
      try {
        store.apply({ kind: 'content', content: row(1) });
        await store.waitForDurable();
        const expected = store.materialize();
        const snapshot = store.capturePendingFold();
        const ownedPath = store.journalPath();
        if (ownedPath === null) throw new Error('Missing owned journal');
        const pause = pausePinnedRead(snapshot);
        try {
          const folding = foldPendingRows(snapshot, { scratchRoot: root });
          await pause.entered;
          const watermark = await writeJournalRows(destination, 1);
          store.onRetired(() => fs.rmSync(ownedPath));
          const adoption = store.adoptJournal(destination, watermark);
          adoption.prepareCommit();
          await adoption.commit();
          expect(fs.existsSync(ownedPath)).toBe(false);
          pause.resume();
          const fold = await folding;
          try {
            await verifyRows(fold, expected);
          } finally {
            await fold.close();
          }
        } finally {
          pause.resume();
        }
      } finally {
        store.dispose();
        await destination.dispose();
      }
    }));
});

describe('private pending fold paused I/O cleanup', () => {
  it('closes both pins and scratch when paused I/O is cancelled by a throw', () =>
    useFixture(async (root) => {
      const fixture = await prepareParity(root, 4);
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const journalFd = pinnedFd(fixture.snapshot);
      const projectionFd = fixture.snapshot.pinnedProjection?.fd;
      if (projectionFd === undefined) throw new Error('Missing projection pin');
      const pause = pausePinnedRead(fixture.snapshot);
      try {
        const folding = foldPendingRows(fixture.snapshot, {
          scratchRoot: scratch,
        });
        await pause.entered;
        pause.cancel(new Error('cancel pinned read'));
        await expect(folding).rejects.toThrow('cancel pinned read');
        expect(() => fs.fstatSync(journalFd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionFd)).toThrow(/EBADF/);
        expect(fs.readdirSync(scratch)).toStrictEqual([]);
      } finally {
        fixture.store.dispose();
        await fixture.recorder.dispose();
      }
    }));
});

describe('private pending fold mutation after capture', () => {
  it('retains the pending object and observes its new content like eager materialize', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'race-mutation');
      const store = new HistoryJournalStore(recorder);
      try {
        await writeJournalRows(recorder, 1);
        const pending = row(9);
        store.apply({ kind: 'content', content: pending });
        const snapshot = store.capturePendingFold();
        pending.blocks[0] = { type: 'text', text: 'changed after capture' };
        const expected = store.materialize();
        const fold = await foldPendingRows(snapshot, { scratchRoot: root });
        try {
          await verifyRows(fold, expected);
          expect(await fold.readRow(fold.length - 1)).toBe(pending);
          expect(expected[expected.length - 1]).toBe(pending);
        } finally {
          await fold.close();
        }
      } finally {
        store.dispose();
        await recorder.dispose();
      }
    }));
});

describe('private pending fold descriptor cleanup', () => {
  it('releases pinned descriptors on fold failure and early close', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'race-cleanup');
      try {
        await writeJournalRows(recorder, 2);
        const store = new HistoryJournalStore(recorder);
        store.apply({ kind: 'content', content: row(9) });
        await store.waitForDurable();
        const failing = store.capturePendingFold();
        const failingFd = pinnedFd(failing);
        expect(fs.fstatSync(failingFd).size).toBeGreaterThan(0);
        await expect(
          foldPendingRows(failing, { scratchRoot: root, chunkBytes: 0 }),
        ).rejects.toThrow('chunk');
        expect(() => fs.fstatSync(failingFd)).toThrow(/EBADF/);
        const closing = store.capturePendingFold();
        const closingFd = pinnedFd(closing);
        const fold = await foldPendingRows(closing, { scratchRoot: root });
        await fold.close();
        expect(() => fs.fstatSync(closingFd)).toThrow(/EBADF/);
        store.dispose();
      } finally {
        await recorder.dispose();
      }
    }));

  it('releases a pinned journal when the projection cannot be pinned', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'race-capture-failure');
      try {
        const boundary = await writeJournalRows(recorder, 2);
        const store = new HistoryJournalStore();
        await store
          .adoptJournal(recorder, boundary, true, {
            directory: path.join(root, 'absent-projection'),
            filePath: path.join(root, 'absent-projection', 'rows'),
          })
          .commit();
        const journalPath = store.journalPath();
        if (journalPath === null) throw new Error('Missing journal path');
        const open = fs.openSync;
        const opened: number[] = [];
        const watched = spyOn(fs, 'openSync').mockImplementation(
          (file, flags, mode) => {
            const fd = open(file, flags, mode);
            if (file === journalPath) opened.push(fd);
            return fd;
          },
        );
        try {
          expect(() => store.capturePendingFold()).toThrow(/ENOENT/);
          if (opened.length === 0)
            throw new Error('Journal was never pinned before projection');
          expect(() => fs.fstatSync(opened[opened.length - 1])).toThrow(
            /EBADF/,
          );
        } finally {
          watched.mockRestore();
          store.dispose();
        }
      } finally {
        await recorder.dispose();
      }
    }));
});

for (const count of [512, 8192])
  describe(`${count} pinned rows`, () => {
    it('matches eager materialization after the journal and projection are unlinked', () =>
      useFixture(async (root) => {
        const fixture = await prepareParity(root, count);
        try {
          const extra = fixture.recorder.enqueue('content', {
            content: row(9_999_999),
          });
          if (extra === null) throw new Error('No later durable row');
          await fixture.recorder.waitForCommit(extra);
          fs.rmSync(fixture.journalPath);
          fs.rmSync(fixture.projected.directory, { recursive: true });
          expect(fs.existsSync(fixture.journalPath)).toBe(false);
          await foldPinnedSnapshot(fixture.snapshot, root, fixture.expected);
          fixture.store.dispose();
        } finally {
          await fixture.recorder.dispose();
        }
      }));
  });

describe('private pending fold empty-source and ownership boundaries', () => {
  it('captures an external first write queued before the journal file exists', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'queued-first-write');
      const store = new HistoryJournalStore(recorder);
      try {
        const first = recorder.enqueue('content', { content: row(1) });
        if (first === null) throw new Error('First record not queued');
        const journalPath = recorder.getFilePath();
        if (journalPath === null) throw new Error('No queued journal path');
        expect(fs.existsSync(journalPath)).toBe(false);
        expect(store.materialize()).toStrictEqual([]);
        const snapshot = store.capturePendingFold();
        const fold = await foldPendingRows(snapshot, { scratchRoot: root });
        try {
          expect(fold.length).toBe(0);
          await recorder.waitForCommit(first);
          expect(store.materialize()).toStrictEqual([row(1)]);
          expect(fold.metrics().fileBytes).toBe(0);
        } finally {
          await fold.close();
        }
      } finally {
        store.dispose();
        await recorder.dispose();
      }
    }));

  it('releases a pinned zero-byte external journal on successful close', () =>
    useFixture(async (root) => {
      const recorder = recording(root, 'zero-byte-journal');
      const store = new HistoryJournalStore(recorder);
      try {
        const first = recorder.enqueue('content', { content: row(1) });
        if (first === null) throw new Error('First record not queued');
        const journalPath = recorder.getFilePath();
        if (journalPath === null) throw new Error('No journal path');
        await recorder.waitForCommit(first);
        fs.writeFileSync(journalPath, '');
        const snapshot = store.capturePendingFold();
        const fd = pinnedFd(snapshot);
        expect(fs.fstatSync(fd).size).toBe(0);
        const fold = await foldPendingRows(snapshot, { scratchRoot: root });
        expect(fold.length).toBe(0);
        await fold.close();
        expect(() => fs.fstatSync(fd)).toThrow(/EBADF/);
      } finally {
        store.dispose();
        await recorder.dispose();
      }
    }));

  it('releases a never-folded capture when its owner cancels after disposal', () =>
    useFixture(async (root) => {
      const fixture = await prepareParity(root, 4);
      const journalFd = pinnedFd(fixture.snapshot);
      const projectionFd = fixture.snapshot.pinnedProjection?.fd;
      if (projectionFd === undefined) throw new Error('Missing projection pin');
      try {
        expect(() => {
          try {
            fixture.store.dispose();
            expect(fs.fstatSync(journalFd).size).toBeGreaterThan(0);
            expect(fs.fstatSync(projectionFd).size).toBeGreaterThan(0);
            throw new Error('owner cancelled');
          } finally {
            fixture.snapshot.release();
            fixture.snapshot.release();
          }
        }).toThrow('owner cancelled');
        expect(() => fs.fstatSync(journalFd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionFd)).toThrow(/EBADF/);
      } finally {
        await fixture.recorder.dispose();
      }
    }));
});

describe('private fold scratch cleanup failures', () => {
  it('releases both pending capture pins when scratch removal fails on close', () =>
    useFixture(async (root) => {
      const fixture = await prepareParity(root, 4);
      const journalFd = pinnedFd(fixture.snapshot);
      const projectionFd = fixture.snapshot.pinnedProjection?.fd;
      if (projectionFd === undefined) throw new Error('Missing projection pin');
      const rm = fs.rmSync;
      const trap = spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (path.basename(String(target)).startsWith('llxprt-row-directory-'))
          throw new Error('scratch cleanup failed');
        return rm(target, options);
      });
      try {
        const fold = await foldPendingRows(fixture.snapshot, {
          scratchRoot: root,
        });
        await expect(fold.close()).rejects.toThrow('scratch cleanup failed');
        expect(() => fs.fstatSync(journalFd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionFd)).toThrow(/EBADF/);
      } finally {
        trap.mockRestore();
        fixture.store.dispose();
        await fixture.recorder.dispose();
      }
    }));

  it('preserves the pending fold error and releases both pins when scratch cleanup fails', () =>
    useFixture(async (root) => {
      const fixture = await prepareParity(root, 4);
      fixture.snapshot.release();
      fixture.store.apply({ kind: 'content', content: row(Number.NaN) });
      const snapshot = fixture.store.capturePendingFold();
      const journalFd = pinnedFd(snapshot);
      const projectionFd = snapshot.pinnedProjection?.fd;
      if (projectionFd === undefined) throw new Error('Missing projection pin');
      const rm = fs.rmSync;
      const trap = spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (path.basename(String(target)).startsWith('llxprt-row-directory-'))
          throw new Error('scratch cleanup failed');
        return rm(target, options);
      });
      try {
        await expect(
          foldPendingRows(snapshot, { scratchRoot: root }),
        ).rejects.toThrow('non_numeric_chronology');
        expect(() => fs.fstatSync(journalFd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionFd)).toThrow(/EBADF/);
      } finally {
        trap.mockRestore();
        fixture.store.dispose();
        await fixture.recorder.dispose();
      }
    }));
});

describe('private durable fold scratch cleanup failure', () => {
  it('preserves a durable scan error and releases both pins when scratch cleanup fails', () =>
    useFixture(async (root) => {
      const journalPath = path.join(root, 'invalid-journal');
      const projected = projection(root, [row(1)]);
      const prefix =
        JSON.stringify({
          v: 2,
          type: 'content',
          payload: { content: row(1) },
        }) + '\n';
      fs.writeFileSync(
        journalPath,
        prefix + JSON.stringify({ v: 99, type: 'content' }) + '\n',
      );
      const journal = pinReadableFile(journalPath);
      const projectionPin = pinReadableFile(projected.filePath);
      const rm = fs.rmSync;
      const trap = spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (path.basename(String(target)).startsWith('llxprt-row-directory-'))
          throw new Error('scratch cleanup failed');
        return rm(target, options);
      });
      try {
        await expect(
          foldDurableRows({
            maxBytes: journal.size,
            resumeBoundary: Buffer.byteLength(prefix),
            pinnedJournal: journal,
            pinnedProjection: projectionPin,
            scratchRoot: root,
          }),
        ).rejects.toThrow('Unsupported recording version');
        expect(() => fs.fstatSync(journal.fd)).toThrow(/EBADF/);
        expect(() => fs.fstatSync(projectionPin.fd)).toThrow(/EBADF/);
      } finally {
        trap.mockRestore();
        journal.release();
        projectionPin.release();
      }
    }));
});
