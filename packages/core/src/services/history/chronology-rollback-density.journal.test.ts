/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { withDetachedMedia } from './__tests__/support/detached-media-fixture.js';
import {
  exactTokenizer,
  expectedRange,
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';

const stages = ['tokenizer', 'prepare'];

describe('native density chronology before publication', () => {
  it.each(stages)(
    'preserves original replacement marker identity after %s failure',
    async (stage) => {
      await withDetachedMedia(async (_store, owner) => {
        await withNativeDetachedFixture(
          async ({ history, durable, owners }) => {
            const baseline = Array.from({ length: 3 }, (_, index) => ({
              ...rollbackRow(index),
              metadata: {
                chronology: {
                  seq: index + 1,
                  userTurn: 1,
                  step: index + 1,
                  recordedAt: 42,
                },
              },
            }));
            await history.addBatch(baseline);
            await history.registerMediaOwner(owner);
            const marker = { seq: 700, userTurn: 90, step: 3, recordedAt: 0 };
            const replacement = {
              ...rollbackRow(3),
              metadata: { chronology: marker },
            };
            const failure = new Error('density tokenizer');
            if (stage === 'tokenizer')
              history.setTokenizerFactory(
                exactTokenizer(() => {
                  throw failure;
                }),
              );
            else owner.stage = 'prepare';
            expect(
              await rejectedValue(
                history.applyDensityResult({
                  removals: [2],
                  replacements: new Map([[1, replacement]]),
                  metadata: {
                    readWritePairsPruned: 0,
                    fileDeduplicationsPruned: 0,
                    recencyPruned: 1,
                  },
                }),
              ),
            ).toBe(stage === 'prepare' ? owner.failure : failure);
            expect(await rowsOf(history)).toStrictEqual(baseline);
            expect(await durable()).toStrictEqual(
              await detachedDigest(
                (async function* () {
                  yield* baseline;
                })(),
              ),
            );
            expect(history.getTotalTokens()).toBe(12);
            expect(history.getContextRange()).toStrictEqual(expectedRange(3));
            expect(replacement.metadata.chronology).toBe(marker);
            expect(owners.snapshot().liveRows).toBe(0);
            owner.stage = undefined;
            history.setTokenizerFactory(exactTokenizer());
            const following = rollbackRow(3);
            await history.addBatch([following]);
            expect((await rowsOf(history))[3].metadata?.chronology?.seq).toBe(
              4,
            );
            expect(following.metadata).toBeUndefined();
          },
        );
      });
    },
  );
});
