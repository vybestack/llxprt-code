/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { foldPendingRows } from './pendingRowFold.js';

function row(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: String(seq) }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: seq } },
  };
}
async function fixture(
  action: (root: string, recorder: SessionRecordingService) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-lifecycle-'));
  const recorder = new SessionRecordingService({
    sessionId: 'pending-life',
    projectHash: 'pending-life',
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  try {
    await action(root, recorder);
  } finally {
    await recorder.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('private pending fold lifecycle', () => {
  it('survives adopted projection deletion and rejects use after close', async () =>
    fixture(async (root, recorder) => {
      const original = recorder.enqueue('content', { content: row(1) });
      if (original === null) throw new Error('No content');
      const boundary = await recorder.waitForCommit(original);
      const projection = path.join(root, 'projected');
      fs.mkdirSync(projection);
      const filePath = path.join(projection, 'rows');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          v: 2,
          type: 'content',
          payload: { content: row(2) },
        }) + '\n',
      );
      const store = new HistoryJournalStore();
      await store
        .adoptJournal(recorder, boundary, true, {
          directory: projection,
          filePath,
        })
        .commit();
      const fold = await foldPendingRows(store.capturePendingFold(), {
        scratchRoot: root,
      });
      store.dispose();
      expect(fs.existsSync(filePath)).toBe(false);
      expect(await fold.readRow(0)).toStrictEqual(row(2));
      await fold.close();
      await fold.close();
      await expect(fold.readRow(0)).rejects.toThrow('closed');
    }));

  it('rejects invalid chronology and releases scratch on throw', async () =>
    fixture(async (root, recorder) => {
      const scratch = path.join(root, 'scratch');
      fs.mkdirSync(scratch);
      const store = new HistoryJournalStore(recorder);
      store.apply({ kind: 'content', content: row(Number.NaN) });
      await expect(
        foldPendingRows(store.capturePendingFold(), { scratchRoot: scratch }),
      ).rejects.toThrow('non_numeric_chronology');
      expect(fs.readdirSync(scratch)).toStrictEqual([]);
      store.dispose();
    }));
});

describe('private pending fold scanning', () => {
  it('does not copy a context-sized pending array while scanning', async () =>
    fixture(async (root, recorder) => {
      const store = new HistoryJournalStore(recorder);
      for (let index = 0; index < 512; index++)
        store.apply({ kind: 'content', content: row(index) });
      const snapshot = store.capturePendingFold();
      const forbidden = () => {
        throw new Error('context-sized array copy');
      };
      const map = Reflect.get(snapshot.pending, 'map');
      const slice = Reflect.get(snapshot.pending, 'slice');
      const iterator = Reflect.get(snapshot.pending, Symbol.iterator);
      Object.defineProperty(snapshot.pending, Symbol.iterator, {
        value: forbidden,
        configurable: true,
      });
      Object.defineProperty(snapshot.pending, 'map', {
        value: forbidden,
        configurable: true,
      });
      Object.defineProperty(snapshot.pending, 'slice', {
        value: forbidden,
        configurable: true,
      });
      try {
        expect(() =>
          Reflect.apply(Array.from, Array, [snapshot.pending]),
        ).toThrow('context-sized array copy');
        expect(() =>
          Reflect.apply(
            Reflect.get(snapshot.pending, 'map'),
            snapshot.pending,
            [(entry: unknown): unknown => entry],
          ),
        ).toThrow('context-sized array copy');
        const fold = await foldPendingRows(snapshot, { scratchRoot: root });
        try {
          expect(fold.length).toBe(512);
          expect(fold.metrics().residentBufferBytes).toBe(64);
        } finally {
          await fold.close();
        }
      } finally {
        Object.defineProperty(snapshot.pending, 'map', {
          value: map,
          configurable: true,
        });
        Object.defineProperty(snapshot.pending, 'slice', {
          value: slice,
          configurable: true,
        });
        Object.defineProperty(snapshot.pending, Symbol.iterator, {
          value: iterator,
          configurable: true,
        });
        store.dispose();
      }
    }));
});
