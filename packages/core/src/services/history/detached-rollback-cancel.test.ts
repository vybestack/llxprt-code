/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';
import {
  detachedRow,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';

describe('detached cancellation before mutation', () => {
  it('aborts without waiting for an original writer ack and leaves the journaled row intact', async () => {
    await withDetachedFixture(
      async ({ history, owners, releaseWriter, writerPaused }) => {
        history.add(detachedRow(0));
        await writerPaused;
        const controller = new AbortController();
        const failure = new Error('cancel pending acquisition');
        const operation = rejectedValue(
          history.detachedValues.transform(
            async (source, sink) => {
              for await (const row of source.streamRows())
                await sink.appendValue(row);
            },
            undefined,
            { signal: controller.signal },
          ),
        );
        try {
          await setImmediate();
          controller.abort(failure);
          const result = await Promise.race([
            operation,
            setTimeout(1000, 'writer still pinned'),
          ]);
          expect(result).toBe(failure);
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          releaseWriter();
          await operation;
        }
        expect(await rowsOf(history)).toStrictEqual([detachedRow(0)]);
      },
      true,
    );
  });
});
