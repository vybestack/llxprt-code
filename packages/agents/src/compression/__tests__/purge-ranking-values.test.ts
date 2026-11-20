/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  rejectedValue,
  expectedRange,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  withValueTransformFixture,
  transformProbes,
  pauseTransformFinalization,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  PURGED_IMAGE_BLOCK,
  purgeRankingRows,
  purgeRankingRow,
  prepareValueRoute,
  type ValueRoute,
} from './purge-ranking-value-helpers.js';

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The wall-clock time a remove purge stamped on the reference it left in row
 * 0; the ranking route drops nothing.
 */
async function droppedAtOf(
  history: HistoryService,
  route: ValueRoute,
): Promise<string | undefined> {
  if (route !== 'purge') return undefined;
  for await (const row of history.streamRawHistory()) {
    if (row.blocks.length <= PURGED_IMAGE_BLOCK)
      throw new Error(`Row 0 has no block ${PURGED_IMAGE_BLOCK}`);
    const block = row.blocks[PURGED_IMAGE_BLOCK];
    if (block.type !== 'media_dropped')
      throw new Error(`Expected a dropped image, found ${block.type}`);
    expect(block.droppedAt).toMatch(ISO_TIME);
    return block.droppedAt;
  }
  throw new Error('History has no rows');
}

async function observeRoute(
  route: ValueRoute,
  size: number,
  rollback: boolean,
): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(route, size, owners, probes);
    await history.detachedValues.replace(
      probedTransformInput(size, purgeRankingRow, owners, probes),
    );
    const before = await detachedDigest(purgeRankingRows(size));
    expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
    const beforeTokens = size * 2 + 1000;
    // The image costs 1000; the media_dropped reference left in its place is
    // one text part, which exactTokenizer counts as 1.
    const purgedTokens = size * 2 + 1;
    const beforeRange = expectedRange(size);
    expect(history.getTotalTokens()).toBe(beforeTokens);
    expect(history.getContextRange()).toStrictEqual(beforeRange);
    const prepared = await prepareValueRoute(history, route, size, owners);
    const failure = new Error('value route finalization failure');
    const finalization = await pauseTransformFinalization(
      history,
      rollback ? failure : undefined,
    );
    fixture.pauseWriter(size);
    try {
      const operation = rejectedValue(
        prepared.execute().then((result) => {
          expect(result).toBe(true);
        }),
      );
      await Promise.race([
        fixture.writerPaused,
        operation.then((result) => {
          throw new Error(`Route ended before writer pause: ${String(result)}`);
        }),
      ]);
      await sample('writer-paused');
      expect(owners.snapshot().liveRows).toBe(0);
      await Promise.resolve(fixture.releaseWriter());
      await finalization.acknowledged;
      await sample('acknowledged');
      const expected = await detachedDigest(
        purgeRankingRows(size, 2048, route, await droppedAtOf(history, route)),
      );
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDigest(fixture.primaryRows())).toStrictEqual(
        expected,
      );
      expect(history.getTotalTokens()).toBe(
        route === 'purge' ? purgedTokens : beforeTokens,
      );
      expect(history.getContextRange()).toStrictEqual(expectedRange(size));
      await Promise.resolve(finalization.release());
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      const restored = rollback ? before : expected;
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        restored,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(restored);
      const successfulTokens = route === 'purge' ? purgedTokens : beforeTokens;
      expect(history.getTotalTokens()).toBe(
        rollback ? beforeTokens : successfulTokens,
      );
      if (rollback)
        expect(history.getContextRange()).toStrictEqual(beforeRange);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return restored.count;
    } finally {
      await Promise.resolve(fixture.releaseWriter());
      await Promise.resolve(finalization.release());
      await prepared.close();
    }
  });
}

describe('real semantic purge and ranked rewrite detached value publication', () => {
  for (const route of ['purge', 'ranking'] satisfies ValueRoute[]) {
    for (const size of [65]) {
      for (const rollback of [false, true]) {
        it(`${route} releases original rows/markers through writer, acknowledgement and rollback=${rollback} at ${size}`, async () => {
          expect(await observeRoute(route, size, rollback)).toBe(size);
        }, 120_000);
      }
    }
  }
});
