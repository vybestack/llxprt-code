import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import type { SessionRecordingService } from './SessionRecordingService.js';
import { foldDurableRows } from './durableRowFold.js';
import { SemanticMediaPurgeStreamCoordinator } from '../services/history/semantic-purge-stream.js';
import { withCoreSuffixFixture } from '../services/history/core-suffix-fixture-test-helpers.js';
import { ownerFixtureRow } from '../services/history/chronology-rollback-owner-test-helpers.js';
import { RowOwnership } from './rowOwnership.js';
import type { IContent } from '../services/history/IContent.js';
import { HistoryService } from '../services/history/HistoryService.js';

class StreamOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'materialize trap');
  }
  override transformAll(): Promise<void> {
    throw new Error('transformAll trap');
  }
}

describe('journal materialization guard', () => {
  it('StreamOnlyHistory rejects journal eager materialization', () => {
    const history = new StreamOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'materialize trap',
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
async function verifyCompensation(size: number): Promise<number> {
  let recording: SessionRecordingService | undefined;
  const owners = new RowOwnership();
  await withCoreSuffixFixture(
    size,
    async (history) => {
      const controller = new AbortController();
      const failure = new Error('cancel after durable append');
      let writes = 0;
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
        ownership: owners,
        persist: async (source, frontier) => {
          if (!recording) throw new Error('Missing recorder');
          await recording.recordSemanticMediaPurgeRows(
            source.streamRows(),
            frontier,
            { requireLiveFold: true },
          );
          if (++writes === 1) controller.abort(failure);
        },
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (!transaction) throw new Error('Missing transaction');
      try {
        await expect(
          coordinator.commit(
            transaction,
            { status: 'success', cachePrefixWritten: true },
            controller.signal,
          ),
        ).rejects.toBe(failure);
        expect(writes).toBe(2);
        let index = 0;
        for await (const row of history.streamRawHistory())
          expect(row).toStrictEqual(imageRow(index++, 2048));
        expect(index).toBe(size);
        const file = recording?.getFilePath();
        if (!file) throw new Error('Missing journal');
        const reopened = await foldDurableRows({
          filePath: file,
          maxBytes: statSync(file).size,
        });
        try {
          expect(reopened.length).toBe(size);
          for (let index = 0; index < size; index++)
            expect(await reopened.readRow(index)).toStrictEqual(
              imageRow(index, 2048),
            );
        } finally {
          await reopened.close();
        }
      } finally {
        transaction.close();
      }
    },
    2048,
    imageRow,
    owners,
    (options) => {
      recording = options.recording;
      return new StreamOnlyHistory(options);
    },
  );
  expect(owners.snapshot().liveRows).toBe(0);
  expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
    true,
  );
  return owners.snapshot().liveRows;
}

describe('shared-journal purge durable compensation after an acknowledged append', () => {
  for (const size of [512, 8192]) {
    it(`restores all ${size} rows in live and reopened membership after cancellation without eager access`, async () => {
      expect(await verifyCompensation(size)).toBe(0);
    }, 300_000);
  }
});
