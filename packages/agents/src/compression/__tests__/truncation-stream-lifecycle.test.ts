/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  checkpointSourceFault,
  checkpointScratch,
  checkpointState,
  expectedCheckpointState,
} from './checkpoint-source-fault-helpers.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  withSuffixFixture,
  rowIndex,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  withRollbackFixture,
  exactTokenizer,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  TruncationStreamHistory,
  truncationHandler,
  truncationRow,
  collectRows,
} from './truncation-stream-helpers.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { runDiskTruncation } from '../diskTruncation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

class FaultHistory extends TruncationStreamHistory {
  readonly failure = new Error('injected curated producer failure');
  private readonly source = checkpointSourceFault(this, () => this.failure, 21);

  get closedSnapshot(): boolean {
    return this.source.closed > 0;
  }
}

async function longCandidate(size: number): Promise<number> {
  const mutation = new RowOwnership();
  return withSuffixFixture(
    size,
    async (history, reader) => {
      truncationHandler(history);
      history.syncTotalTokens(size);
      await history.waitForTokenUpdates();
      const targetTokenCount = size - 10;
      const result = await runDiskTruncation(
        'long',
        buildRuntimeContext(history),
        history,
        async () => {
          throw new Error('No LLM');
        },
        undefined,
        undefined,
        new DebugLogger('test:long'),
        { targetTokenCount },
      );
      expect(result.outcome).toBe('applied');
      let count = 0;
      for await (const row of history.getComprehensive()) {
        expect(rowIndex(row)).toBe(count + 10);
        count++;
      }
      expect(count).toBe(size - 10);
      expect(
        reader.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(
        mutation.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(reader.snapshot().liveRows + mutation.snapshot().liveRows).toBe(0);
      return count;
    },
    2048,
    truncationRow,
    mutation,
    (options) => new TruncationStreamHistory(options),
  );
}

async function producerFailure(size: number): Promise<number> {
  let created: FaultHistory | undefined;
  let recording: SessionRecordingService | undefined;
  return withSuffixFixture(
    size,
    async (history, reader) => {
      const handler = truncationHandler(history);
      history.syncTotalTokens(size);
      await history.waitForTokenUpdates();
      const expected = await expectedCheckpointState(
        size,
        truncationRow,
        size,
        size,
      );
      expect(await checkpointState(history, recording)).toStrictEqual(expected);
      expect(checkpointScratch()).toStrictEqual([]);
      const operation = handler.performCompression('source-fault');
      await expect(operation).rejects.toThrow(
        'injected curated producer failure',
      );
      await expect(operation).rejects.toBe(created?.failure);
      expect(created?.closedSnapshot).toBe(true);
      expect(checkpointScratch()).toStrictEqual([]);
      expect(await checkpointState(history, recording)).toStrictEqual(expected);
      expect((await collectRows(history)).map(rowIndex)).toStrictEqual(
        Array.from({ length: size }, (_, index) => index),
      );
      expect(reader.snapshot().liveRows).toBe(0);
      return (await collectRows(history)).length;
    },
    64,
    truncationRow,
    undefined,
    (options) => {
      recording = options.recording;
      created = new FaultHistory(options);
      return created;
    },
  );
}

describe('pinned strategy cursor lifecycle', () => {
  it.each([512, 8192])(
    'publishes a %i-row mostly retained candidate with bounded registered owners',
    async (size) => {
      expect(await longCandidate(size)).toBe(size - 10);
    },
    120_000,
  );
  it.each([512, 8192])(
    'closes and preserves %i rows after producer failure',
    async (size) => {
      expect(await producerFailure(size)).toBe(size);
    },
    120_000,
  );

  it('keeps queued caller membership outside the pinned compression and flushes it afterwards', async () => {
    await withRollbackFixture(async (history, recorder) => {
      const handler = truncationHandler(history);
      for (let index = 0; index < 512; index++)
        history.add(truncationRow(index, 64));
      await history.waitForTokenUpdates();
      await recorder.flush();
      let append = true;
      history.setTokenizerFactory(
        exactTokenizer(() => {
          if (!append) return;
          append = false;
          history.add(truncationRow(512, 64));
        }),
      );
      await handler.performCompression('membership');
      expect((await collectRows(history)).map(rowIndex)).toStrictEqual(
        Array.from({ length: 30 }, (_, index) => 483 + index),
      );
    });
  });
});
