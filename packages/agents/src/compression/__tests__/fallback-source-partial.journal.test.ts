/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { transformFixtureRows } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  fallbackHarness,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';

async function partialSourceFailure(size: number): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    await history.detachedValues.replace(transformFixtureRows(size));
    const before = await compressionValueDigest(transformFixtureRows(size));
    history.setBaseTokenOffset(37);
    history.setCacheAnchorSeq(1);
    const rows = new DetachedHistoryJournal(owners);
    rows.append(suffixRow(size));
    rows.append(suffixRow(size + 1));
    const projectionFailure = new Error(
      'projection after rejected partial fallback',
    );
    let attempted = false;
    const harness = fallbackHarness(history, async (_prompt, install) => {
      const failure = fixture.failAdmissionAfter(1);
      const rejected = await rejectedValue(
        install({ rows, start: 0, hasPendingRows: true }),
      );
      expect(rejected).toBe(failure);
      attempted = true;
      throw rejected;
    });
    const enclosing = {
      ...harness,
      estimate: async (): Promise<number> => {
        if (attempted) throw projectionFailure;
        return 150_000;
      },
    };
    try {
      const error = await rejectedValue(
        enforceFallback(enclosing).then(() => {}),
      );
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error))
        throw new Error('Missing source stage error');
      expect(error.message).toBe(
        `Token projection failed at post-truncation stage during provider-content hard-limit enforcement: ${projectionFailure.message}`,
      );
      expect(error.cause).toBe(projectionFailure);
      history.setTokenizerFactory(exactTokenizer());
      expect(await durable()).toStrictEqual(before);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(size * 3 + 37);
      expect(history.getBaseTokenOffset()).toBe(37);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(harness.baseline()).toBe(123);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
    } finally {
      rows.close();
    }
  });
}

describe('native source enforcement partial fallback admission', () => {
  for (const size of [65]) {
    it(`restores ${size} complete rows and baseline after partial admission with the post-truncation cause intact`, async () => {
      await expect(partialSourceFailure(size)).resolves.toBeUndefined();
    }, 180_000);
  }
});
