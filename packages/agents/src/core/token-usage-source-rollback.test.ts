/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  fallbackCount,
  independentSeed,
  seedTool,
  shapeRow,
  shapeState,
} from './__tests__/support/token-usage-source-fixture.js';

function failureMessage(failure: string): string {
  if (failure === 'disk') return 'Provider request snapshot is closed';
  if (failure === 'counter') return 'counter-failure';
  return failure;
}
const root = sourceRootSetup();
describe('source shape transactional session state', () => {
  it.each(['counter', 'abort-row', 'abort-finish', 'disk'])(
    'preserves cache FIFO, fingerprint and sent ids after %s failure',
    async (failure) => {
      const memory = new RequestShapeSessionMemory(8);
      const baseline = memory.recordRequestShape({
        requestContents: [seedTool()],
        tools: [],
        instructionsText: undefined,
        countTokens: fallbackCount,
      });
      const before = independentSeed();
      const initial: unknown = baseline;
      expect(initial).toStrictEqual(before.shape);
      const rows = await prepareProviderContentSnapshot(
        {
          async *[Symbol.asyncIterator](): AsyncGenerator<
            IContent,
            void,
            unknown
          > {
            for (let index = 0; index < 64; index++)
              yield shapeRow('stable', index, 0);
          },
        },
        [],
        new DebugLogger('source-shape-rollback'),
        { root: root() },
      );
      const controller = new AbortController();
      let count = 0;
      const countTokens = (text: string): number => {
        if (++count === 10) {
          if (failure === 'counter') throw new Error('counter-failure');
          if (failure === 'abort-row') controller.abort(new Error('abort-row'));
          if (failure === 'disk') rows.close();
        }
        if (failure === 'abort-finish' && text === 'finish')
          controller.abort(new Error('abort-finish'));
        return fallbackCount(text);
      };
      try {
        await expect(
          memory.recordSourceRequestShape({
            requestRows: rows,
            tools: [],
            instructionsText: 'finish',
            countTokens,
            signal: controller.signal,
          }),
        ).rejects.toThrow(failureMessage(failure));
        const currentState: unknown = shapeState(memory);
        expect(currentState).toStrictEqual(before.state);
        const probe = memory.recordRequestShape({
          requestContents: [seedTool()],
          tools: [],
          instructionsText: undefined,
          countTokens: fallbackCount,
        });
        expect(probe.prefixFingerprint).toBe(baseline.prefixFingerprint);
        expect(probe.prefixFingerprintChanged).toBe(false);
        expect(probe.carriedToolResultTokens).toBe(
          baseline.newToolResultTokens,
        );
      } finally {
        rows.close();
      }
    },
  );
});
