/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  checkpointSourceFault,
  checkpointScratch,
  checkpointState,
  expectedCheckpointState,
} from './checkpoint-source-fault-helpers.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
  HighdensityDiskHistory,
} from './highdensity-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

class FailingSourceHistory extends HighdensityDiskHistory {
  failure: Error | undefined;
  private readonly source = checkpointSourceFault(this, () => this.failure, 31);

  get closedSnapshots(): number {
    return this.source.closed;
  }
}
async function sourceFailure(size: number, mode: string): Promise<number> {
  let created: FailingSourceHistory | undefined;
  let recording: SessionRecordingService | undefined;
  return withSuffixFixture(
    size,
    async (history, ownership) => {
      if (created === undefined)
        throw new Error('Missing source fault participant');
      const { handler, transport } = highdensitySetup(history);
      const error =
        mode === 'cancel'
          ? new DOMException('cancelled source', 'AbortError')
          : new Error('disk source failed');
      created.failure = error;
      const expected = await expectedCheckpointState(
        size,
        highdensityRow,
        0,
        0,
      );
      expect(await checkpointState(history, recording)).toStrictEqual(expected);
      expect(checkpointScratch()).toStrictEqual([]);
      const rejected = await handler.performCompression('source-fault').then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(rejected).toBe(error);
      expect(created.closedSnapshots).toBe(1);
      expect(checkpointScratch()).toStrictEqual([]);
      expect(await checkpointState(history, recording)).toStrictEqual(expected);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await collectRows(history)).toStrictEqual(
        Array.from({ length: size }, (_, index) => highdensityRow(index, 64)),
      );
      expect(transport.requests).toHaveLength(0);
      created.failure = undefined;
      expect(await handler.performCompression('source-retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      return created.closedSnapshots;
    },
    64,
    highdensityRow,
    undefined,
    (options) => {
      recording = options.recording;
      created = new FailingSourceHistory(options);
      return created;
    },
  );
}
const cases: Array<[number, string]> = [
  [512, 'error'],
  [512, 'cancel'],
  [8192, 'error'],
  [8192, 'cancel'],
];
describe('disk high-density source lifetime', () => {
  it.each(cases)(
    'closes a failed %i-row %s source and can retry without eager collection',
    async (size, mode) => {
      expect(await sourceFailure(size, mode)).toBe(2);
    },
    180_000,
  );
});
