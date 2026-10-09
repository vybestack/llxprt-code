/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/addbatch-stream-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { applyPendingWindowFallback } from '../pendingWindowFallback.js';

function mediaDeps(
  history: Parameters<
    Parameters<typeof withValueTransformFixture>[0]
  >[0]['history'],
  rows: DetachedHistoryJournal,
  ready: ReturnType<typeof batchGate>,
  release: ReturnType<typeof batchGate>,
  failure?: Error,
): Parameters<typeof applyPendingWindowFallback>[0] {
  return {
    historyService: history,
    getRuntimeModel: () => 'test',
    getLastPromptTokenCount: () => 0,
    resetLastPromptTokenCount: () => {},
    restoreLastPromptTokenCount: () => {},
    performFallbackCompression: async (_prompt, install) => {
      await install({ rows, start: 0, hasPendingRows: false });
      ready.resolve();
      await release.promise;
      if (failure !== undefined) throw failure;
      return true;
    },
  };
}

async function* mediaRows(
  size: number,
  media: MediaReferenceBlock,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) {
    const row = suffixRow(index, 2048);
    yield { ...row, blocks: [...row.blocks, media] };
  }
}

async function run(size: number, rollback: boolean): Promise<number> {
  const root = await mkdtemp(join(process.cwd(), 'tmp/fallback-media-'));
  const store = new LocalMediaStore({ rootDirectory: root, quotaBytes: 1024 });
  const owner = new HistoryMediaOwnership(store);
  try {
    const prior = await store.admit({
      bytes: new Uint8Array([1]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const next = await store.admit({
      bytes: new Uint8Array([2]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    return await withValueTransformFixture(async (fixture) => {
      const { history, recorder, owners } = fixture;
      history.registerMediaOwner(owner);
      await history.detachedValues.replace(mediaRows(size, prior));
      const before = await detachedDigest(mediaRows(size, prior));
      const expected = await detachedDigest(mediaRows(size, next));
      const rows = new DetachedHistoryJournal(owners);
      const ready = batchGate();
      const release = batchGate();
      const failure = new Error('fallback media rollback');
      try {
        for await (const row of mediaRows(size, next)) rows.append(row);
        fixture.pauseWriter();
        const operation = rejectedValue(
          applyPendingWindowFallback(
            mediaDeps(
              history,
              rows,
              ready,
              release,
              rollback ? failure : undefined,
            ),
            'fallback-media',
            0,
          ).then(() => {}),
        );
        try {
          await fixture.writerPaused;
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          fixture.releaseWriter();
          await ready.promise;
          expect(await store.hasReservations(prior.contentId)).toBe(false);
          expect(await store.hasReservations(next.contentId)).toBe(true);
          release.resolve();
          expect(await operation).toBe(rollback ? failure : undefined);
          expect(await store.hasReservations(prior.contentId)).toBe(rollback);
          expect(await store.hasReservations(next.contentId)).toBe(!rollback);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(
            rollback ? before : expected,
          );
          expect(history.getTotalTokens()).toBe(size);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          return size;
        } finally {
          fixture.releaseWriter();
          release.resolve();
        }
      } finally {
        rows.close();
      }
    });
  } finally {
    await owner.releaseAll();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe('fallback value serialization and media', () => {
  for (const size of [512, 8192])
    for (const rollback of [false, true])
      it(`preserves real media reservations across ${size}-row fallback, rollback=${rollback}`, async () => {
        expect(await run(size, rollback)).toBe(size);
      }, 180_000);
});
