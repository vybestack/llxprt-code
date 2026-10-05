/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import {
  mediaParticipant,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import {
  bindingBridgeRow,
  bindingBridgeRows,
  bindingContentId,
  bindingFile,
  forbidLegacyBindingTransform,
} from './provider-binding-bridge-test-helpers.js';
import type { RowOwnershipStats } from '../../recording/rowOwnership.js';

async function pendingBinding(size: number): Promise<number> {
  return withDetachedFixture(
    async ({ history, recorder, owners, releaseWriter }) => {
      for (let index = 0; index < size; index++)
        history.add(bindingBridgeRow(index));
      await history.waitForTokenUpdates();
      let acknowledged: RowOwnershipStats | undefined;
      const failure = new Error('pending binding finalization');
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => undefined,
          rollback: () => undefined,
          finalize: () => {
            acknowledged = owners.snapshot();
            throw failure;
          },
        })),
      );
      forbidLegacyBindingTransform(history);
      const operation = rejectedValue(
        createHistoryProviderFileBindingStore(history).bind(
          bindingContentId,
          bindingFile,
        ),
      );
      try {
        while (owners.snapshot().liveRows < size) await setImmediate();
        expect(owners.snapshot().liveRows).toBeGreaterThanOrEqual(size);
        expect(owners.snapshot().liveSerializedBytes).toBeGreaterThan(
          size * 2048,
        );
        releaseWriter();
        expect(await operation).toBe(failure);
        if (acknowledged === undefined)
          throw new Error('Missing binding acknowledgement');
        expect(acknowledged.liveRows).toBeLessThanOrEqual(440);
        expect(acknowledged.liveSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
        const expected = await detachedDigest(bindingBridgeRows(size));
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(size * 4);
        expect(owners.snapshot().liveRows).toBe(0);
        return expected.count;
      } finally {
        releaseWriter();
        await operation;
      }
    },
    true,
  );
}
describe('production binding of pending detached source values', () => {
  for (const size of [512, 8192])
    it(`charges all ${size} pending values until their writer acknowledges then releases them before rollback`, async () => {
      expect(await pendingBinding(size)).toBe(size);
    }, 180_000);
});
