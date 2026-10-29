/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  exactTokenizer,
  expectedRange,
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
  withDetachedFixture,
  type DetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  withArrayClient,
} from './__tests__/support/client-array-test-helpers.js';
const stages = [
  'tokenizer',
  'prepare',
  'publish',
  'records',
  'trailer',
  'batch',
  'tokens',
  'finalize',
  'range',
];
async function installFault(
  fixture: DetachedFixture,
  stage: string,
  failure: Error,
): Promise<void> {
  const { history, io } = fixture;
  if (stage === 'records' || stage === 'trailer')
    io.rejectNextWrite(failure, stage);
  if (stage === 'tokenizer')
    history.setTokenizerFactory(
      exactTokenizer(() => {
        throw failure;
      }),
    );
  await history.registerMediaOwner(
    mediaParticipant(() => {
      if (stage === 'prepare') throw failure;
      return {
        publish: () => {
          if (stage === 'publish') throw failure;
        },
        finalize: () => {
          if (stage === 'finalize') throw failure;
        },
        rollback: () => undefined,
      };
    }),
  );
  for (const [event, label] of [
    ['contentBatchAdded', 'batch'],
    ['tokensUpdated', 'tokens'],
    ['contextRangeChanged', 'range'],
  ] as const) {
    history.once(event, () => {
      if (stage === label) throw failure;
    });
  }
}
function registerFailure(size: number, stage: string): void {
  describe('registerFailure', () => {
    it(`restores ${size} complete old rows after ${stage} without duplicate input`, async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client }) => {
          const { history, recorder, owners } = fixture;
          await history.detachedValues.replace(detachedRows(size));
          await history.recalculateTotalTokens();
          history.setBaseTokenOffset(17);
          history.setCacheAnchorSeq(1);
          const expected = await detachedDigest(detachedRows(size));
          const tokens = size * 4 + 17;
          const range = expectedRange(size);
          const failure = new Error(`client fault ${stage}`);
          await installFault(fixture, stage, failure);
          forbidClientArrayRollback(fixture);
          const input = clientArrayRows(size).map((row) => ({
            ...row,
            blocks: [
              ...row.blocks,
              { type: 'text' as const, text: 'replacement' },
            ],
          }));
          const error = await rejectedValue(client.restoreHistory(input));
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error))
            throw new Error('Missing restore failure');
          expect(error.message).toContain(failure.message);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          await history.waitForCommit();
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(tokens);
          expect(history.getContextRange()).toStrictEqual(range);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(owners.snapshot().liveRows).toBe(0);
        }),
      );
    }, 180_000);
  });
}
describe('client admitted restore failure atomicity', () => {
  for (const size of [65])
    for (const stage of stages) registerFailure(size, stage);
});
