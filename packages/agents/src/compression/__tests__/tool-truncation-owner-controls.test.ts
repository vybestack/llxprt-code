/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import type { HistoryServiceJournalOptions } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { truncateOversizedToolResponsesUnified } from '../toolResultTruncator.js';
import {
  BoundedToolHistory,
  toolRankingRow,
  toolDeps,
} from './tool-truncation-stream-helpers.js';

class RetainingToolHistory extends BoundedToolHistory {
  readonly retained = new RowOwnership();
  private readonly rows: IContent[] = [];
  constructor(
    options: HistoryServiceJournalOptions,
    private readonly copy: boolean,
  ) {
    super(options);
  }
  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of super.streamRawHistory(signal)) {
      const retained = this.copy ? { ...row, blocks: [...row.blocks] } : row;
      this.rows.push(retained);
      this.retained.retain(retained);
      yield row;
    }
  }
  release(): void {
    for (const row of this.rows) this.retained.release(row);
    this.rows.length = 0;
  }
}

const cases: Array<[number, boolean]> = [
  [512, false],
  [512, true],
  [8192, false],
  [8192, true],
];
describe('tool-truncation returning consumer traps', () => {
  it.each(cases)(
    'charges deliberately retained %i-row copies=%s and releases on completion',
    async (size, copy) => {
      await withSuffixFixture(
        size,
        async (history) => {
          if (!(history instanceof RetainingToolHistory))
            throw new Error('Missing retaining fixture');
          try {
            const pending = toolRankingRow(size);
            const result = await truncateOversizedToolResponsesUnified(
              {
                ...toolDeps(history, async () => 0),
                pendingContents: [pending],
              },
              100,
            );
            expect(result.success).toBe(true);
            expect(
              history.retained.within({
                rows: 440,
                serializedBytes: 8 * 1024 * 1024,
              }),
            ).toBe(process.env.TOOL_RETAINING_TRAP === '1');
            expect(history.retained.snapshot().peakRows).toBeGreaterThan(440);
            const requiredBytes = size === 8192 ? 8 * 1024 * 1024 : 0;
            expect(
              history.retained.snapshot().peakSerializedBytes,
            ).toBeGreaterThan(requiredBytes);
          } finally {
            history.release();
          }
          expect(history.retained.snapshot().liveRows).toBe(0);
        },
        2048,
        toolRankingRow,
        undefined,
        (options) => new RetainingToolHistory(options, copy),
      );
    },
    120000,
  );
});
