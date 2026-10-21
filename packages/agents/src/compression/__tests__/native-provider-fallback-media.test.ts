/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './support/native-fallback-fixture.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

describe('indexed native fallback media compensation', () => {
  it('preserves removed media and the original finalization error through acknowledged rollback', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      const { history, durable } = fixture;
      const reference = await fixture.admit();
      await history.detachedValues.replace(
        Array.from({ length: 8 }, (_, index) =>
          index === 0
            ? {
                ...fallbackRow(index),
                blocks: [...fallbackRow(index).blocks, reference],
              }
            : fallbackRow(index),
        ),
      );
      await history.waitForCommit();
      const before = await compressionValueDigest(history.streamRawHistory());
      const tokens = history.getTotalTokens();
      const failure = new Error(
        'native indexed fallback media finalization failed',
      );
      await fixture.pauseFinalization(failure);
      const operation = rejectedValue(
        nativeFallback(history, 6).then(() => {}),
      );
      try {
        await reachesGate(fixture.acknowledged, operation);
        expect(await fixture.reserved(reference.contentId)).toBe(true);
        expect(fixture.owners.snapshot().liveRows).toBe(0);
        fixture.releaseFinalization();
        expect(await operation).toBe(failure);
        expect(await durable()).toStrictEqual(before);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(before);
        expect(history.getTotalTokens()).toBe(tokens);
        expect(await fixture.reserved(reference.contentId)).toBe(true);
        expect((await nativeFallback(history, 6)).outcome).toBe('applied');
        expect(await fixture.reserved(reference.contentId)).toBe(false);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
      } finally {
        fixture.releaseFinalization();
        await operation;
      }
    });
  }, 180_000);
});
