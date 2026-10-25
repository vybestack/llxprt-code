/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/__tests__/support/provider-curated-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-gemini.js';

describe('BODY fixture candidate estimation', () => {
  it('preserves complete tool results and raw history without inventing a token reduction', async () => {
    await withSuffixFixture(
      16,
      async (history) => {
        const original = await history.openDumpSnapshot();
        try {
          const logger = new DebugLogger('test:recomposition-estimate-body');
          const pending = providerPendingFixture();
          const expected = buildProviderContent(
            buildCuratedHistory(
              logger,
              Array.from({ length: 16 }, (_, index) =>
                providerFarFixtureRow(index),
              ),
              false,
            ),
            pending,
            logger,
          );
          const actual = await recomposeFixture(history, pending);
          expect(await captureCuratedBody('anthropic', actual, true)).toBe(
            await captureCuratedBody('anthropic', expected, true),
          );
          const before = [];
          for await (const row of original.rows()) before.push(row);
          const after = [];
          for await (const row of history.streamRawHistory()) after.push(row);
          expect(after).toStrictEqual(before);
        } finally {
          await original.close();
        }
      },
      2048,
      providerFarFixtureRow,
    );
  });
});
