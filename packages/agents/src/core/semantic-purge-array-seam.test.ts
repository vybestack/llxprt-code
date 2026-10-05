import { observeHistorySynchronouslyForTest } from '../../../core/src/test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../../core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { isDeepStrictEqual } from 'node:util';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ownerFixtureRow } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-owner-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';

class StreamOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'production materializer array seam',
    );
  }
  override transformAll(): Promise<void> {
    throw new Error('production transformAll array seam');
  }
}

describe('journal materialization guard', () => {
  it('StreamOnlyHistory rejects journal eager materialization', () => {
    const history = new StreamOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'production materializer array seam',
      );
    } finally {
      history.dispose();
    }
  });
});
function imageRow(index: number, bytes: number): IContent {
  const row = ownerFixtureRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media' ? { ...block, mimeType: 'image/png' } : block,
    ),
  };
}
const success = {
  status: 'success',
  usage: {
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    cache_creation_input_tokens: 1,
  },
  retryHandoff: false,
} as const;

async function verifyCandidate(
  attempt: SemanticMediaPurgeAttempt,
  size: number,
): Promise<void> {
  const boundary = attempt.preparedBoundary;
  if (!boundary) throw new Error('Missing production pre-image boundary');
  let changedContentIndex: number | undefined;
  let changedBlockIndex: number | undefined;
  let count = 0;
  for await (const row of attempt.candidateHistory.streamRows()) {
    const original = imageRow(count, 2048);
    if (!isDeepStrictEqual(row.blocks, original.blocks)) {
      expect(changedContentIndex).toBeUndefined();
      changedContentIndex = count;
      changedBlockIndex = original.blocks.findIndex(
        (block, index) => !isDeepStrictEqual(block, row.blocks[index]),
      );
    }
    expect(row).toStrictEqual(
      count === 0
        ? {
            ...original,
            blocks: original.blocks.filter((_, index) => index !== 3),
            metadata: {
              ...original.metadata,
              semanticMediaPurgeFrontier: { contentIndex: 1, blockIndex: 3 },
            },
          }
        : original,
    );
    count++;
  }
  const transaction = { changedContentIndex, changedBlockIndex };
  expect(transaction.changedContentIndex).toBe(0);
  expect(transaction.changedBlockIndex).toBe(3);
  expect(count).toBe(size);
  for (let pass = 0; pass < 2; pass++) {
    count = 0;
    for await (const row of attempt.requestHistory.streamRows()) {
      const original = imageRow(count, 2048);
      expect(row.blocks).toStrictEqual(original.blocks);
      if (count === boundary.contentIndex) {
        expect(row.metadata?.semanticMediaPurgeBoundary?.boundaryId).toBe(
          boundary.boundaryId,
        );
        expect(row.metadata?.semanticMediaPurgeBoundary?.blockIndex).toBe(2);
      }
      count++;
    }
    expect(count).toBe(size);
  }
}

async function verifyProduction(size: number): Promise<number> {
  let recording: SessionRecordingService | undefined;
  const ownership = new RowOwnership();
  await withSuffixFixture(
    size,
    async (history) => {
      let writes = 0;
      const session = new SemanticMediaPurgeSession({
        history,
        ownership,
        mode: () => 'remove',
        persist: async (rows, frontier) => {
          if (!recording) throw new Error('Missing shared recorder');
          await recording.recordSemanticMediaPurgeRows(
            rows.streamRows(),
            frontier,
            {
              requireLiveFold: true,
            },
          );
          writes++;
        },
      });
      const rejected = await session.begin(true);
      if (!rejected) throw new Error('Missing production attempt');
      await verifyCandidate(rejected, size);
      expect(
        await rejected.complete({
          ...success,
          cacheWriteEvidence: { boundaryId: {}, preparation: 'added' },
        }),
      ).toBe(false);
      expect(writes).toBe(0);
      const attempt = await session.begin(true);
      if (!attempt?.preparedBoundary) throw new Error('Missing cache boundary');
      expect(
        await attempt.complete({
          ...success,
          cacheWriteEvidence: {
            boundaryId: attempt.preparedBoundary.boundaryId,
            preparation: 'added',
          },
        }),
      ).toBe(true);
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row.blocks.some((block) => block.type === 'media')).toBe(
          count !== 0,
        );
        count++;
      }
      expect(count).toBe(size);
      await attempt.rollbackCommitted();
      count = 0;
      for await (const row of history.streamRawHistory())
        expect(row).toStrictEqual(imageRow(count++, 2048));
      expect(count).toBe(size);
      expect(writes).toBe(2);
      await expect(attempt.complete(success)).rejects.toThrow(
        'already complete',
      );
      await expect(
        attempt.candidateHistory.streamRows().next(),
      ).rejects.toThrow('closed');
      expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
      expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
    },
    2048,
    imageRow,
    ownership,
    (options) => {
      recording = options.recording;
      return new StreamOnlyHistory(options);
    },
  );
  expect(ownership.snapshot().liveRows).toBe(0);
  return ownership.snapshot().liveRows;
}

describe('production semantic purge no-materialization contract', () => {
  for (const size of [512, 8192]) {
    it(`prepares the production ${size}-row media/tool transaction without getAll`, async () => {
      expect(await verifyProduction(size)).toBe(0);
    }, 300_000);
  }
});
