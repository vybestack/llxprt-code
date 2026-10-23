/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '../../../../../core/src/services/history/HistoryService.js';
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import { withRetainedClient } from './retained-array-test-helpers.js';
import {
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
} from '../../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  clientArrayRows,
  expectedClientArrayOutcome,
  forbidClientArrayRollback,
  seedClientArrayHistory,
  withArrayClient,
} from './client-array-test-helpers.js';

async function participant(
  history: HistoryService,
  stage: string,
  failure: Error,
  order: string[],
): Promise<void> {
  await history.registerMediaOwner(
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
  for (const [event, label] of [
    ['contentBatchAdded', 'batch'],
    ['tokensUpdated', 'tokens'],
    ['contextRangeChanged', 'range'],
  ] as const) {
    history.once(event, () => {
      order.push(label);
      if (stage === label) throw failure;
    });
  }
}
async function outcome(
  size: number,
  stage: string,
  batch: boolean,
): Promise<object> {
  const withClient = batch ? withArrayClient : withRetainedClient;
  return withDetachedFixture((fixture) =>
    withClient(fixture, async ({ client }) => {
      const { history, recorder } = fixture;
      await seedClientArrayHistory(fixture, size);
      history.setBaseTokenOffset(17);
      history.setCacheAnchorSeq(1);
      const order: string[] = [];
      const failure = new Error(stage);
      await participant(history, stage, failure, order);
      const input = clientArrayRows(size).map<IContent>((row, index) =>
        index === size - 1
          ? {
              ...row,
              blocks: [{ type: 'text', text: `replacement-${index}` }],
            }
          : row,
      );
      forbidClientArrayRollback(fixture);
      const error = await rejectedValue(
        batch
          ? client.restoreHistory(input)
          : client.storeHistoryForLaterUse(input),
      );
      if (stage === 'success') expect(error).toBeUndefined();
      else {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error))
          throw new Error('Missing parity failure');
        expect(error.message).toContain(stage);
      }
      await history.waitForCommit();
      return {
        live: await detachedDigest(history.streamRawHistory()),
        durable: await detachedDurableDigest(recorder),
        tokens: history.getTotalTokens(),
        range: history.getContextRange(),
        anchor: history.getCacheAnchorSeq(),
        order: [...order],
      };
    }),
  );
}

export const PARITY_STAGES = [
  'success',
  'prepare',
  'publish',
  'batch',
  'tokens',
  'finalize',
  'range',
] as const;

export const RETAINED_PARITY_STAGES = PARITY_STAGES.filter(
  (stage) => stage !== 'batch',
);

export function registerParityCases(
  sizes: readonly number[],
  stages: readonly string[],
): void {
  registerCases(sizes, stages, true);
}

export function registerRetainedParityCases(
  sizes: readonly number[],
  stages: readonly string[],
): void {
  registerCases(sizes, stages, false);
}

function registerCases(
  sizes: readonly number[],
  stages: readonly string[],
  batch: boolean,
): void {
  describe(`journal ${batch ? 'client restore' : 'retained deferred array'} matches independent expected outcomes`, () => {
    for (const size of sizes)
      for (const stage of stages) {
        it(`matches every ${size} value/scalar and observer ordering after ${stage}`, async () => {
          expect(await outcome(size, stage, batch)).toStrictEqual(
            await expectedClientArrayOutcome(size, stage, batch),
          );
        }, 180_000);
      }
  });
}
