/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  expectedRange,
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import type { HistoryService } from '../../../core/src/services/history/HistoryService.js';
import {
  conversationFor,
  forbidArrayRollback,
  recordArrayProof,
} from './__tests__/support/conversation-array-test-helpers.js';

async function injectFailure(
  history: HistoryService,
  stage: string,
  failure: Error,
): Promise<string[]> {
  const order: string[] = [];
  const visit = (label: string): void => {
    order.push(label);
    if (stage === label) throw failure;
  };
  await history.registerMediaOwner({
    ...mediaParticipant(() => {
      visit('prepare');
      return {
        publish: () => visit('publish'),
        finalize: () => visit('finalize'),
        rollback: () => visit('rollback'),
      };
    }),
    reconcile: async () => {
      visit('reconcile');
    },
  });
  history.once('contentBatchAdded', () => visit('batch'));
  history.once('tokensUpdated', () => visit('tokens'));
  history.once('contextRangeChanged', () => visit('range'));
  return order;
}
function expectedOrder(stage: string): string[] {
  if (stage === 'zero') return [];
  const order = ['prepare', 'publish', 'batch', 'tokens', 'range', 'finalize'];
  const cutoff = stage === 'prefix' ? 2 : order.indexOf(stage) + 1;
  return [
    ...order.slice(0, cutoff),
    ...(stage === 'prepare' ? [] : ['rollback']),
  ];
}

describe('conversation array replacement fault compensation', () => {
  for (const size of [65])
    for (const stage of [
      'prepare',
      'publish',
      'zero',
      'prefix',
      'batch',
      'tokens',
      'finalize',
      'range',
    ]) {
      it(`restores ${size} values, tokens and anchor after ${stage} rejection`, async () => {
        await withDetachedFixture(async ({ history, recorder, owners, io }) => {
          await history.detachedValues.replace(detachedRows(size));
          history.setBaseTokenOffset(17);
          history.setCacheAnchorSeq(1);
          const expected = await detachedDigest(detachedRows(size));
          const range = expectedRange(size);
          const failure = new Error(stage);
          const order = await injectFailure(history, stage, failure);
          if (stage === 'zero' || stage === 'prefix')
            io.rejectNextWrite(
              failure,
              stage === 'zero' ? 'records' : 'trailer',
            );
          forbidArrayRollback(history);
          expect(
            await rejectedValue(
              conversationFor(history).setHistory(
                Array.from({ length: size }, (_, index) => ({
                  ...detachedRow(index),
                  blocks: [{ type: 'text', text: `changed-${index}` }],
                })),
              ),
            ),
          ).toBe(failure);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          await history.waitForCommit();
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(size * 4 + 17);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(history.getContextRange()).toStrictEqual(range);
          expect(order).toStrictEqual(expectedOrder(stage));
          expect(owners.snapshot().liveRows).toBe(0);
          recordArrayProof({ kind: 'failure', size, stage, order, expected });
        });
      }, 180_000);
    }
});
