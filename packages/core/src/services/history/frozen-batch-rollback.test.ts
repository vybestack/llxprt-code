import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
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
    it(`preserves frozen caller row and marker identity after ${stage} failure`, async () => {
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
          expect(rows[0]).toBe(baseline);
        });
        expect(baseline.metadata).toBe(metadata);
        expect(baseline.metadata?.chronology).toBe(marker);
        expect(fresh.metadata).toBeUndefined();
        expect(history.getTotalTokens()).toBe(4);
        expect(history.getContextRange()).toStrictEqual(expectedRange(1));
        releaseWriter();
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
        const following = rollbackRow(2);
        await history.addBatch([following]);
        expect(following.metadata?.chronology).toMatchObject({
          seq: 2,
          userTurn: 1,
          step: 2,
        });
      }, true);
    });
  }
});

describe('frozen pending serialization rollback', () => {
  it('compensates partially serialized rows and restores chronology before ownership rollback', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const { row: baseline, marker } = markedBaseline();
      await history.addBatch([baseline]);
      freezeStampedRow(baseline);
      const primary = new Error('frozen batch serialization failure');
      let published = false;
      let restored = false;
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
                if (published) throw primary;
                return { value: 1 };
              },
            },
          },
        ],
      };
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => {
            published = true;
          },
          rollback: () => {
            restored =
              fresh.metadata === undefined && bad.metadata === undefined;
            published = false;
          },
        })),
      );
      expect(await rejectedValue(history.addBatch([fresh, bad]))).toBe(primary);
      expect(restored).toBe(true);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows[0]).toBe(baseline);
      });
      expect(baseline.metadata?.chronology).toBe(marker);
      expect(await rowsOf(history)).toStrictEqual([baseline]);
      releaseWriter();
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
      const following = rollbackRow(2);
      await history.addBatch([following]);
      expect(following.metadata?.chronology?.seq).toBe(2);
    }, true);
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
        expect(rows).toStrictEqual([baseline, appended, last]);
      });
      expect(failed.metadata).toBeUndefined();
      expect(appended.metadata?.chronology).toMatchObject({
        seq: 2,
        userTurn: 1,
        step: 2,
      });
      expect(last.metadata?.chronology).toMatchObject({
        seq: 3,
        userTurn: 2,
        step: 1,
      });
      expect(history.getTotalTokens()).toBe(
        await history.estimateTokensForContents([baseline, appended, last]),
      );
      releaseWriter();
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual([
        baseline,
        appended,
        last,
      ]);
    }, true);
  });
});

describe('displaced pending chronology rollback', () => {
  for (const displacement of ['equal-value-marker', 'missing-metadata']) {
    it(`restores pending marker identity after ${displacement} observer mutation`, async () => {
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
          expect(rows[0]).toBe(baseline);
        });
        expect(baseline.metadata?.chronology).toBe(marker);
        expect(fresh.metadata).toBeUndefined();
        releaseWriter();
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
      }, true);
    });
  }
});
