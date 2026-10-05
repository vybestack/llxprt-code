import { observeHistorySynchronouslyForTest } from '../../packages/core/src/test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../packages/core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';

class StreamOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'public purge materializer trap');
  }
  override transformAll(): Promise<void> {
    throw new Error('public purge transformAll trap');
  }
}

describe('journal materialization guard', () => {
  it('StreamOnlyHistory rejects journal eager materialization', () => {
    const history = new StreamOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'public purge materializer trap',
      );
    } finally {
      history.dispose();
    }
  });
});
function imageRow(index: number): IContent {
  return {
    speaker: 'human',
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
    blocks: [
      { type: 'text', text: `inspect-${index}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
      },
    ],
  };
}

describe('semantic purge public streaming package surface', () => {
  it('commits and restores persisted media through the exported row transaction without eager access', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (!transaction) throw new Error('Missing exported transaction');
        try {
          expect(
            await coordinator.commit(transaction, {
              status: 'success',
              cachePrefixWritten: false,
            }),
          ).toBe(true);
          let committedCount = 0;
          for await (const row of history.streamRawHistory()) {
            const original = imageRow(committedCount);
            expect(row.blocks).toStrictEqual(
              committedCount === 0 ? [original.blocks[0]] : original.blocks,
            );
            committedCount++;
          }
          expect(committedCount).toBe(3);
          await coordinator.rollback(transaction);
          let restoredCount = 0;
          for await (const row of history.streamRawHistory())
            expect(row).toStrictEqual(imageRow(restoredCount++));
          expect(restoredCount).toBe(3);
        } finally {
          transaction.close();
        }
        await expect(transaction.base.streamRows().next()).rejects.toThrow(
          'closed',
        );
      },
      0,
      imageRow,
      undefined,
      (options) => new StreamOnlyHistory(options),
    );
  });
});
