/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  durableRowsOf,
  exactTokenizer,
  expectedRange,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { AdmissionFailureRecorder } from './chronology-rollback-test-helpers.js';

async function withMembershipFixture(
  durable: boolean,
  action: (
    history: HistoryService,
    recorder: AdmissionFailureRecorder,
    releaseWriter: () => void,
  ) => Promise<void>,
): Promise<void> {
  await withRollbackFixture(action, !durable);
}

function oneShotFailure(error: Error): () => void {
  let injected = false;
  return (): void => {
    if (injected) return;
    injected = true;
    throw error;
  };
}

async function lastStoredRow(
  history: HistoryService,
): Promise<Awaited<ReturnType<typeof rowsOf>>[number] | undefined> {
  const rows = await rowsOf(history);
  return rows[rows.length - 1];
}

async function admitBaseline(
  history: HistoryService,
  durable: boolean,
  rows: readonly IContent[],
): Promise<IContent[]> {
  for (const row of rows) history.add(row);
  if (durable) await history.waitForCommit();
  return [...rows];
}

async function appendFollowingHuman(history: HistoryService): Promise<void> {
  const following = rollbackRow(3);
  await history.addBatch([following]);
  expect((await lastStoredRow(history))?.metadata?.chronology).toMatchObject({
    seq: 2,
    userTurn: 2,
    step: 1,
  });
  expect(following.metadata).toBeUndefined();
}

const stages = [
  'tokenizer',
  'prepare',
  'publish',
  'contentBatchAdded',
  'tokensUpdated',
  'afterPublication',
  'finalize',
  'contextRangeChanged',
] as const;

describe('chronology rollback across mutation stages', () => {
  for (const durable of [false, true]) {
    for (const stage of stages) {
      it(`restores ${durable ? 'durable' : 'pending'} membership and chronology after ${stage} failure`, async () => {
        await withMembershipFixture(
          durable,
          async (history, recorder, releaseWriter) => {
            const before = await admitBaseline(history, durable, [
              rollbackRow(0),
            ]);
            const failure = new Error(`injected ${stage} failure`);
            const fail = oneShotFailure(failure);
            let ownership = 'baseline';
            history.registerMediaOwner(
              mediaParticipant(() => {
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
            );
            if (stage === 'tokenizer')
              history.setTokenizerFactory(exactTokenizer(fail));
            if (
              stage === 'contentBatchAdded' ||
              stage === 'tokensUpdated' ||
              stage === 'contextRangeChanged'
            ) {
              history.once(stage, fail);
            }
            const fresh = rollbackRow(1);
            const metadataOnly = {
              ...rollbackRow(2),
              metadata: { turnId: 'existing-metadata' },
            };
            const operation = history.replaceBatch(
              [fresh, metadataOnly],
              undefined,
              {
                afterPublication: () => {
                  if (stage === 'afterPublication') fail();
                },
              },
            );
            releaseWriter();
            expect(await rejectedValue(operation)).toBe(failure);
            expect(await rowsOf(history)).toStrictEqual(before);
            expect(history.getTotalTokens()).toBe(4);
            expect(history.getContextRange()).toStrictEqual(expectedRange(1));
            expect(fresh.metadata).toBeUndefined();
            expect(metadataOnly.metadata).toStrictEqual({
              turnId: 'existing-metadata',
            });
            expect(ownership).toBe('baseline');
            await history.waitForCommit();
            expect(await durableRowsOf(recorder)).toStrictEqual(before);
            history.setTokenizerFactory(exactTokenizer());
            await appendFollowingHuman(history);
          },
        );
      });
    }
  }
});

describe('chronology stamping failure atomicity', () => {
  it('preserves frozen caller metadata and reclaims counters when later token estimation fails', async () => {
    await withRollbackFixture(async (history) => {
      const first = rollbackRow(0);
      const frozen = {
        ...rollbackRow(1),
        metadata: Object.freeze({ turnId: 'frozen' }),
      };
      const failure = new Error('later frozen-row token estimate');
      let calls = 0;
      history.setTokenizerFactory(
        exactTokenizer(() => {
          if (++calls === 5) throw failure;
        }),
      );
      const error = await rejectedValue(history.addBatch([first, frozen]));
      expect(error).toBe(failure);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(history.getTotalTokens()).toBe(0);
      expect(first.metadata).toBeUndefined();
      expect(frozen.metadata).toStrictEqual({ turnId: 'frozen' });
      const following = rollbackRow(2);
      await history.addBatch([following]);
      expect(
        (await lastStoredRow(history))?.metadata?.chronology,
      ).toMatchObject({
        seq: 1,
        userTurn: 0,
        step: 1,
      });
      expect(following.metadata).toBeUndefined();
    });
  });
});

describe('journal admission rollback', () => {
  for (const durable of [false, true]) {
    for (const successfulAdmissions of [0, 1, 2, 3]) {
      it(`restores ${durable ? 'durable' : 'pending'} membership when admission fails after ${successfulAdmissions} ops`, async () => {
        await withMembershipFixture(
          durable,
          async (history, recorder, releaseWriter) => {
            const baseline = [rollbackRow(0), rollbackRow(1)];
            const before = await admitBaseline(history, durable, baseline);
            const replacement = [
              rollbackRow(2),
              rollbackRow(3),
              rollbackRow(4),
            ];
            recorder.failAdmissionAfter(successfulAdmissions);
            const operation = history.replaceBatch(replacement);
            releaseWriter();
            expect(await rejectedValue(operation)).toBe(recorder.failure);
            expect(await rowsOf(history)).toStrictEqual(before);
            expect(history.getTotalTokens()).toBe(8);
            expect(history.getContextRange()).toStrictEqual(expectedRange(2));
            expect(replacement.map((row) => row.metadata)).toStrictEqual([
              undefined,
              undefined,
              undefined,
            ]);
            releaseWriter();
            await history.waitForCommit();
            expect(await durableRowsOf(recorder)).toStrictEqual(before);
            const following = rollbackRow(5);
            await history.addBatch([following]);
            expect(
              (await lastStoredRow(history))?.metadata?.chronology?.seq,
            ).toBe(3);
            expect(following.metadata).toBeUndefined();
          },
        );
      });
    }
  }
});

describe('chronology compensation failures', () => {
  it('preserves the primary failure and ownership rollback failure in order', async () => {
    await withRollbackFixture(async (history) => {
      const primary = new Error('publication failure');
      const rollback = new Error('ownership rollback failure');
      history.registerMediaOwner(
        mediaParticipant(() => ({
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
      expect(error.message).toBe('History mutation and rollback failed');
      expect(error.errors).toStrictEqual([primary, rollback]);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(row.metadata).toBeUndefined();
    });
  });

  it('still restores chronology and rolls back ownership if compensation admission fails', async () => {
    await withRollbackFixture(async (history, recorder) => {
      const primary = new Error('publication failure');
      let ownership = 'baseline';
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => {
            ownership = 'replacement';
          },
          rollback: () => {
            ownership = 'baseline';
          },
        })),
      );
      history.once('contentBatchAdded', () => {
        recorder.failAdmissionAfter(0);
        throw primary;
      });
      const row = rollbackRow(0);
      const error = await rejectedValue(history.addBatch([row]));
      expect(row.metadata).toBeUndefined();
      expect(ownership).toBe('baseline');
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing aggregate failure');
      expect(error.errors).toStrictEqual([primary, recorder.failure]);
    });
  });
});

describe('large media/tool chronology rollback parity', () => {
  for (const size of [512, 8192]) {
    it(`restores durable state for ${size} media/tool values without undoing caller callback mutations`, async () => {
      await withRollbackFixture(async (history, recorder) => {
        const before = [rollbackRow(0)];
        history.add(before[0]);
        await history.waitForCommit();
        const marker = { seq: 9000, userTurn: 6000, step: 4, recordedAt: 0 };
        const preserved = {
          ...rollbackRow(size),
          metadata: { chronology: marker, turnId: 'preserved' },
        };
        const fresh = Array.from({ length: size }, (_unused, index) =>
          rollbackRow(index),
        );
        const primary = new Error('late publication failure');
        history.registerMediaOwner(
          mediaParticipant(() => ({
            publish: () => undefined,
            rollback: () => undefined,
          })),
        );
        const error = await rejectedValue(
          history.replaceBatch([...fresh, preserved, fresh[0]], undefined, {
            afterPublication: () => {
              preserved.metadata.chronology = { ...marker, seq: 10000 };
              throw primary;
            },
          }),
        );
        expect(error).toBe(primary);
        expect(await rowsOf(history)).toStrictEqual(before);
        expect(preserved.metadata.chronology).toStrictEqual({
          ...marker,
          seq: 10000,
        });
        expect(fresh.every((row) => row.metadata === undefined)).toBe(true);
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual(before);
        const following = rollbackRow(size + 1);
        await history.addBatch([following]);
        expect((await lastStoredRow(history))?.metadata?.chronology?.seq).toBe(
          2,
        );
        expect(following.metadata).toBeUndefined();
      });
    }, 120_000);
  }
});
