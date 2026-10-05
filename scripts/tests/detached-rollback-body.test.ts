/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { rejectedValue } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { withDetachedFixture } from '../../packages/core/src/services/history/detached-rollback-test-helpers.js';

async function rollbackBodies(size: number): Promise<number> {
  return withDetachedFixture(async ({ history, recorder }) => {
    for (let index = 0; index < size; index++)
      await recorder.commit('content', {
        content: providerFarFixtureRow(index),
      });
    const failure = new Error('rollback before provider body');
    expect(
      await rejectedValue(
        history.detachedValues.transform(
          async (source, sink) => {
            for await (const row of source.streamRows())
              sink.appendValue({
                ...row,
                blocks: [{ type: 'text', text: 'discarded candidate' }],
              });
          },
          undefined,
          {
            onAcknowledged: () => {
              throw failure;
            },
          },
        ),
      ),
    ).toBe(failure);
    const pending = providerPendingFixture();
    const actualRows = await recomposeFixture(history, pending);
    const expectedRows = buildProviderContent(
      Array.from({ length: size }, (_, index) =>
        providerFarFixtureRow(index),
      ).filter((row) => row.speaker !== 'ai' || row.blocks.length > 0),
      pending,
      new DebugLogger('test:detached-rollback-body'),
    );
    for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
      for (const caching of [false, true]) {
        const actual = await captureCuratedBody(
          provider,
          actualRows,
          caching,
          true,
          true,
        );
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
        );
        expect(actual).toBe(expected);
      }
    }
    return history.getContextRange().totalEntries;
  });
}

describe('provider BODY after opt-in detached rollback', () => {
  for (const size of [512, 8192]) {
    it(`restores exact ${size}-row bodies for provider, cache and retry variants`, async () => {
      expect(await rollbackBodies(size)).toBe(size);
    }, 180_000);
  }
});
