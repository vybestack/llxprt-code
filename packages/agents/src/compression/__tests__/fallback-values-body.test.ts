/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendBodyEvidence } from '../../../../../scripts/lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { captureCompressionBody } from './compression-value-openai-body.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function compareBodies(
  history: HistoryService,
  size: number,
  bytes: number,
): Promise<number> {
  const pending: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  ];
  const independent = buildProviderContent(
    Array.from({ length: size }, (_, index) => suffixRow(index, bytes)),
    pending,
    new DebugLogger('test:fallback-values-body'),
  );
  let compared = 0;
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
      const output = process.env.TRANSFORM_BODY_OUTPUT;
      if (output !== undefined)
        await appendBodyEvidence(
          output,
          {
            size,
            bytes,
            provider,
            caching,
            bodyBytes: Buffer.byteLength(actual),
            sha256: createHash('sha256').update(actual).digest('hex'),
          },
          actual,
          oracle,
        );
      expect(actual).toBe(oracle);
      expect(actual).toContain(`${size - 1}:${'x'.repeat(bytes)}`);

      compared++;
    }
  }
  return compared;
}

async function verifyBody(size: number, bytes: number): Promise<number> {
  return withValueTransformFixture(async ({ history }) => {
    const rows = new DetachedHistoryJournal();
    try {
      for (let index = 0; index < size; index++)
        rows.append(suffixRow(index, bytes));
      await publishProviderFallbackCandidate(
        history,
        { rows, start: 0, hasPendingRows: true },
        'test',
      );
      return await compareBodies(history, size, bytes);
    } finally {
      rows.close();
    }
  });
}

describe('fallback candidate complete provider BODY', () => {
  for (const size of [512, 8192]) {
    it(`matches all four provider BODYs with cache and both retries at ${size}`, async () => {
      expect(await verifyBody(size, 2048)).toBe(8);
    }, 180_000);
  }
  it('keeps every byte of a valid input larger than nine MiB', async () => {
    expect(await verifyBody(1, 9 * 1024 * 1024 + 1)).toBe(8);
  }, 180_000);
});
