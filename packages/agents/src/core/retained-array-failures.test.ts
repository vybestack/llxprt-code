/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { withRetainedClient } from './retained-array-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
  withDetachedFixture,
  type DetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  expectedRange,
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
} from './client-array-test-helpers.js';
const stages = [
  'tokenizer',
  'prepare',
  'publish',
  'admission-zero',
  'admission-prefix',
  'tokens',
  'finalize',
  'range',
];
function installFault(
  fixture: DetachedFixture,
  stage: string,
  failure: Error,
): void {
  const { history, recorder } = fixture;
  if (stage === 'tokenizer')
    history.setTokenizerFactory(
      exactTokenizer(() => {
        throw failure;
      }),
    );
  history.registerMediaOwner(
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
  if (stage === 'admission-zero') recorder.failAdmissionAfter(0);
  if (stage === 'admission-prefix') recorder.failAdmissionAfter(2);
}
function registerFailure(size: number, stage: string): void {
  describe('registerFailure', () => {
    it(`restores ${size} complete old rows after ${stage} without duplicate input`, async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client }) => {
          const { history, recorder, owners } = fixture;
          for await (const row of detachedRows(size))
            await recorder.commit('content', { content: row });
          await history.recalculateTotalTokens();
          history.setBaseTokenOffset(17);
          history.setCacheAnchorSeq(1);
          const expected = await detachedDigest(detachedRows(size));
          const tokens = size * 4 + 17;
          const range = expectedRange(size);
          const failure = new Error(`client fault ${stage}`);
          installFault(fixture, stage, failure);
          forbidClientArrayRollback(fixture);
          const input = clientArrayRows(size).map((row) => ({
            ...row,
            blocks: [
              ...row.blocks,
              { type: 'text' as const, text: 'replacement' },
            ],
          }));
          const error = await rejectedValue(
            client.storeHistoryForLaterUse(input),
          );
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error))
            throw new Error('Missing restore failure');
          expect(error.message).toContain(
            stage.startsWith('admission')
              ? recorder.failure.message
              : failure.message,
          );
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
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
describe('retained deferred array failure atomicity', () => {
  for (const size of [512, 8192])
    for (const stage of stages) registerFailure(size, stage);
});
