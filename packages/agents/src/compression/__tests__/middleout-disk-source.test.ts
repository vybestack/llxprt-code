/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import type { CompressionInputSnapshot } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  middleoutSetup,
  middleoutRow,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

class FailingSourceHistory extends MiddleoutDiskHistory {
  failure: Error | undefined;
  closedSnapshots = 0;
  override async openCompressionInput(): Promise<CompressionInputSnapshot> {
    const snapshot = await super.openCompressionInput();
    const failure = this.failure;
    const readRow = snapshot.rows.readRow.bind(snapshot.rows);
    spyOn(snapshot.rows, 'readRow').mockImplementation((index) => {
      if (failure !== undefined) throw failure;
      return readRow(index);
    });
    const closed = (): void => {
      this.closedSnapshots++;
    };
    return {
      ...snapshot,
      async close() {
        try {
          await snapshot.close();
        } finally {
          closed();
        }
      },
    };
  }
}
async function sourceFailure(size: number, mode: string): Promise<number> {
  let created: FailingSourceHistory | undefined;
  return withSuffixFixture(
    size,
    async (history, ownership) => {
      if (created === undefined)
        throw new Error('Missing source fault participant');
      const { handler, transport } = middleoutSetup(history);
      const error =
        mode === 'cancel'
          ? new DOMException('cancelled source', 'AbortError')
          : new Error('disk source failed');
      created.failure = error;
      const rejected = await handler.performCompression('source-fault').then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(rejected).toBe(error);
      expect(created.closedSnapshots).toBe(1);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await collectRows(history)).toStrictEqual(
        Array.from({ length: size }, (_, index) => middleoutRow(index, 64)),
      );
      expect(transport.requests).toHaveLength(0);
      created.failure = undefined;
      expect(await handler.performCompression('source-retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      return created.closedSnapshots;
    },
    64,
    middleoutRow,
    undefined,
    (options) => {
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
describe('disk middle-out source lifetime', () => {
  it.each(cases)(
    'closes a failed %i-row %s source and can retry without eager collection',
    async (size, mode) => {
      expect(await sourceFailure(size, mode)).toBe(2);
    },
    180_000,
  );
});
