import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  durableRowsOf,
  expectedRange,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import type { ChronologyMarker, IContent } from './IContent.js';

function markedBaseline(): {
  row: IContent;
  marker: ChronologyMarker;
  metadata: NonNullable<IContent['metadata']>;
} {
  const marker = { seq: 1, userTurn: 1, step: 1, recordedAt: 42 };
  const metadata = { chronology: marker };
  return { row: { ...rollbackRow(0), metadata }, marker, metadata };
}

function freezeStampedRow(row: IContent): void {
  Object.freeze(row.metadata?.chronology);
  Object.freeze(row.metadata);
  Object.freeze(row);
}

describe('frozen pending batch rollback', () => {
  for (const stage of ['prepare', 'contentBatchAdded', 'afterPublication']) {
    it(`restores journal values and leaves the frozen caller row untouched after ${stage} failure`, async () => {
      await withRollbackFixture(async (history, recorder, releaseWriter) => {
        const { row: baseline, metadata, marker } = markedBaseline();
        await history.addBatch([baseline]);
        freezeStampedRow(baseline);
        const primary = new Error(`${stage} frozen batch failure`);
        if (stage === 'prepare') {
          let prepared = false;
          history.registerMediaOwner(
            mediaParticipant(() => {
              if (!prepared) {
                prepared = true;
                throw primary;
              }
              return { publish: () => undefined, rollback: () => undefined };
            }),
          );
        } else if (stage === 'contentBatchAdded') {
          history.once('contentBatchAdded', () => {
            throw primary;
          });
        }
        const fresh = rollbackRow(1);
        const error = await rejectedValue(
          history.addBatch([fresh], undefined, {
            afterPublication: () => {
              if (stage === 'afterPublication') throw primary;
            },
          }),
        );
        expect(error).toBe(primary);
        await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
          expect(rows).toStrictEqual([baseline]);
          expect(rows[0]).not.toBe(baseline);
        });
        expect(baseline.metadata).toBe(metadata);
        expect(baseline.metadata?.chronology).toBe(marker);
        expect(Object.isFrozen(baseline)).toBe(true);
        expect(fresh.metadata).toBeUndefined();
        expect(history.getTotalTokens()).toBe(4);
        expect(history.getContextRange()).toStrictEqual(expectedRange(1));
        releaseWriter();
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
        const following = rollbackRow(2);
        await history.addBatch([following]);
        expect(following.metadata).toBeUndefined();
        const stored = await rowsOf(history);
        expect(stored[1].metadata?.chronology).toMatchObject({
          seq: 2,
          userTurn: 1,
          step: 2,
        });
      });
    });
  }
});

describe('frozen pending serialization rollback', () => {
  it('compensates partially admitted rows and restores chronology after a serialization failure', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const { row: baseline, marker } = markedBaseline();
      await history.addBatch([baseline]);
      freezeStampedRow(baseline);
      const primary = new Error('frozen batch serialization failure');
      const fresh = rollbackRow(1);
      const bad: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'bad',
            toolName: 'inspect',
            result: {
              toJSON: (): object => {
                throw primary;
              },
            },
          },
        ],
      };
      expect(await rejectedValue(history.addBatch([fresh, bad]))).toBe(primary);
      expect(fresh.metadata).toBeUndefined();
      expect(bad.metadata).toBeUndefined();
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows).toStrictEqual([baseline]);
      });
      expect(baseline.metadata?.chronology).toBe(marker);
      expect(await rowsOf(history)).toStrictEqual([baseline]);
      releaseWriter();
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
      const following = rollbackRow(2);
      await history.addBatch([following]);
      expect(following.metadata).toBeUndefined();
      expect((await rowsOf(history))[1].metadata?.chronology?.seq).toBe(2);
    });
  });
});

describe('frozen pending rollback queue ordering', () => {
  it('runs queued appends after failed observer compensation with reclaimed chronology', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const baseline = rollbackRow(0);
      await history.addBatch([baseline]);
      freezeStampedRow(baseline);
      const primary = new Error('frozen observer failure');
      const failed = rollbackRow(1);
      const appended = rollbackRow(2);
      const last = rollbackRow(3);
      let queued: Promise<void> | undefined;
      history.once('contentBatchAdded', () => {
        history.add(appended);
        queued = history.addBatch([last]);
        throw primary;
      });
      expect(await rejectedValue(history.addBatch([failed]))).toBe(primary);
      await queued;
      await history.waitForTokenUpdates();
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
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
      });
      expect(failed.metadata).toBeUndefined();
      // history.add stamps the live caller row in place; addBatch does not.
      expect(appended.metadata?.chronology?.seq).toBe(2);
      expect(last.metadata).toBeUndefined();
      const stored = await rowsOf(history);
      expect(history.getTotalTokens()).toBe(
        await history.estimateTokensForContents(stored),
      );
      releaseWriter();
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual(stored);
    });
  });
});

describe('displaced pending chronology rollback', () => {
  for (const displacement of ['equal-value-marker', 'missing-metadata']) {
    it(`keeps the journal marker value after ${displacement} caller mutation in an observer`, async () => {
      await withRollbackFixture(async (history, recorder, releaseWriter) => {
        const { row: baseline, marker } = markedBaseline();
        await history.addBatch([baseline]);
        const primary = new Error('displaced pending chronology');
        history.once('contentBatchAdded', () => {
          if (displacement === 'missing-metadata') delete baseline.metadata;
          else baseline.metadata = { chronology: { ...marker } };
          throw primary;
        });
        const fresh = rollbackRow(1);
        expect(await rejectedValue(history.addBatch([fresh]))).toBe(primary);
        await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
          expect(rows).toHaveLength(1);
          expect(rows[0].blocks).toStrictEqual(baseline.blocks);
          expect(rows[0].metadata?.chronology).toStrictEqual(marker);
          expect(rows[0]).not.toBe(baseline);
        });
        expect(fresh.metadata).toBeUndefined();
        releaseWriter();
        await history.waitForCommit();
        const durable = await durableRowsOf(recorder);
        expect(durable).toHaveLength(1);
        expect(durable[0].metadata?.chronology).toStrictEqual(marker);
      });
    });
  }
});
