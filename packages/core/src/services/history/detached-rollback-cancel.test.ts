/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate, setTimeout } from 'node:timers/promises';
import {
  withDetachedFixture,
  detachedRow,
} from './detached-rollback-test-helpers.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';

describe('detached cancellation before mutation', () => {
  it('releases its captured pending source on abort without waiting for an original writer ack', async () => {
    await withDetachedFixture(async ({ history, owners, releaseWriter }) => {
      history.add(detachedRow(0));
      await history.waitForTokenUpdates();
      const controller = new AbortController();
      const failure = new Error('cancel pending acquisition');
      const operation = rejectedValue(
        history.detachedValues.transform(
          async (source, sink) => {
            for await (const row of source.streamRows()) sink.appendValue(row);
          },
          undefined,
          { signal: controller.signal },
        ),
      );
      try {
        while (owners.snapshot().liveRows === 0) await setImmediate();
        await setImmediate();
        controller.abort(failure);
        const result = await Promise.race([
          operation,
          setTimeout(1000, 'writer still pinned'),
        ]);
        expect(result).toBe(failure);
        expect(owners.snapshot().liveRows).toBe(0);
        expect((await rowsOf(history))[0]).toStrictEqual(detachedRow(0));
      } finally {
        releaseWriter();
        await operation;
      }
    }, true);
  });
});
