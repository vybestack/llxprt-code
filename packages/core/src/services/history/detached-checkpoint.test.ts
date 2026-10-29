/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import {
  checkpointRows,
  type HistoryCheckpoint,
} from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';
import { withValueTransformFixture } from './transform-value-test-helpers.js';

async function* values(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, bytes);
}

describe('detached journal checkpoints', () => {
  for (const size of [512, 8192]) {
    it(`captures and restores all ${size} rows with pending writer backpressure`, async () => {
      await withValueTransformFixture(async (fixture) => {
        const { history, owners, recorder } = fixture;
        await history.detachedValues.replace(values(size));
        fixture.pauseWriter();
        history.add(suffixRow(size, 2048));
        history.add(suffixRow(size + 1, 2048));
        const ready = batchGate();
        const release = batchGate();
        let held: HistoryCheckpoint | undefined;
        let reached = false;
        const operation = rejectedValue(
          history.detachedValues.withCheckpoint(async (snapshot) => {
            held = snapshot;
            reached = true;
            ready.resolve();
            await release.promise;
            expect(
              await detachedDigest(checkpointRows(snapshot)),
            ).toStrictEqual(await detachedDigest(values(size + 2)));
            await history.detachedValues.replace(values(1));
            await history.detachedValues.replace(checkpointRows(snapshot));
          }),
        );
        try {
          await fixture.writerPaused;
          expect(reached).toBe(false);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          fixture.releaseWriter();
          await ready.promise;
          release.resolve();
          expect(await operation).toBeUndefined();
          expect(await detachedDurableDigest(recorder)).toStrictEqual(
            await detachedDigest(values(size + 2)),
          );
          expect(history.getTotalTokens()).toBe(size + 2);
          if (held === undefined) throw new Error('Missing checkpoint');
          await expect(checkpointRows(held).next()).rejects.toThrow(
            /closed|pin was released/,
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        } finally {
          fixture.releaseWriter();
          release.resolve();
          await operation;
        }
      });
    }, 180_000);
  }

  it('restores every byte of a checkpoint row larger than nine MiB', async () => {
    await withValueTransformFixture(async ({ history, recorder }) => {
      await history.detachedValues.replace(values(1, 9 * 1024 * 1024 + 1));
      const expected = await detachedDigest(values(1, 9 * 1024 * 1024 + 1));
      expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
      await history.detachedValues.withCheckpoint(async (snapshot) => {
        await history.detachedValues.replace(values(2));
        await history.detachedValues.replace(checkpointRows(snapshot));
      });
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
    });
  }, 180_000);

  it('cancels pending capture without invoking the checkpoint consumer', async () => {
    await withValueTransformFixture(async (fixture) => {
      const { history, owners } = fixture;
      fixture.pauseWriter();
      history.add(suffixRow(0));
      const controller = new AbortController();
      const failure = new DOMException('checkpoint cancelled', 'AbortError');
      let reached = false;
      const operation = rejectedValue(
        history.detachedValues.withCheckpoint(async () => {
          reached = true;
        }, controller.signal),
      );
      try {
        await fixture.writerPaused;
        controller.abort(failure);
        expect(await operation).toBe(failure);
        expect(reached).toBe(false);
        fixture.releaseWriter();
        await history.waitForCommit();
        expect(owners.snapshot().liveRows).toBe(0);
        await history.detachedValues.replace(values(2));
        expect(history.getTotalTokens()).toBe(2);
      } finally {
        fixture.releaseWriter();
        await operation;
      }
    });
  });
});
