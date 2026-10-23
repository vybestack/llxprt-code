/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalStore } from '../../journal/journalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

describe('HistoryService journal disposal', () => {
  it('rejects with the journal disposal failure', async () => {
    const history = new HistoryService();
    history.add(row('seed'));
    await history.waitForCommit();
    await history.waitForOwnershipSettlement();
    const failure = new Error('journal close failed');
    const close = JournalStore.prototype.close;
    const fault = spyOn(JournalStore.prototype, 'close').mockImplementation(
      async function (this: JournalStore): Promise<void> {
        await close.call(this);
        throw failure;
      },
    );
    try {
      await expect(history.dispose()).rejects.toBe(failure);
      await expect(history.dispose()).rejects.toBe(failure);
    } finally {
      fault.mockRestore();
    }
  });

  it('shares one disposal between repeated calls', async () => {
    const history = new HistoryService();
    history.add(row('seed'));
    await history.waitForCommit();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const close = JournalStore.prototype.close;
    const fault = spyOn(JournalStore.prototype, 'close').mockImplementation(
      async function (this: JournalStore): Promise<void> {
        entered.resolve();
        await release.promise;
        await close.call(this);
      },
    );
    const settled: string[] = [];
    const first = history.dispose().then(() => {
      settled.push('first');
    });
    await entered.promise;
    const second = history.dispose().then(() => {
      settled.push('second');
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toStrictEqual([]);
    } finally {
      release.resolve();
      await Promise.all([first, second]);
      fault.mockRestore();
    }
    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      undefined,
      undefined,
    ]);
    expect(settled).toStrictEqual(['first', 'second']);
    await expect(history.dispose()).resolves.toBeUndefined();
  });

  it('resolves when the journal is disposed', async () => {
    const history = new HistoryService();
    history.add(row('seed'));
    await history.waitForCommit();
    await history.waitForOwnershipSettlement();

    await expect(history.dispose()).resolves.toBeUndefined();
  });
});
