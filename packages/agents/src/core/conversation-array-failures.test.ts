/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
  expectedRange,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type { HistoryService } from '../../../core/src/services/history/HistoryService.js';
import {
  conversationFor,
  forbidArrayRollback,
  recordArrayProof,
} from './conversation-array-test-helpers.js';

function injectFailure(
  history: HistoryService,
  stage: string,
  failure: Error,
): string[] {
  const order: string[] = [];
  const visit = (label: string): void => {
    order.push(label);
    if (stage === label) throw failure;
  };
  history.registerMediaOwner(
    mediaParticipant(() => {
      visit('prepare');
      return {
        publish: () => visit('publish'),
        finalize: () => visit('finalize'),
        rollback: () => visit('rollback'),
      };
    }),
  );
  history.once('contentBatchAdded', () => visit('batch'));
  history.once('tokensUpdated', () => visit('tokens'));
  history.once('contextRangeChanged', () => visit('range'));
  return order;
}
function expectedOrder(stage: string): string[] {
  const order = ['prepare', 'publish', 'batch', 'tokens', 'finalize', 'range'];
  const cutoff =
    stage === 'zero' || stage === 'prefix' ? 2 : order.indexOf(stage) + 1;
  return [
    ...order.slice(0, cutoff),
    ...(stage === 'prepare' ? [] : ['rollback']),
  ];
}

describe('conversation array replacement fault compensation', () => {
  for (const size of [512, 8192])
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
        await withDetachedFixture(async ({ history, recorder, owners }) => {
          await history.detachedValues.replace(detachedRows(size));
          history.setBaseTokenOffset(17);
          history.setCacheAnchorSeq(1);
          const expected = await detachedDigest(detachedRows(size));
          const range = expectedRange(size);
          const failure = new Error(stage);
          const order = injectFailure(history, stage, failure);
          if (stage === 'zero' || stage === 'prefix')
            recorder.failAdmissionAfter(stage === 'zero' ? 0 : 2);
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
          ).toBe(
            stage === 'zero' || stage === 'prefix' ? recorder.failure : failure,
          );
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
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
