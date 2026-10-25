/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalHistoryStore } from './journalHistoryStore.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from './journalSession.js';
import type { TokenRowSource } from './history-token-tickets.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';

async function withStore(
  run: (store: JournalHistoryStore, session: JournalSession) => Promise<void>,
  options: JournalSessionOptions = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'journal-token-row-batch-'));
  const session = await JournalSession.create(
    join(root, 'primary.llxj'),
    options,
  );
  const store = new JournalHistoryStore(session);
  try {
    await run(store, session);
  } finally {
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function append(store: JournalHistoryStore, text: string): TokenRowSource {
  store.apply({
    kind: 'content',
    content: { speaker: 'human', blocks: [{ type: 'text', text }] },
  });
  return store.captureTokenRow();
}

describe('queued token row snapshot lifetime', () => {
  it('shares one pinned version across submissions queued behind a paused writer', async () => {
    const seams = testJournalSeams({ gateWriteAt: 1 });
    await withStore(
      async (store, session) => {
        const snapshots = spyOn(session.store, 'snapshot');
        const sources: TokenRowSource[] = [];
        try {
          for (let index = 0; index < 24; index++)
            sources.push(append(store, `row ${index}`));
          for (let spin = 0; spin < 500; spin++) {
            if (
              seams.events.filter((event) => event.type === 'write').length >= 2
            )
              break;
            await new Promise<void>((resolve) => setTimeout(resolve, 2));
          }
          expect(
            seams.events.filter((event) => event.type === 'write').length,
          ).toBe(2);
          expect(snapshots.mock.calls.length).toBe(1);
          seams.release();
          for (const [index, source] of sources.entries()) {
            try {
              expect((await source.read()).blocks).toStrictEqual([
                { type: 'text', text: `row ${index}` },
              ]);
            } finally {
              await source.close();
            }
          }
          // Each write reads its base. Token readers need one shared pin.
          expect(snapshots.mock.calls.length).toBe(25);
          expect(await session.store.compact()).toBe('swapped');
        } finally {
          seams.release();
          await Promise.all(sources.map((source) => source.close()));
          snapshots.mockRestore();
        }
      },
      { journal: seams.dependencies },
    );
  });

  it('keeps submitted values pinned across a rewind and replacement append', async () => {
    await withStore(async (store) => {
      const before = append(store, 'removed row');
      store.apply({ kind: 'rewind', itemsRemoved: 1 });
      const after = append(store, 'replacement row');
      try {
        expect((await before.read()).blocks).toStrictEqual([
          { type: 'text', text: 'removed row' },
        ]);
        expect((await after.read()).blocks).toStrictEqual([
          { type: 'text', text: 'replacement row' },
        ]);
      } finally {
        await before.close();
        await after.close();
      }
    });
  });

  it('closes canceled sources without retaining a version', async () => {
    await withStore(async (store, session) => {
      const sources: TokenRowSource[] = [];
      for (let index = 0; index < 24; index++)
        sources.push(append(store, `canceled ${index}`));
      await Promise.all(sources.map((source) => source.close()));
      await store.waitForDurable();
      expect(store.getLength()).toBe(24);
      expect(await session.store.compact()).toBe('swapped');
    });
  });

  it('retains the shared pin until the last source closes', async () => {
    await withStore(async (store, session) => {
      const first = append(store, 'first row');
      const second = append(store, 'second row');
      try {
        expect((await first.read()).blocks).toStrictEqual([
          { type: 'text', text: 'first row' },
        ]);
        await first.close();
        await expect(session.store.compact()).rejects.toThrow(
          'A journal with a live pin cannot compact',
        );
        expect((await second.read()).blocks).toStrictEqual([
          { type: 'text', text: 'second row' },
        ]);
      } finally {
        await first.close();
        await second.close();
      }
      expect(await session.store.compact()).toBe('swapped');
    });
  });

  it('pins the original row before a whole-history replacement', async () => {
    await withStore(async (store) => {
      const source = append(store, 'original');
      store.replaceAll([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'replacement' }] },
      ]);
      try {
        expect((await source.read()).blocks).toStrictEqual([
          { type: 'text', text: 'original' },
        ]);
        await store.waitForDurable();
        expect((await store.lastContent())?.blocks).toStrictEqual([
          { type: 'text', text: 'replacement' },
        ]);
      } finally {
        await source.close();
      }
    });
  });
});
