/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  detachedRow,
  withDetachedFixture,
} from '../../../../core/src/services/history/detached-rollback-test-helpers.js';
import { captureCompressionBody } from './compression-value-openai-body.js';

function row(index: number, bytes = 2048): IContent {
  const value = detachedRow(index, bytes);
  return {
    ...value,
    blocks: value.blocks.map((block) =>
      block.type === 'media' && block.encoding === 'base64'
        ? {
            ...block,
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          }
        : block,
    ),
  };
}

async function verifyBody(size: number, bytes: number): Promise<number> {
  return withDetachedFixture(async ({ history }) => {
    await history.addBatch(
      Array.from({ length: size }, (_unused, index) => row(index, bytes)),
    );
    const independent = buildProviderContent(
      Array.from({ length: size }, (_unused, index) => row(index, bytes)),
      [],
      new DebugLogger('test:append-value-body'),
    );
    let comparisons = 0;
    for (const provider of [
      'openai',
      'anthropic',
      'openai-responses',
      'gemini',
    ]) {
      for (const caching of [false, true]) {
        const actual = await captureCompressionBody(
          provider,
          history.getCuratedForProviderStream([]),
          caching,
          true,
          true,
        );
        const expected = await captureCompressionBody(
          provider,
          independent,
          caching,
        );
        expect(actual).toBe(expected);
        comparisons++;
      }
    }
    return comparisons;
  });
}

describe('addBatch full provider BODY value equivalence', () => {
  for (const size of [512, 8192]) {
    it(`preserves ${size} complete rows with four providers, cache and both retry layers`, async () => {
      expect(await verifyBody(size, 2048)).toBe(8);
    }, 180_000);
  }
  it('preserves a complete submitted row larger than nine MiB at transport', async () => {
    expect(await verifyBody(1, 9 * 1024 * 1024 + 1)).toBe(8);
  }, 180_000);
});
