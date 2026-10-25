/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { JournalSession } from './journalSession.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('journal admission', () => {
  it('preserves admissions written while an earlier record syscall is paused', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      fixture.pauseWriter();
      fixture.history.add(row('before pause'));
      await fixture.writerPaused;
      for (let index = 0; index < 24; index++)
        fixture.history.add(row(`during pause ${index}`));
      expect(fixture.history.length()).toBe(25);
      fixture.releaseWriter();
      await fixture.history.waitForCommit();
      await fixture.history.waitForTokenUpdates();
      const texts: unknown[] = [];
      for await (const content of fixture.primaryRows())
        texts.push(content.blocks);
      expect(texts).toStrictEqual([
        row('before pause').blocks,
        ...Array.from(
          { length: 24 },
          (_, index) => row(`during pause ${index}`).blocks,
        ),
      ]);
      expect(await fixture.durable()).toBeDefined();
    });
  });

  it('fails synchronously before exceeding the unopened journal row admission budget', async () => {
    const session = await JournalSession.createUnlinked();
    const store = new JournalHistoryStore(async () => session);
    try {
      for (let index = 0; index < 32; index++)
        store.apply({ kind: 'content', content: row(`startup ${index}`) });
      expect(() =>
        store.apply({ kind: 'content', content: row('over budget') }),
      ).toThrow('Journal startup admission budget exceeded');
      expect(store.getLength()).toBe(32);
      await store.waitForDurable();
      expect((await store.lastContent())?.blocks).toStrictEqual(
        row('startup 31').blocks,
      );
    } finally {
      await store.dispose();
    }
  });
  it('rejects an unopened row exceeding the byte budget without advancing history', async () => {
    const session = await JournalSession.createUnlinked();
    const store = new JournalHistoryStore(async () => session);
    try {
      expect(() =>
        store.apply({ kind: 'content', content: row('x'.repeat(256 * 1024)) }),
      ).toThrow('Journal startup admission budget exceeded');
      expect(store.getLength()).toBe(0);
      await store.waitForDurable();
    } finally {
      await store.dispose();
    }
  });

  it('bounds distinct pending tokenizer ranges before admitting another row', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      for (let index = 0; index < 32; index++)
        history.add(row(`range ${index}`), `model-${index}`);
      expect(() => history.add(row('over budget'), 'another-model')).toThrow(
        'Token ticket range admission budget exceeded',
      );
      expect(history.length()).toBe(32);
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      expect(history.getTotalTokens()).toBeGreaterThan(0);
    });
  });

  it('does not merge token work across a queued token-total synchronization', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      history.add(row('first'));
      history.syncTotalTokens(100);
      history.add(row('second'));
      await history.waitForTokenUpdates();
      const second = await history.estimateTokensForText('second');
      expect(history.getTotalTokens()).toBe(100 + second);
    });
  });
});
