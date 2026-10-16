/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  oneshotSetup,
  oneshotRow,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

class FailingSourceHistory extends OneshotDiskHistory {
  failure: Error | undefined;
  closedSnapshots = 0;
  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    const failure = this.failure;
    const closed = (): void => {
      this.closedSnapshots++;
    };
    return {
      ...snapshot,
      async *rows() {
        let index = 0;
        for await (const row of snapshot.rows()) {
          if (++index === 31 && failure !== undefined) throw failure;
          yield row;
        }
      },
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
      const { handler, transport } = oneshotSetup(history);
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
        Array.from({ length: size }, (_, index) => oneshotRow(index, 64)),
      );
      expect(transport.requests).toHaveLength(0);
      created.failure = undefined;
      expect(await handler.performCompression('source-retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      return created.closedSnapshots;
    },
    64,
    oneshotRow,
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
describe('disk one-shot source lifetime', () => {
  it.each(cases)(
    'closes a failed %i-row %s source and can retry without eager collection',
    async (size, mode) => {
      expect(await sourceFailure(size, mode)).toBe(2);
    },
    180_000,
  );
});
