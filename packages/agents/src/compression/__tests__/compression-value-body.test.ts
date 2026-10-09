/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { captureCompressionBody } from './compression-value-openai-body.js';
import {
  middleoutRow,
  middleoutSetup,
  middleoutOracle,
} from './middleout-disk-helpers.js';
import { ValueCompressionHistory } from './compression-value-fixture.js';
import { oneshotOracle } from './oneshot-disk-helpers.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
function bodyRow(index: number, bytes: number): IContent {
  const row = middleoutRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media' && block.encoding === 'base64'
        ? { ...block, data: png }
        : block,
    ),
    metadata: {
      ...row.metadata,
      providerBaseURL: 'https://saved.invalid',
      responsesStored: row.speaker === 'ai',
    },
  };
}

for (const route of ['middle-out', 'one-shot']) {
  describe(`invoked ${route} compression value provider BODY`, () => {
    it.each([512, 8192])(
      'preserves full provider BODY bytes for the actual %i-row value compression with cache off/on and transport/orchestrator retry',
      async (size) => {
        await withSuffixFixture(
          size,
          async (history) => {
            const oracleForRoute =
              route === 'one-shot' ? oneshotOracle : middleoutOracle;
            const expected = await oracleForRoute(history, size, 2048, bodyRow);
            const { handler } = middleoutSetup(history, undefined, undefined, {
              compressionStrategy: route,
            });
            expect(await handler.performCompression('value-body')).toBe(
              PerformCompressionResult.COMPRESSED,
            );
            const pending: IContent[] = [
              { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
            ];
            const independent = buildProviderContent(
              [...expected.rows],
              pending,
              new DebugLogger('test:value-body'),
            );
            for (const provider of [
              'openai',
              'anthropic',
              'openai-responses',
              'gemini',
            ]) {
              for (const caching of [false, true]) {
                const actual = await captureCompressionBody(
                  provider,
                  history.getCuratedForProviderStream(pending),
                  caching,
                  true,
                  true,
                );
                const oracle = await captureCompressionBody(
                  provider,
                  independent,
                  caching,
                );
                expect(actual).toBe(oracle);
              }
            }
          },
          2048,
          bodyRow,
          undefined,
          (options) => new ValueCompressionHistory(options),
        );
      },
      180_000,
    );
  });
}

describe('invoked compression value large row', () => {
  it('publishes a complete valid nine-MiB preserved row through the real value caller without truncating it or changing saved attribution', async () => {
    const bytes = 9 * 1024 * 1024;
    const makeRow = (index: number): IContent =>
      bodyRow(index, index === 0 ? bytes : 2048);
    await withSuffixFixture(
      512,
      async (history) => {
        const { handler } = middleoutSetup(history);
        expect(await handler.performCompression('nine-MiB')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        let first: IContent | undefined;
        for await (const row of history.streamRawHistory()) {
          first = row;
          break;
        }
        const expected = makeRow(0);
        delete expected.metadata?.cacheAnchor;
        expect(first).toStrictEqual(expected);
        const block = first?.blocks[0];
        expect(block?.type === 'text' ? Buffer.byteLength(block.text) : 0).toBe(
          bytes + 2,
        );
        expect(first?.metadata?.model).toBe('historical-model');
        expect(history.getCacheAnchorSeq()).toBeGreaterThan(0);
      },
      2048,
      makeRow,
      undefined,
      (options) => new ValueCompressionHistory(options),
    );
  }, 180_000);
});
