/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  journalMediaParticipant,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
} from './detached-rollback-test-helpers.js';

describe('detached cancellation during participant finalization', () => {
  it('restores rows, tokens, and mirrors when finalization settles after cancellation', async () => {
    await withNativeDetachedFixture(async ({ history, recording, owners }) => {
      await history.detachedValues.replace(detachedRows(3));
      const controller = new AbortController();
      const failure = new Error('cancel during finalization');
      await history.registerMediaOwner(
        journalMediaParticipant(() => ({
          publish: () => undefined,
          finalize: async () => {
            controller.abort(failure);
            await Promise.resolve();
          },
          rollback: () => undefined,
        })),
      );
      expect(
        await rejectedValue(
          history.detachedValues.replace(detachedRows(1), undefined, {
            signal: controller.signal,
          }),
        ),
      ).toBe(failure);
      const expected = await detachedDigest(detachedRows(3));
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recording)).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(12);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
