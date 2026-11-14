/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

function marked(index: number, seq: number): IContent {
  return {
    ...batchRow(index),
    metadata: { chronology: { seq, userTurn: 1, step: 0, recordedAt: 0 } },
  };
}

describe('bounded density publication preserves addressed rows', () => {
  it('publishes 128 replacements and releases every live row', async () => {
    await withNativeDetachedFixture(async ({ history, owners, durable }) => {
      const originals = Array.from({ length: 128 }, (_, index) =>
        batchRow(index),
      );
      await history.detachedValues.replace(
        (async function* () {
          yield* originals;
        })(),
      );
      const replacements = originals.map(
        (row, index): IContent => ({
          ...row,
          blocks: [{ type: 'text', text: `changed:${index}` }],
        }),
      );
      await history.applyDensityResult({
        replacements: new Map(replacements.map((row, index) => [index, row])),
        removals: [],
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
      });
      expect(await rowsOf(history)).toStrictEqual(replacements);
      expect((await durable()).count).toBe(128);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
      expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
    });
  });

  for (const removed of [0, 1]) {
    it(`removes only addressed duplicate chronology row ${removed}`, async () => {
      await withNativeDetachedFixture(async ({ history }) => {
        await history.addBatch([marked(0, 7), marked(1, 7)]);
        const replacement = marked(2, 99);
        await history.applyDensityResult({
          removals: [removed],
          replacements: new Map([[1 - removed, replacement]]),
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 1,
          },
        });
        expect(await rowsOf(history)).toStrictEqual([marked(2, 7)]);
        expect(replacement.metadata?.chronology?.seq).toBe(99);
      });
    });
  }

  it('releases the in-flight row and preserves all values when publication is abandoned', async () => {
    await withNativeDetachedFixture(async ({ history, owners, durable }) => {
      await history.detachedValues.replace(
        (async function* () {
          for (let index = 0; index < 128; index++) yield batchRow(index);
        })(),
      );
      const before = await rowsOf(history);
      const failure = new Error('abandoned density publication');
      expect(
        await rejectedValue(
          history.detachedValues.transform(async (source, sink) => {
            for await (const row of source.streamRows()) {
              await sink.appendReplacement(0, {
                ...row,
                blocks: [{ type: 'text', text: 'abandoned' }],
              });
              throw failure;
            }
          }),
        ),
      ).toBe(failure);
      expect(await rowsOf(history)).toStrictEqual(before);
      expect((await durable()).count).toBe(128);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
    });
  });
});
