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
import type { IContent } from './IContent.js';

const stages = [
  'tokenizer',
  'prepare',
  'publish',
  'contentBatchAdded',
  'tokensUpdated',
  'afterPublication',
  'finalize',
  'contextRangeChanged',
];
const cases = [false, true].flatMap((pending) =>
  stages.map((stage) => ({ pending, stage })),
);

function marked(index: number): IContent {
  return {
    ...rollbackRow(index),
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: 1,
        step: index + 1,
        recordedAt: 42,
      },
    },
  };
}

async function stageFailure(pending: boolean, stage: string): Promise<void> {
  await withDetachedMedia(async (store, owner) => {
    await withNativeDetachedFixture(async (fixture) => {
      const { history, owners } = fixture;
      const image = await store.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const baseline = Object.freeze({
        ...marked(0),
        blocks: [...marked(0).blocks, image],
        metadata: Object.freeze(marked(0).metadata),
      });
      await history.registerMediaOwner(owner);
      if (pending) fixture.pauseWriter();
      const adding = history.addBatch([baseline]);
      if (pending) await fixture.writerPaused;
      else await adding;
      const failure = new Error(stage);
      const fail = (): never => {
        throw failure;
      };
      if (stage === 'tokenizer')
        history.setTokenizerFactory(exactTokenizer(fail));
      const arm = (): void => {
        owner.stage = stage;
        if (
          stage === 'contentBatchAdded' ||
          stage === 'tokensUpdated' ||
          stage === 'contextRangeChanged'
        )
          history.once(stage, fail);
      };
      if (pending) history.once('contextRangeChanged', arm);
      else arm();
      const fresh = rollbackRow(1);
      const frozen = {
        ...rollbackRow(2),
        metadata: Object.freeze({ turnId: 'frozen' }),
      };
      let reached = false;
      const operation = rejectedValue(
        history.replaceBatch([fresh, frozen], undefined, {
          afterPublication: () => {
            reached = true;
            if (stage === 'afterPublication') fail();
          },
        }),
      );
      if (pending) expect(reached).toBe(false);
      fixture.releaseWriter();
      await adding;
      expect(await operation).toBe(
        ['prepare', 'publish', 'finalize'].includes(stage)
          ? owner.failure
          : failure,
      );
      expect(await rowsOf(history)).toStrictEqual([baseline]);
      expect(await fixture.durable()).toStrictEqual(
        await detachedDigest(
          (async function* () {
            yield baseline;
          })(),
        ),
      );
      expect(history.getTotalTokens()).toBe(1004);
      expect(history.getContextRange()).toStrictEqual(expectedRange(1));
      expect(fresh.metadata).toBeUndefined();
      expect(frozen.metadata).toStrictEqual({ turnId: 'frozen' });
      expect(Object.isFrozen(baseline)).toBe(true);
      expect(await store.hasReservations(image.contentId)).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      owner.stage = undefined;
      history.setTokenizerFactory(exactTokenizer());
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect((await rowsOf(history))[1].metadata?.chronology).toMatchObject({
        seq: 2,
        userTurn: 2,
        step: 1,
      });
      expect(following.metadata).toBeUndefined();
    });
  });
}

describe('native replaceBatch chronology stage rollback', () => {
  it.each(cases)(
    'restores pending=$pending frozen membership, media and counters after $stage',
    async ({ pending, stage }) => {
      await expect(stageFailure(pending, stage)).resolves.toBeUndefined();
    },
  );

  it('preserves the primary and participant compensation errors in order', async () => {
    await withDetachedMedia(async (_store, owner) => {
      await withNativeDetachedFixture(async ({ history, durable, owners }) => {
        const baseline = marked(0);
        await history.addBatch([baseline]);
        await history.registerMediaOwner(owner);
        owner.stage = 'publish';
        const rollback = new Error('participant rollback');
        owner.rollbackFailure = rollback;
        const caller = rollbackRow(1);
        const result = await rejectedValue(history.replaceBatch([caller]));
        expect(result).toBeInstanceOf(AggregateError);
        if (!(result instanceof AggregateError))
          throw new Error('Missing aggregate');
        expect(result.message).toBe('History mutation and rollback failed');
        expect(result.errors).toStrictEqual([owner.failure, rollback]);
        expect(await rowsOf(history)).toStrictEqual([baseline]);
        expect((await durable()).count).toBe(1);
        expect(caller.metadata).toBeUndefined();
        expect(owners.snapshot().liveRows).toBe(0);
        owner.rollbackFailure = undefined;
      });
    });
  });

  it.each([512, 8192])(
    'preserves callback marker edits and reclaims chronology for %i media/tool rows',
    async (size) => {
      await withNativeDetachedFixture(async ({ history, durable, owners }) => {
        const baseline = marked(0);
        await history.addBatch([baseline]);
        const marker = { seq: 9000, userTurn: 6000, step: 4, recordedAt: 0 };
        const preserved = {
          ...rollbackRow(size),
          metadata: { chronology: marker, turnId: 'preserved' },
        };
        const fresh = Array.from({ length: size }, (_, index) =>
          rollbackRow(index),
        );
        const failure = new Error('late callback');
        expect(
          await rejectedValue(
            history.replaceBatch([...fresh, preserved, fresh[0]], undefined, {
              afterPublication: () => {
                preserved.metadata.chronology = { ...marker, seq: 10000 };
                throw failure;
              },
            }),
          ),
        ).toBe(failure);
        expect(await rowsOf(history)).toStrictEqual([baseline]);
        expect(await durable()).toStrictEqual(
          await detachedDigest(
            (async function* () {
              yield baseline;
            })(),
          ),
        );
        expect(preserved.metadata.chronology).toStrictEqual({
          ...marker,
          seq: 10000,
        });
        expect(fresh.every((row) => row.metadata === undefined)).toBe(true);
        expect(owners.snapshot().liveRows).toBe(0);
        const following = rollbackRow(size + 1);
        await history.addBatch([following]);
        expect((await rowsOf(history))[1].metadata?.chronology?.seq).toBe(2);
        expect(following.metadata).toBeUndefined();
      });
    },
    120_000,
  );
});
