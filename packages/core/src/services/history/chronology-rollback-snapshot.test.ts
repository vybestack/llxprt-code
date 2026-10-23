/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  durableRowsOf,
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { checkpointRows } from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';

describe('row values after publication compensation', () => {
  it('restores the original row value after a publication failure', async () => {
    await withRollbackFixture(async (history) => {
      const original = rollbackRow(0);
      await history.addBatch([original]);
      const primary = new Error('pending identity publication failure');
      expect(
        await rejectedValue(
          history.replaceBatch([rollbackRow(1)], undefined, {
            afterPublication: () => {
              throw primary;
            },
          }),
        ),
      ).toBe(primary);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows[0].speaker).toBe(original.speaker);
        expect(rows[0].blocks).toStrictEqual(original.blocks);
        expect(rows[0]).not.toBe(original);
      });
    });
  });
});

describe('rollback snapshot lifetime', () => {
  it('keeps checkpoint row values after replacement and store disposal', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0, 2048), rollbackRow(1, 2048)];
      await history.addBatch(before);
      const expected = await rowsOf(history);
      await history.detachedValues.withCheckpoint(async (snapshot) => {
        await history.detachedValues.replace([]);
        await history.dispose();
        expect(snapshot.length).toBe(before.length);
        const first = [];
        for await (const row of checkpointRows(snapshot)) first.push(row);
        expect(first).toStrictEqual(expected);
        const iterator = checkpointRows(snapshot);
        expect((await iterator.next()).value).toStrictEqual(expected[0]);
        await iterator.return();
      });
    });
  });

  it('preserves callback error identity and releases a borrowed checkpoint iterator', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      await history.addBatch([rollbackRow(0)]);
      const primary = new Error('snapshot callback failure');
      const operation = history.detachedValues.withCheckpoint(
        async (snapshot) => {
          for await (const row of checkpointRows(snapshot)) {
            expect(row.speaker).toBe('human');
            throw primary;
          }
        },
      );
      expect(await rejectedValue(operation)).toBe(primary);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});

describe('rollback serialization order', () => {
  it('does not reserialize an admitted row before ownership preparation fails', async () => {
    await withRollbackFixture(async (history) => {
      let forbidden = false;
      const serializationFailure = new Error('previous pending serialization');
      const original: IContent = {
        speaker: 'human',
        blocks: [
          {
            type: 'tool_call',
            id: 'pending',
            name: 'inspect',
            parameters: {
              toJSON: (): object => {
                if (forbidden) throw serializationFailure;
                return { index: 0 };
              },
            },
          },
        ],
      };
      await history.addBatch([original]);
      forbidden = true;
      const primary = new Error('ownership prepare failure');
      await history.registerMediaOwner(
        mediaParticipant(() => {
          throw primary;
        }),
      );
      expect(await rejectedValue(history.replaceBatch([rollbackRow(1)]))).toBe(
        primary,
      );
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows[0].blocks[0]).toStrictEqual({
          type: 'tool_call',
          id: 'pending',
          name: 'inspect',
          parameters: { index: 0 },
        });
      });
    });
  });
});

describe('serialization failure during admission', () => {
  it('compensates from the captured snapshot and leaves caller rows untouched', async () => {
    await withRollbackFixture(async (history, recorder) => {
      const before = [rollbackRow(0), rollbackRow(1)];
      await history.addBatch(before);
      const fresh = rollbackRow(2);
      const serializationFailure = new Error('serialization during admission');
      const unserializable: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'serialized',
            name: 'inspect',
            parameters: {
              toJSON: (): never => {
                throw serializationFailure;
              },
            },
          },
        ],
      };
      const error = await rejectedValue(
        Promise.resolve().then(() =>
          history.replaceBatch([fresh, unserializable]),
        ),
      );
      expect(error).toBe(serializationFailure);
      expect(fresh.metadata).toBeUndefined();
      const bodies = (rows: readonly IContent[]): unknown[] =>
        rows.map((row) => [row.speaker, row.blocks]);
      expect(bodies(await rowsOf(history))).toStrictEqual(bodies(before));
      await history.waitForCommit();
      expect(bodies(await durableRowsOf(recorder))).toStrictEqual(
        bodies(before),
      );
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect(following.metadata).toBeUndefined();
      const stored = await rowsOf(history);
      expect(stored[2].metadata?.chronology?.seq).toBe(3);
    });
  });
});
