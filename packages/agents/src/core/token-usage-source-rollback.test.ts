/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeRequestFixture } from './__tests__/support/native-request-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestShapeTracker } from './tokenUsageRequestShape.js';
import {
  fallbackCount,
  seedTool,
  shapeRow,
  shapeState,
} from './__tests__/support/token-usage-source-fixture.js';

function failureMessage(failure: string): string {
  if (failure === 'disk') return 'Provider request snapshot is closed';
  if (failure === 'counter') return 'counter-failure';
  return failure;
}
describe('source shape transactional session state', () => {
  it.each(['counter', 'abort-row', 'abort-finish', 'disk'])(
    'preserves sequence and fingerprint after %s failure',
    async (failure) => {
      const memory = new RequestShapeTracker();
      const baseline = memory.recordRequestShape({
        requestContents: [seedTool()],
        tools: [],
        instructionsText: undefined,
        countTokens: fallbackCount,
      });
      const before = { state: shapeState(memory), cursor: memory.snapshot() };
      expect(before.state).toMatchObject({ retainedEntries: 0 });
      const rows = await nativeRequestFixture(
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
      );
      const controller = new AbortController();
      let count = 0;
      const countTokens = (text: string): number => {
        if (++count === 10) {
          if (failure === 'counter') throw new Error('counter-failure');
          if (failure === 'abort-row') controller.abort(new Error('abort-row'));
          if (failure === 'disk') void rows.close();
        }
        if (failure === 'abort-finish' && text === 'finish')
          controller.abort(new Error('abort-finish'));
        return fallbackCount(text);
      };
      try {
        await expect(
          memory.recordSourceRequestShape({
            requestRows: {
              count: rows.count,
              readAt: (index, signal) => rows.readAt(index, signal),
              openReader: (signal) => rows.openReader(signal),
            },
            tools: [],
            instructionsText: 'finish',
            countTokens,
            signal: controller.signal,
          }),
        ).rejects.toThrow(failureMessage(failure));
        const currentState: unknown = shapeState(memory);
        expect(currentState).toStrictEqual(before.state);
        expect(memory.snapshot()).toStrictEqual(before.cursor);
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
        await rows.close();
      }
    },
  );
});
