import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  durableRowsOf,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import type { IContent } from './IContent.js';
import {
  PhaseOwners,
  expectDetachedAdmission,
  expectPhaseEmpty,
  recordPhase,
} from './snapshot-phase-test-helpers.js';

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

describe('rollback snapshot lifetime and pending membership', () => {
  it('keeps captured pending row values after durability and store disposal', async () => {
    await withRollbackFixture(async (_history, recorder) => {
      const ownership = new RowOwnership();
      const store = new HistoryJournalStore(recorder, {
        ...createRowCounters().counters,
        ownership,
      });
      const before = [rollbackRow(0, 2048), rollbackRow(1, 2048)];
      for (const row of before) store.apply({ kind: 'content', content: row });
      await store.withMutationSnapshot(async (snapshot) => {
        await store.waitForDurable();
        store.apply({ kind: 'rewind', itemsRemoved: before.length });
        await store.waitForDurable();
        store.dispose();
        expect(snapshot.length).toBe(before.length);
        expect([...snapshot].map((row) => row.blocks)).toStrictEqual(
          before.map((row) => row.blocks),
        );
        const iterator = snapshot[Symbol.iterator]();
        expect(iterator.next().value?.blocks).toStrictEqual(before[0].blocks);
        iterator.return();
      });
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  });

  it('preserves the primary callback failure while releasing a borrowed snapshot iterator', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const ownership = new PhaseOwners();
      const transaction = new PhaseOwners();
      const store = new HistoryJournalStore(
        recorder,
        { ...createRowCounters().counters, ownership },
        transaction,
      );
      const pending = rollbackRow(0);
      store.apply({ kind: 'content', content: pending });
      const primary = new Error('snapshot callback failure');
      const error = await rejectedValue(
        store.withMutationSnapshot(async (snapshot) => {
          for (const row of snapshot) {
            expect(row.speaker).toBe('human');
            throw primary;
          }
        }),
      );
      expect(error).toBe(primary);
      expectDetachedAdmission(ownership, transaction);
      recordPhase('original-callback-before-ack', ownership, transaction);
      releaseWriter();
      await store.waitForDurable();
      expect(ownership.snapshot().liveRows).toBe(0);
      expectPhaseEmpty(ownership);
      expectPhaseEmpty(transaction);
      recordPhase('original-callback-after-ack', ownership, transaction);
      store.dispose();
    }, true);
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
      history.registerMediaOwner(
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
        history.replaceBatch([fresh, unserializable]),
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
