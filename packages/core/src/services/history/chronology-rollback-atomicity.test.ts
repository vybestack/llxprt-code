/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  durableRowsOf,
  exactTokenizer,
  expectedRange,
  journalMediaParticipant,
  rejectedValue,
  rollbackRow,
  rowBodies,
  rowsOf,
} from './chronology-rollback-test-helpers.js';

const stages = [
  'tokenizer',
  'prepare',
  'publish',
  'records',
  'trailer',
  'contentBatchAdded',
  'tokensUpdated',
  'afterPublication',
  'finalize',
  'contextRangeChanged',
];

describe('chronology rollback across journal mutation stages', () => {
  for (const stage of stages) {
    it(`restores membership, caller metadata and chronology after ${stage} failure`, async () => {
      await withNativeDetachedFixture(async ({ history, recording, io }) => {
        await history.addBatch([rollbackRow(0)]);
        const before = await rowsOf(history);
        const failure = new Error(`injected ${stage} failure`);
        let injected = false;
        const fail = (): void => {
          if (injected) return;
          injected = true;
          throw failure;
        };
        let ownership = 'baseline';
        await history.registerMediaOwner({
          ...journalMediaParticipant(() => {
            if (stage === 'prepare') fail();
            return {
              publish: () => {
                ownership = 'replacement';
                if (stage === 'publish') fail();
              },
              rollback: () => {
                ownership = 'baseline';
              },
              finalize: () => {
                if (stage === 'finalize') fail();
              },
            };
          }),
          reconcile: async () => {
            ownership = 'baseline';
          },
        });
        if (stage === 'tokenizer')
          history.setTokenizerFactory(exactTokenizer(fail));
        if (stage === 'records' || stage === 'trailer')
          io.rejectNextWrite(failure, stage);
        if (
          stage === 'contentBatchAdded' ||
          stage === 'tokensUpdated' ||
          stage === 'contextRangeChanged'
        )
          history.once(stage, fail);
        const fresh = rollbackRow(1);
        const metadataOnly = {
          ...rollbackRow(2),
          metadata: Object.freeze({ turnId: 'existing-metadata' }),
        };
        expect(
          await rejectedValue(
            history.replaceBatch([fresh, metadataOnly], undefined, {
              afterPublication: () => {
                if (stage === 'afterPublication') fail();
              },
            }),
          ),
        ).toBe(failure);
        expect(await rowsOf(history)).toStrictEqual(before);
        expect(history.getTotalTokens()).toBe(4);
        expect(history.getContextRange()).toStrictEqual(expectedRange(1));
        expect(fresh.metadata).toBeUndefined();
        expect(metadataOnly.metadata).toStrictEqual({
          turnId: 'existing-metadata',
        });
        expect(ownership).toBe('baseline');
        await history.waitForCommit();
        expect(await durableRowsOf(recording)).toStrictEqual(before);
        history.setTokenizerFactory(exactTokenizer());
        if (stage === 'records' || stage === 'trailer') return;
        await history.addBatch([rollbackRow(3)]);
        expect((await rowsOf(history))[1].metadata?.chronology).toMatchObject({
          seq: 2,
          userTurn: 2,
          step: 1,
        });
      });
    });
  }

  it('preserves the primary failure and ownership rollback failure in order', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      const primary = new Error('publication failure');
      const rollback = new Error('ownership rollback failure');
      await history.registerMediaOwner(
        journalMediaParticipant(() => ({
          publish: () => {
            throw primary;
          },
          rollback: () => {
            throw rollback;
          },
        })),
      );
      const row = rollbackRow(0);
      const error = await rejectedValue(history.addBatch([row]));
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing aggregate failure');
      expect(error.errors).toStrictEqual([primary, rollback]);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(row.metadata).toBeUndefined();
    });
  });

  for (const size of [512, 8192]) {
    it(`restores durable state for ${size} media/tool values without undoing caller callback mutations`, async () => {
      await withNativeDetachedFixture(async ({ history, recording }) => {
        await history.addBatch([rollbackRow(0)]);
        const before = await rowsOf(history);
        const marker = { seq: 9000, userTurn: 6000, step: 4, recordedAt: 0 };
        const preserved = {
          ...rollbackRow(size),
          metadata: { chronology: marker, turnId: 'preserved' },
        };
        const fresh = Array.from({ length: size }, (_, index) =>
          rollbackRow(index),
        );
        const primary = new Error('late publication failure');
        expect(
          await rejectedValue(
            history.replaceBatch([...fresh, preserved, fresh[0]], undefined, {
              afterPublication: () => {
                preserved.metadata.chronology = { ...marker, seq: 10000 };
                throw primary;
              },
            }),
          ),
        ).toBe(primary);
        expect(await rowsOf(history)).toStrictEqual(before);
        expect(preserved.metadata.chronology).toStrictEqual({
          ...marker,
          seq: 10000,
        });
        expect(fresh.every((row) => row.metadata === undefined)).toBe(true);
        await history.waitForCommit();
        expect(await durableRowsOf(recording)).toStrictEqual(before);
        await history.addBatch([rollbackRow(size + 1)]);
        expect((await rowsOf(history))[1].metadata?.chronology?.seq).toBe(2);
        expect(rowBodies(before)).toStrictEqual(rowBodies([rollbackRow(0)]));
      });
    }, 180_000);
  }
});
