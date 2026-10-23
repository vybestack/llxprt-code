import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { providerFixtureRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/provider-curated-test-helpers.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  suffixSeeder,
  withSuffixFixtureGraph,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { describe, expect, it } from 'bun:test';
import { recomposeFixture } from './provider-curated-recomposition-helpers.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager recomposition');
  }

  async eagerRowsForTest(): Promise<IContent[]> {
    return this.journal.materialize();
  }
}

describe('journal materialization guard', () => {
  it('CursorOnlyHistory rejects journal eager materialization', async () => {
    const history = new CursorOnlyHistory();

    try {
      await expect(history.eagerRowsForTest()).rejects.toThrow(
        'eager recomposition',
      );
    } finally {
      await history.dispose();
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
      const backendBytes: string[] = [];
      for (const _backend of [0, 1]) {
        await withSuffixFixtureGraph(
          size,
          (root) => {
            const recording = createRecorderForTest({ chatsDir: root });
            const service = new CursorOnlyHistory({ recording });
            return {
              service,
              recording,
              ownership: undefined,
              counters: undefined,
              seed: suffixSeeder(recording, service),
            };
          },
          async (history) => {
            const actual = await recomposeFixture(
              history,
              structuredClone(pending),
            );
            const bytes = JSON.stringify(actual);
            expect(bytes).toBe(JSON.stringify(expected));
            backendBytes.push(bytes);
          },
          2048,
          (index) => structuredClone(input[index]),
        );
      }
      expect(backendBytes).toHaveLength(2);
      expect(backendBytes[1]).toBe(backendBytes[0]);
    }, 120_000);
  }
});
