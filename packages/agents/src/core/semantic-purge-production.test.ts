import { observeHistorySynchronouslyForTest } from '../../../core/src/test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../../core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import { ownerFixtureRow } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-owner-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';

class StreamOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'production materializer trap');
  }
  override transformAll(): Promise<void> {
    throw new Error('production transformAll trap');
  }
}

describe('journal materialization guard', () => {
  it('StreamOnlyHistory rejects journal eager materialization', () => {
    const history = new StreamOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'production materializer trap',
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
      block.type === 'media'
        ? { ...block, mimeType: 'image/png', caption: `caption-${index}` }
        : block,
    ),
  };
}
const success = {
  status: 'success',
  usage: undefined,
  retryHandoff: false,
} as const;
function verifyTaggedRow(row: IContent, identity: object): void {
  expect(row.metadata?.semanticMediaPurgeBoundary?.boundaryId).toBe(identity);
  expect(row.blocks.some((block) => block.type === 'media')).toBe(true);
  expect(Object.isFrozen(row)).toBe(true);
}

async function persistCheckedRows(
  rows: SemanticPurgeRowSource,
  frontier: SemanticMediaPurgeFrontier,
  size: number,
  recording: SessionRecordingService | undefined,
): Promise<void> {
  let count = 0;
  for await (const row of rows.streamRows()) {
    expect(Object.isFrozen(row.blocks)).toBe(true);
    count++;
  }
  expect(count).toBe(size);
  if (!recording) throw new Error('Missing real recording');
  await recording.recordSemanticMediaPurgeRows(rows.streamRows(), frontier, {
    requireLiveFold: true,
  });
}

async function verifyProduction(size: number): Promise<number> {
  const ownership = new RowOwnership();
  let recording: SessionRecordingService | undefined;
  await withSuffixFixture(
    size,
    async (history) => {
      let writes = 0;
      const session = new SemanticMediaPurgeSession({
        history,
        mode: () => 'remove',
        ownership,
        persist: async (rows, frontier) => {
          await persistCheckedRows(rows, frontier, size, recording);
          writes++;
        },
      });
      const attempt = await session.begin(false);
      if (!attempt) throw new Error('Missing production attempt');
      let count = 0;
      for await (const row of attempt.candidateHistory.streamRows()) {
        expect(Object.isFrozen(row)).toBe(true);
        if (count === 0)
          expect(row.blocks.some((block) => block.type === 'media')).toBe(
            false,
          );
        count++;
      }
      expect(count).toBe(size);
      expect(await attempt.complete(success)).toBe(true);
      let nextResolved = false;
      const next = session.begin(false).then((value) => {
        nextResolved = true;
        return value;
      });
      await Promise.resolve();
      expect(nextResolved).toBe(false);
      await attempt.rollbackCommitted();
      count = 0;
      for await (const row of history.streamRawHistory())
        expect(row).toStrictEqual(imageRow(count++, 2048));
      expect(count).toBe(size);
      expect(writes).toBe(2);
      const second = await next;
      if (!second) throw new Error('Missing next attempt');
      await second.complete({ ...success, status: 'cancelled' });
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

describe('invoked production streaming semantic purge session: persisted membership', () => {
  for (const size of [512, 8192]) {
    it(`commits and rolls back real ${size}-row history without eager access and releases its next lease`, async () => {
      expect(await verifyProduction(size)).toBe(0);
    }, 300_000);
  }
});

describe('invoked production streaming semantic purge session: cancels construction before taking ownership and can begin again', () => {
  it('cancels construction before taking ownership and can begin again', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const ownership = new RowOwnership();
        const session = new SemanticMediaPurgeSession({
          history,
          ownership,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const controller = new AbortController();
        const reason = new Error('cancel purge');
        controller.abort(reason);
        await expect(session.begin(false, controller.signal)).rejects.toBe(
          reason,
        );
        expect(ownership.snapshot().peakRows).toBe(0);
        const attempt = await session.begin(false);
        if (!attempt) throw new Error('Missing attempt after cancellation');
        attempt.finalize();
        expect(ownership.snapshot().liveRows).toBe(0);
        await expect(
          attempt.requestHistory.streamRows().next(),
        ).rejects.toThrow('closed');
      },
      2048,
      imageRow,
      undefined,
      (options) => new StreamOnlyHistory(options),
    );
  });
});

describe('invoked production streaming semantic purge session: preserves explicit-cache identity through repeated request passes and rejects foreign evidence', () => {
  it('preserves explicit-cache identity through repeated request passes and rejects foreign evidence', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const attempt = await session.begin(true);
        if (!attempt?.preparedBoundary) throw new Error('Missing boundary');
        const identity = attempt.preparedBoundary.boundaryId;
        for (let pass = 0; pass < 2; pass++) {
          let tagged = 0;
          for await (const row of attempt.requestHistory.streamRows()) {
            if (row.metadata?.semanticMediaPurgeBoundary) {
              verifyTaggedRow(row, identity);
              tagged++;
            }
          }
          expect(tagged).toBe(1);
        }
        expect(
          await attempt.complete({
            ...success,
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
              cache_creation_input_tokens: 1,
            },
            cacheWriteEvidence: { boundaryId: {}, preparation: 'added' },
          }),
        ).toBe(false);
        const first = await history.streamRawHistory().next();
        if (first.done === true) throw new Error('Missing original history');
        expect(first.value.blocks.some((block) => block.type === 'media')).toBe(
          true,
        );
      },
      2048,
      imageRow,
      undefined,
      (options) => new StreamOnlyHistory(options),
    );
  });
});
