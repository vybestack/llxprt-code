import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { providerFixtureRow } from '@vybestack/llxprt-code-core/services/history/provider-curated-test-helpers.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { recomposeFixture } from './provider-curated-recomposition-helpers.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager recomposition');
  }
}

describe('journal materialization guard', () => {
  it('CursorOnlyHistory rejects journal eager materialization', () => {
    const history = new CursorOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager recomposition',
      );
    } finally {
      history.dispose();
    }
  });
});
const logger = new DebugLogger('test:provider-curated-recomposition');

describe('invoked provider-source reopening', () => {
  for (const size of [512, 8192]) {
    it(`recomposes ${size} tool/media rows through the real source ladder with old-format byte parity`, async () => {
      const pending: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
      ];
      const input = Array.from({ length: size }, (_, index) =>
        providerFixtureRow(index),
      );
      const expected = buildProviderContent(
        input.filter((row) => row.speaker !== 'ai' || row.blocks.length > 0),
        pending,
        logger,
      );
      await withSuffixFixture(
        size,
        async (history) => {
          const actual = await recomposeFixture(history, pending);
          expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
        },
        2048,
        providerFixtureRow,
        undefined,
        (options) => new CursorOnlyHistory(options),
      );
    }, 120_000);
  }
});
