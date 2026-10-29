/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { withDetachedMedia } from './__tests__/support/detached-media-fixture.js';
import {
  exactTokenizer,
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';
import { checkpointRows } from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';

function toolRow(serialize: () => object): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'serialized',
        name: 'inspect',
        parameters: { toJSON: serialize },
      },
    ],
  };
}

function baselineRows(): IContent[] {
  return [0, 1].map((index) => ({
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
}

describe('native rollback snapshot serialization and lifetime', () => {
  it('keeps nested checkpoint reads alive until the final callback releases the disposed primary', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      const baseline = baselineRows();
      await history.addBatch(baseline);
      const expected = await detachedDigest(
        (async function* () {
          yield* baseline;
        })(),
      );
      await history.detachedValues.withCheckpoint(async (outer) => {
        await history.detachedValues.withCheckpoint(async (inner) => {
          await history.dispose();
          expect(await detachedDigest(checkpointRows(inner))).toStrictEqual(
            expected,
          );
        });
        expect(await detachedDigest(checkpointRows(outer))).toStrictEqual(
          expected,
        );
      });
    });
  });

  it('preserves callback then deferred descriptor-close errors in aggregate order', async () => {
    await withNativeDetachedFixture(async ({ history, session }) => {
      await history.addBatch(baselineRows());
      const primary = new Error('checkpoint callback');
      const cleanup = new Error('descriptor close');
      const close = session.close.bind(session);
      const closing = spyOn(session, 'close').mockImplementation(async () => {
        await close();
        throw cleanup;
      });
      try {
        const result = await rejectedValue(
          history.detachedValues.withCheckpoint(async () => {
            await history.dispose();
            throw primary;
          }),
        );
        expect(result).toBeInstanceOf(AggregateError);
        if (!(result instanceof AggregateError))
          throw new Error('Missing aggregate');
        expect(result.errors).toStrictEqual([primary, cleanup]);
      } finally {
        closing.mockRestore();
      }
    });
  });
  it('never reserializes admitted caller parameters when later media preparation fails', async () => {
    await withDetachedMedia(async (_store, owner) => {
      await withNativeDetachedFixture(async ({ history, durable }) => {
        let forbidden = false;
        const serializationFailure = new Error('previous serialization');
        const original = toolRow(() => {
          if (forbidden) throw serializationFailure;
          return { index: 0 };
        });
        await history.addBatch([original]);
        forbidden = true;
        await history.registerMediaOwner(owner);
        owner.stage = 'prepare';
        expect(
          await rejectedValue(history.replaceBatch([rollbackRow(1)])),
        ).toBe(owner.failure);
        const rows = await rowsOf(history);
        expect(rows).toHaveLength(1);
        expect(rows[0]).not.toBe(original);
        expect(rows[0].blocks).toStrictEqual([
          {
            type: 'tool_call',
            id: 'serialized',
            name: 'inspect',
            parameters: { index: 0 },
          },
        ]);
        expect((await durable()).count).toBe(1);
      });
    });
  });

  it.each([false, true])(
    'restores full values and fresh sequence after pending=$pending serialization failure',
    async (pending) => {
      await withNativeDetachedFixture(async (fixture) => {
        const { history, owners } = fixture;
        const baseline = baselineRows();
        if (pending) fixture.pauseWriter();
        const adding = history.addBatch(baseline);
        if (pending) await fixture.writerPaused;
        else await adding;
        const fresh = rollbackRow(2);
        const failure = new Error('serialization during admission');
        const bad = toolRow(() => {
          throw failure;
        });
        const operation = rejectedValue(
          (async () => {
            await history.replaceBatch([fresh, bad]);
          })(),
        );
        fixture.releaseWriter();
        await adding;
        expect(await operation).toBe(failure);
        expect(fresh.metadata).toBeUndefined();
        expect(bad.metadata).toBeUndefined();
        expect(await rowsOf(history)).toStrictEqual(baseline);
        expect(await fixture.durable()).toStrictEqual(
          await detachedDigest(
            (async function* () {
              yield* baseline;
            })(),
          ),
        );
        expect(history.getTotalTokens()).toBe(8);
        expect(owners.snapshot().liveRows).toBe(0);
        const following = rollbackRow(3);
        await history.addBatch([following]);
        expect((await rowsOf(history))[2].metadata?.chronology?.seq).toBe(3);
        expect(following.metadata).toBeUndefined();
      });
    },
  );

  it('leaves frozen metadata untouched when a later row token estimate fails and reclaims sequence one', async () => {
    await withNativeDetachedFixture(
      async ({ history, durable, owners, primaryRows }) => {
        const first = rollbackRow(0);
        const frozen = {
          ...rollbackRow(1),
          metadata: Object.freeze({ turnId: 'frozen' }),
        };
        const failure = new Error('later frozen estimate');
        let calls = 0;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (++calls === 5) throw failure;
          }),
        );
        expect(await rejectedValue(history.addBatch([first, frozen]))).toBe(
          failure,
        );
        expect(await rowsOf(history)).toStrictEqual([]);
        expect((await detachedDigest(primaryRows())).count).toBe(0);
        expect(history.getTotalTokens()).toBe(0);
        expect(first.metadata).toBeUndefined();
        expect(frozen.metadata).toStrictEqual({ turnId: 'frozen' });
        expect(owners.snapshot().liveRows).toBe(0);
        history.setTokenizerFactory(exactTokenizer());
        const following = rollbackRow(2);
        await history.addBatch([following]);
        expect((await rowsOf(history))[0].metadata?.chronology).toMatchObject({
          seq: 1,
          userTurn: 0,
          step: 1,
        });
        expect(following.metadata).toBeUndefined();
        expect((await durable()).count).toBe(1);
      },
    );
  });

  it('keeps captured acknowledged values readable after clear and service disposal', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      const baseline = baselineRows();
      await history.addBatch(baseline);
      const expected = await detachedDigest(
        (async function* () {
          yield* baseline;
        })(),
      );
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        await history.clear();
        await history.waitForCommit();
        await history.dispose();
        expect(checkpoint.length).toBe(2);
        expect(await detachedDigest(checkpointRows(checkpoint))).toStrictEqual(
          expected,
        );
        const reader = checkpointRows(checkpoint)[Symbol.asyncIterator]();
        expect((await reader.next()).value).toStrictEqual(baseline[0]);
        await reader.return();
      });
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('runs queued appends after observer compensation with reclaimed chronology and one copy per mirror row', async () => {
    await withNativeDetachedFixture(async ({ history, durable }) => {
      const baseline = baselineRows()[0];
      await history.addBatch([baseline]);
      const failure = new Error('observer failure');
      const failed = rollbackRow(1);
      const appended = rollbackRow(2);
      const last = rollbackRow(3);
      const queued: Array<Promise<void>> = [];
      history.once('contentBatchAdded', () => {
        queued.push(history.addBatch([appended]), history.addBatch([last]));
        throw failure;
      });
      expect(await rejectedValue(history.replaceBatch([failed]))).toBe(failure);
      await Promise.all(queued);
      const rows = await rowsOf(history);
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        baseline.blocks,
        appended.blocks,
        last.blocks,
      ]);
      expect(rows.map((row) => row.metadata?.chronology)).toMatchObject([
        { seq: 1, userTurn: 1, step: 1 },
        { seq: 2, userTurn: 1, step: 2 },
        { seq: 3, userTurn: 2, step: 1 },
      ]);
      expect(failed.metadata).toBeUndefined();
      expect(appended.metadata).toBeUndefined();
      expect(last.metadata).toBeUndefined();
      expect((await durable()).count).toBe(3);
      expect(history.getTotalTokens()).toBe(12);
    });
  });
});
