/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { foldPendingRows, type PendingRowFold } from './pendingRowFold.js';

function row(id: number, seq = id): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${id}` }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: seq } },
  };
}

async function fixture(
  action: (root: string, recorder: SessionRecordingService) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-fold-'));
  const recorder = new SessionRecordingService({
    sessionId: 'pending-fold',
    projectHash: 'pending-fold',
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

async function verifyRows(
  fold: PendingRowFold,
  expected: readonly IContent[],
  fresh: IContent,
): Promise<void> {
  for (let index = 0; index < expected.length; index++) {
    const actual = await fold.readRow(index);
    expect(actual).toStrictEqual(expected[index]);
  }
  expect(await fold.readRow(expected.length - 1)).toBe(fresh);
}

function applyDensity(store: HistoryJournalStore, expected: IContent[]): void {
  store.apply({
    kind: 'density',
    payload: {
      removedSeqs: [1],
      replacements: [
        { replacedSeq: 0, replacement: row(900_000, 0) },
        { replacedSeq: 3, replacement: row(900_003, 3) },
      ],
    },
  });
  expected.splice(1, 1);
  expected[0] = row(900_000, 0);
  expected[2] = row(900_003, 3);
}

for (const count of [512, 8192])
  describe(`${count} rows`, () => {
    it('pins pending membership across acknowledgements, applies mutations, and retains original pending identities', async () => {
      await fixture(async (root, recorder) => {
        const first = recorder.enqueue('content', { content: row(0) });
        if (first === null) throw new Error('No durable row');
        const watermark = await recorder.waitForCommit(first);
        const store = new HistoryJournalStore();
        await store.adoptJournal(recorder, watermark).commit();
        const expected = [row(0)];
        for (let index = 1; index < count; index++) {
          const content = row(index);
          store.apply({ kind: 'content', content });
          expected.push(content);
        }
        store.apply({
          kind: 'syntheticInsert',
          payload: {
            content: row(900_001),
            chronologySeq: 900_001,
            afterSeq: 4,
          },
        });
        expected.splice(5, 0, row(900_001));
        applyDensity(store, expected);
        store.apply({ kind: 'rewind', itemsRemoved: 1, cutSeq: count - 2 });
        expected.splice(
          expected.findIndex(
            (entry) => entry.metadata?.chronology?.seq === count - 2,
          ),
        );
        const fresh = row(900_004);
        store.apply({ kind: 'content', content: fresh });
        expected.push(fresh);
        const snapshot = store.capturePendingFold();
        const materialize = HistoryJournalStore.prototype.materialize;
        HistoryJournalStore.prototype.materialize = () => {
          throw new Error('eager path');
        };
        const trap = spyOn(fs, 'readFileSync').mockImplementation(() => {
          throw new Error('full read');
        });
        try {
          expect(() => store.materialize()).toThrow('eager path');
          expect(() => fs.readFileSync(root)).toThrow('full read');
          const fold = await foldPendingRows(snapshot, {
            scratchRoot: root,
            chunkBytes: 512,
          });
          try {
            expect(await fold.readRow(0)).toStrictEqual(expected[0]);
            await store.waitForDurable();
            store.dispose();
            expect(fold.length).toBe(expected.length);
            expect(fold.metrics().residentBufferBytes).toBeLessThanOrEqual(
              64 * 1024,
            );
            await verifyRows(fold, expected, fresh);
          } finally {
            await fold.close();
            await fold.close();
          }
        } finally {
          trap.mockRestore();
          HistoryJournalStore.prototype.materialize = materialize;
          store.dispose();
        }
      });
    });
  });

describe('pending compression', () => {
  it('compression replaces the whole projection and early return releases scratch', async () => {
    await fixture(async (root, recorder) => {
      const store = new HistoryJournalStore(recorder);
      store.apply({ kind: 'content', content: row(1) });
      const summary = row(2);
      store.apply({ kind: 'compressed', summary, itemsCompressed: 1 });
      const fold = await foldPendingRows(store.capturePendingFold(), {
        scratchRoot: root,
      });
      try {
        expect(fold.length).toBe(1);
        expect(await fold.readRow(0)).toBe(summary);
      } finally {
        await fold.close();
        store.dispose();
      }
    });
  });
});
