/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import {
  withNativeClearFixture,
  withNativeClearMediaFixture,
  type NativeClearFixture,
} from './__tests__/support/native-clear-fixture.js';
import {
  removalReferences,
  removalRow,
} from './history-removals-test-helpers.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function rejectNextClear(
  history: HistoryService,
  failure: Error,
  events: string[],
): void {
  const reject = (): void => {
    history.off('tokensUpdated', reject);
    events.push('clear');
    throw failure;
  };
  history.on('tokensUpdated', reject);
}

async function prepareDurability(
  fixture: NativeClearFixture,
  durability: string,
  retained: readonly IContent[],
): Promise<void> {
  const { history } = fixture;
  if (durability !== 'pending') await history.addBatch([retained[0]]);
  if (durability !== 'durable') fixture.pauseWriter();
  history.addAll(durability === 'pending' ? retained : [retained[1]]);
  if (durability === 'durable') {
    await history.waitForCommit();
    await history.waitForTokenUpdates();
  } else {
    await fixture.waitForPausedWrite;
    expect(history.length()).toBe(2);
    expect(history.getContextRange().totalEntries).toBe(
      durability === 'pending' ? 0 : 1,
    );
  }
}

async function failedRebuild(
  fixture: NativeClearFixture,
  retained: readonly IContent[],
  incoming: IContent,
  events: string[],
): Promise<void> {
  const { history } = fixture;
  const failure = new Error('native rebuild clear observer failed');
  rejectNextClear(history, failure, events);
  history.on('contentAdded', (row) => {
    events.push(row === incoming ? 'streaming' : 'rebuild');
  });
  history.on('compressionLockReleased', () => {
    events.push('released');
    expect(history.length()).toBe(retained.length);
  });
  history.startCompression();
  history.add(incoming);
  let cleared: Promise<void> | undefined;
  history.rebuildWith(() => {
    cleared = history.clear();
    for (const row of retained) history.add(row);
  });
  expect(() => history.endCompression()).not.toThrow();
  expect(events).toStrictEqual([]);
  fixture.releaseWriter();
  await expect(cleared).rejects.toBe(failure);
  await expect(history.waitForPendingOperations()).rejects.toBe(failure);
  await history.waitForCommit();
  await history.waitForTokenUpdates();
  expect(events).toStrictEqual([
    'clear',
    ...retained.map(() => 'rebuild'),
    'released',
    'streaming',
  ]);
  expect(await collectRawHistory(history)).toStrictEqual([
    ...retained,
    incoming,
  ]);
  await fixture.assertDurable([...retained, incoming]);
}

describe('native compression rebuild clear observer failure', () => {
  for (const durability of ['pending', 'mixed', 'durable']) {
    it(`keeps one replacement and streaming FIFO across ${durability} durability`, async () => {
      await withNativeClearFixture(async (fixture) => {
        const { history } = fixture;
        const retained = [batchRow(0), batchRow(1)];
        history.setBaseTokenOffset(37);
        history.setCacheAnchorSeq(1);
        await prepareDurability(fixture, durability, retained);
        await failedRebuild(fixture, retained, batchRow(2), []);
        expect(history.getTotalTokens()).toBe(37 + 3 * 4);
        expect(history.getBaseTokenOffset()).toBe(37);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(history.getContextRange().totalEntries).toBe(3);
        expect(history.getContextRange().removedInterior).toStrictEqual([]);
      });
    });
  }
});

describe('native standalone clear observer failure', () => {
  it('restores held rows and token work while propagating the same exception', async () => {
    await withNativeClearFixture(async (fixture) => {
      const { history } = fixture;
      const retained = [batchRow(0), batchRow(1)];
      fixture.pauseWriter();
      history.addAll(retained);
      await fixture.waitForPausedWrite;
      const failure = new Error('native standalone clear observer failed');
      rejectNextClear(history, failure, []);
      const cleared = history.clear();
      fixture.releaseWriter();
      await expect(cleared).rejects.toBe(failure);
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      expect(await collectRawHistory(history)).toStrictEqual(retained);
      await fixture.assertDurable(retained);
      expect(history.getTotalTokens()).toBe(2 * 4);
      expect(history.getContextRange().removedInterior).toStrictEqual([]);
    });
  });
});

describe('native compression rebuild clear media settlement', () => {
  it('releases only removed media after failed clear, rebuild and streaming publication', async () => {
    await withNativeClearMediaFixture(async (fixture, store) => {
      const { history } = fixture;
      const [kept, removed] = await removalReferences(store);
      const retained = removalRow(0, kept);
      await history.addBatch([retained, removalRow(1, removed)]);
      await failedRebuild(fixture, [retained], batchRow(2), []);
      await history.waitForOwnershipSettlement();
      expect(await store.hasReservations(kept.contentId)).toBe(true);
      expect(await store.hasReservations(removed.contentId)).toBe(false);
      expect(history.getTotalTokens()).toBe(2 * 4);
    });
  });
});
