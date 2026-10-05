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
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  conversationFor,
  forbidArrayRollback,
} from './conversation-array-test-helpers.js';
import type { HistoryService } from '../../../core/src/services/history/HistoryService.js';

async function outcome(
  size: number,
  stage: string,
  migrated: boolean,
): Promise<object> {
  return withDetachedFixture(async ({ history, recorder }) => {
    await history.detachedValues.replace(detachedRows(size));
    history.setBaseTokenOffset(17);
    history.setCacheAnchorSeq(1);
    const order: string[] = [];
    const failure = new Error(stage);
    history.registerMediaOwner(
      mediaParticipant(() => {
        order.push('prepare');
        if (stage === 'prepare') throw failure;
        return {
          publish: () => {
            order.push('publish');
            if (stage === 'publish') throw failure;
          },
          finalize: () => {
            order.push('finalize');
            if (stage === 'finalize') throw failure;
          },
          rollback: () => {
            order.push('rollback');
          },
        };
      }),
    );
    const listen = (
      event: 'contentBatchAdded' | 'tokensUpdated' | 'contextRangeChanged',
      label: string,
    ): void => {
      history.once(event, () => {
        order.push(label);
        if (stage === label) throw failure;
      });
    };
    listen('contentBatchAdded', 'batch');
    listen('tokensUpdated', 'tokens');
    listen('contextRangeChanged', 'range');
    const input = Array.from({ length: size }, (_, index) =>
      index === size - 1
        ? ({
            ...detachedRow(index),
            blocks: [{ type: 'text', text: `replacement-${index}` }],
          } satisfies import('../../../core/src/services/history/IContent.js').IContent)
        : detachedRow(index),
    );
    const replace = migrated
      ? (stored: HistoryService): Promise<void> => {
          forbidArrayRollback(stored);
          return conversationFor(stored).setHistory(input);
        }
      : async (stored: HistoryService): Promise<void> => {
          await stored.replaceBatch(input, 'restore-model');
          stored.resetCacheAnchorSeq();
          await stored.waitForCommit();
        };
    const error = await rejectedValue(replace(history));
    expect(error).toBe(stage === 'success' ? undefined : failure);
    await history.waitForCommit();
    return {
      live: await detachedDigest(history.streamRawHistory()),
      durable: await detachedDurableDigest(recorder),
      tokens: history.getTotalTokens(),
      range: history.getContextRange(),
      anchor: history.getCacheAnchorSeq(),
      order,
    };
  });
}

describe('independent old array engine versus migrated production restore', () => {
  for (const size of [512, 8192])
    for (const stage of [
      'success',
      'prepare',
      'publish',
      'batch',
      'tokens',
      'finalize',
      'range',
    ]) {
      it(`matches ${size} values/scalars and observer/participant ordering after ${stage}`, async () => {
        const old = await outcome(size, stage, false);
        expect(await outcome(size, stage, true)).toStrictEqual(old);
      }, 180_000);
    }
});
