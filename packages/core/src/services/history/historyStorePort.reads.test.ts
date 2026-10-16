/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHistoryStore } from './historyBackend.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent } from './IContent.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

async function withStore(
  test: (store: HistoryStorePort) => Promise<void>,
): Promise<void> {
  const store = createHistoryStore({}, 'old');
  try {
    await test(store);
  } finally {
    await store.dispose();
  }
}

describe('HistoryStorePort asynchronous reads', () => {
  it('lastContent resolves the newest row, optionally of one speaker', async () => {
    await withStore(async (store) => {
      expect(await store.lastContent()).toBeUndefined();
      store.apply({ kind: 'content', content: row('human', 'one', 1) });
      store.apply({ kind: 'content', content: row('ai', 'two', 2) });
      store.apply({ kind: 'content', content: row('human', 'three', 3) });
      const pending = store.lastContent('ai');
      expect(pending).toBeInstanceOf(Promise);
      expect((await pending)?.blocks).toStrictEqual([
        { type: 'text', text: 'two' },
      ]);
      expect((await store.lastContent())?.blocks).toStrictEqual([
        { type: 'text', text: 'three' },
      ]);
      expect(await store.lastContent('tool')).toBeUndefined();
    });
  });

  it('readRows hands an asynchronous view that stays valid across awaits', async () => {
    await withStore(async (store) => {
      store.apply({ kind: 'content', content: row('human', 'one', 1) });
      store.apply({
        kind: 'content',
        content: row('ai', 'two', 2),
        origin: 'writer-a',
      });
      const origins = await store.readRows(async (view) => {
        const seen: Array<string | undefined> = [];
        for (let index = 0; index < view.length; index++) {
          await Promise.resolve();
          seen.push(await view.originAt(index));
        }
        return seen;
      });
      expect(origins).toStrictEqual([undefined, 'writer-a']);
    });
  });

  it('readRows closes the view when the callback has settled', async () => {
    await withStore(async (store) => {
      store.apply({ kind: 'content', content: row('human', 'one', 1) });
      let escaped: Parameters<Parameters<HistoryStorePort['readRows']>[0]>[0];
      await store.readRows((view) => {
        escaped = view;
        return Promise.resolve();
      });
      await expect(escaped!.originAt(0)).rejects.toThrow(/closed/);
    });
  });
});
