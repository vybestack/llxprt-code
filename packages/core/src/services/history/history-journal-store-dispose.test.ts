/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * HistoryJournalStore.dispose() is awaitable: it resolves only once the
 * recorder is disposed and the scratch directory is gone, and it rejects with
 * whatever failed instead of swallowing it.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

async function storeWithRow(): Promise<{
  store: HistoryJournalStore;
  scratchDir: string;
}> {
  const store = new HistoryJournalStore();
  store.apply({ kind: 'content', content: row('seed') });
  await store.waitForDurable();
  const journalPath = store.journalPath();
  if (journalPath === null) throw new Error('store has no journal file');
  return { store, scratchDir: dirname(journalPath) };
}

const restores: Array<() => void> = [];

function failRecorderDispose(failure: Error): void {
  const realDispose = SessionRecordingService.prototype.dispose;
  const spy = spyOn(
    SessionRecordingService.prototype,
    'dispose',
  ).mockImplementation(async function (this: SessionRecordingService) {
    await realDispose.call(this);
    throw failure;
  });
  restores.push(() => spy.mockRestore());
}

function blockScratchRemoval(scratchDir: string): void {
  chmodSync(scratchDir, 0o500);
  restores.push(() => chmodSync(scratchDir, 0o700));
}

describe('journal disposal', () => {
  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
  });

  describe('HistoryJournalStore.dispose', () => {
    it('removes the scratch directory before it resolves', async () => {
      const { store, scratchDir } = await storeWithRow();
      expect(existsSync(scratchDir)).toBe(true);

      await store.dispose();

      expect(existsSync(scratchDir)).toBe(false);
    });

    it('rejects when the recorder dispose fails, and still removes the scratch directory', async () => {
      const { store, scratchDir } = await storeWithRow();
      const failure = new Error('recorder dispose failed');
      failRecorderDispose(failure);

      await expect(store.dispose()).rejects.toBe(failure);

      expect(existsSync(scratchDir)).toBe(false);
    });

    it('rejects when the scratch removal fails', async () => {
      const { store, scratchDir } = await storeWithRow();
      blockScratchRemoval(scratchDir);

      await expect(store.dispose()).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('rejects with an AggregateError of both failures when recorder dispose and scratch removal fail', async () => {
      const { store, scratchDir } = await storeWithRow();
      const failure = new Error('recorder dispose failed');
      failRecorderDispose(failure);
      blockScratchRemoval(scratchDir);

      const rejection = await store.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(rejection).toBeInstanceOf(AggregateError);
      const errors = (rejection as AggregateError).errors;
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBe(failure);
      expect(errors[1]).toMatchObject({ code: 'EACCES' });
    });

    it('shares one disposal between repeated calls', async () => {
      const { store, scratchDir } = await storeWithRow();

      const first = store.dispose();
      const second = store.dispose();
      await Promise.all([first, second]);

      expect(existsSync(scratchDir)).toBe(false);
    });
  });

  describe('HistoryService.dispose', () => {
    it('rejects with the journal disposal failure', async () => {
      const history = new HistoryService();
      history.add(row('seed'));
      await history.waitForOwnershipSettlement();
      const failure = new Error('recorder dispose failed');
      failRecorderDispose(failure);

      await expect(history.dispose()).rejects.toBe(failure);
    });

    it('resolves when the journal is disposed', async () => {
      const history = new HistoryService();
      history.add(row('seed'));
      await history.waitForOwnershipSettlement();

      await expect(history.dispose()).resolves.toBeUndefined();
    });
  });
});
