/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setTimeout } from 'node:timers/promises';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
async function* values(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, bytes);
}
async function cancelled(kind: 'checkpoint' | 'transform'): Promise<void> {
  await withNativeDetachedFixture(async (fixture) => {
    const { history, owners } = fixture;
    fixture.pauseWriter();
    history.add(suffixRow(0));
    const controller = new AbortController();
    const failure = new Error('cancel pending native acquisition');
    let reached = false;
    const consume = async (): Promise<void> => {
      reached = true;
    };
    const operation = rejectedValue(
      kind === 'checkpoint'
        ? history.detachedValues.withCheckpoint(consume, controller.signal)
        : history.detachedValues.transform(consume, undefined, {
            signal: controller.signal,
          }),
    );
    try {
      await fixture.writerPaused;
      controller.abort(failure);
      expect(
        await Promise.race([
          operation,
          setTimeout(1000, 'writer still pinned'),
        ]),
      ).toBe(failure);
      expect(reached).toBe(false);
      expect(owners.snapshot().liveRows).toBe(0);
    } finally {
      fixture.releaseWriter();
      await operation;
    }
    await history.waitForCommit();
    expect(await fixture.durable()).toStrictEqual(
      await detachedDigest(values(1, 0)),
    );
    await history.detachedValues.replace(values(2));
    expect(await fixture.durable()).toStrictEqual(
      await detachedDigest(values(2)),
    );
    expect(history.getTotalTokens()).toBe(2);
  });
}

const kinds: Array<'checkpoint' | 'transform'> = ['checkpoint', 'transform'];
describe('native detached cancellation before mutation', () => {
  it('releases borrowed array inputs when capture is already cancelled', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      await fixture.history.detachedValues.replace(values(1));
      const failure = new Error('cancel before native array capture');
      const controller = new AbortController();
      controller.abort(failure);
      await expect(
        fixture.history.detachedValues.replace([suffixRow(0)], undefined, {
          signal: controller.signal,
        }),
      ).rejects.toBe(failure);
      expect(fixture.owners.snapshot().acquisitions).toBeGreaterThan(0);
      expect(fixture.owners.snapshot().liveRows).toBe(0);
      expect(fixture.owners.snapshot().liveSerializedBytes).toBe(0);
      expect(await fixture.durable()).toStrictEqual(
        await detachedDigest(values(1)),
      );
      await fixture.history.detachedValues.replace(values(2));
      expect(await fixture.durable()).toStrictEqual(
        await detachedDigest(values(2)),
      );
    });
  });
  it.each(kinds)(
    'cancels pending %s without waiting for the original writer acknowledgement, then reuses the service',
    async (kind) => {
      await expect(cancelled(kind)).resolves.toBeUndefined();
    },
    180_000,
  );
});
