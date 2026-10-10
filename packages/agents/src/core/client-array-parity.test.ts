/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '../../../core/src/services/history/HistoryService.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  withArrayClient,
} from './client-array-test-helpers.js';
import { LegacyArrayAdmissions } from './legacy-array-admission-oracle.js';

async function legacyRestore(
  history: HistoryService,
  admissions: LegacyArrayAdmissions,
  rows: readonly IContent[],
): Promise<void> {
  const retained = await admissions.admitRetainedHistory(
    rows,
    'restore-history',
  );
  try {
    history.validateAndFix();
    await history.replaceBatch(retained?.history ?? rows, undefined, {
      afterPublication: async () => {
        const failures = await admissions.release(
          retained === undefined ? [] : [retained],
        );
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'Restored history publication cleanup failed',
          );
      },
    });
    history.resetCacheAnchorSeq();
  } catch (error) {
    await admissions.releaseAfterFailure(
      error,
      retained === undefined ? [] : [retained],
      'History restoration failed and admitted media cleanup was incomplete',
    );
  }
}
function participant(
  history: HistoryService,
  stage: string,
  failure: Error,
  order: string[],
): void {
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
  migrated: boolean,
): Promise<object> {
  return withDetachedFixture((fixture) =>
    withArrayClient(fixture, async ({ client, store }) => {
      const { history, recorder } = fixture;
      for await (const row of detachedRows(size))
        await recorder.commit('content', { content: row });
      await history.recalculateTotalTokens();
      history.setBaseTokenOffset(17);
      history.setCacheAnchorSeq(1);
      const order: string[] = [];
      const failure = new Error(stage);
      participant(history, stage, failure, order);
      const input = clientArrayRows(size).map((row, index) =>
        index === size - 1
          ? {
              ...row,
              blocks: [{ type: 'text' as const, text: `replacement-${index}` }],
            }
          : row,
      );
      if (migrated) forbidClientArrayRollback(fixture);
      const error = await rejectedValue(
        migrated
          ? client.restoreHistory(input)
          : legacyRestore(
              history,
              new LegacyArrayAdmissions(() => store),
              input,
            ),
      );
      if (stage === 'success') expect(error).toBeUndefined();
      else {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error))
          throw new Error('Missing parity failure');
        expect(error.message).toContain(stage);
      }
      return {
        live: await detachedDigest(history.streamRawHistory()),
        durable: await detachedDurableDigest(recorder),
        tokens: history.getTotalTokens(),
        range: history.getContextRange(),
        anchor: history.getCacheAnchorSeq(),
        order,
      };
    }),
  );
}
describe('independent old engine versus real admitted client restore', () => {
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
      it(`matches every ${size} value/scalar and observer ordering after ${stage}`, async () => {
        expect(await outcome(size, stage, true)).toStrictEqual(
          await outcome(size, stage, false),
        );
      }, 180_000);
    }
});
