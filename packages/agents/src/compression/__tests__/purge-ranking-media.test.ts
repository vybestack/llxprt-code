/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  purgeRankingRows,
  prepareValueRoute,
  type ValueRoute,
} from './purge-ranking-value-helpers.js';

async function* referenceRows(
  size: number,
  media: MediaReferenceBlock,
): AsyncGenerator<IContent, void, unknown> {
  let index = 0;
  for await (const row of purgeRankingRows(size)) {
    yield index++ !== 0
      ? row
      : { ...row, blocks: [...row.blocks.slice(0, 3), media] };
  }
}

async function mediaRoute(
  route: ValueRoute,
  size: number,
  rollback: boolean,
): Promise<number> {
  const root = await mkdtemp(join(process.cwd(), 'tmp/purge-ranking-media-'));
  const store = new LocalMediaStore({ rootDirectory: root, quotaBytes: 1024 });
  const owner = new HistoryMediaOwnership(store);
  try {
    const media = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    return await withValueTransformFixture(async (fixture) => {
      const { history, recorder, owners } = fixture;
      history.registerMediaOwner(owner);
      await history.detachedValues.replace(referenceRows(size, media));
      const before = await detachedDigest(referenceRows(size, media));
      const tokens = size * 2 + 1000;
      expect(history.getTotalTokens()).toBe(tokens);
      expect(await store.hasReservations(media.contentId)).toBe(true);
      const prepared = await prepareValueRoute(history, route, size, owners);
      const failure = new Error('media finalization failed');
      history.registerMediaOwner({
        adopt: (rows) => owner.adopt(rows),
        reconcile: (rows, next) => owner.reconcile(rows, next),
        releaseAll: () => owner.releaseAll(),
        prepareReplacement: async (input) => {
          const effect = owner.prepareReplacement(input);
          return {
            publish: () => effect.publish(),
            rollback: () => effect.rollback(),
            finalize: async () => {
              if (rollback) throw failure;
              await effect.finalize?.();
            },
          };
        },
      });
      fixture.pauseWriter();
      try {
        const operation = rejectedValue(prepared.execute().then(() => {}));
        await Promise.race([
          fixture.writerPaused,
          operation.then((result) => {
            throw new Error(
              `Media route ended before pause: ${String(result)}`,
            );
          }),
        ]);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        fixture.releaseWriter();
        expect(await operation).toBe(rollback ? failure : undefined);
        expect(await store.hasReservations(media.contentId)).toBe(
          route === 'ranking' || rollback,
        );
        if (rollback) {
          expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
          expect(history.getTotalTokens()).toBe(tokens);
        } else if (route === 'purge')
          expect(history.getTotalTokens()).toBe(size * 2);
        expect(owners.snapshot().liveRows).toBe(0);
        return size;
      } finally {
        fixture.releaseWriter();
        prepared.close();
      }
    });
  } finally {
    await owner.releaseAll();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe('purge and ranking real media reservations', () => {
  for (const route of ['purge', 'ranking'] satisfies ValueRoute[])
    for (const size of [512, 8192])
      for (const rollback of [false, true])
        it(`${route} retains or releases image reservations at ${size}, rollback=${rollback}`, async () => {
          expect(await mediaRoute(route, size, rollback)).toBe(size);
        }, 180_000);
});
