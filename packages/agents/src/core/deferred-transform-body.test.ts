/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendBodyEvidence } from '../../../../scripts/lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { admitDeferredHistorySource } from './deferredHistorySource.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { captureCompressionBody } from '../compression/__tests__/compression-value-openai-body.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function* bodyInput(
  size: number,
  bytes: number,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, bytes);
}

async function compareBodies(
  history: HistoryService,
  size: number,
  bytes: number,
): Promise<number> {
  const pending: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  ];
  const oracleRows = Array.from({ length: size }, (_, index) =>
    suffixRow(index, bytes),
  );
  const independent = buildProviderContent(
    oracleRows,
    pending,
    new DebugLogger('test:transform-value-body'),
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
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  try {
    return await withValueTransformFixture(async ({ history, owners }) => {
      const release = await admitDeferredHistorySource(
        history,
        bodyInput(size, bytes),
        internalConfig(agent).getLocalMediaStore(),
        { ownership: owners },
        'fake-model',
      );
      try {
        return await compareBodies(history, size, bytes);
      } finally {
        await release();
      }
    });
  } finally {
    await cleanup();
  }
}

describe('deferred transform complete provider BODY', () => {
  for (const size of [512, 8192]) {
    it(`matches all four provider BODYs with cache and retry at ${size}`, async () => {
      expect(await verifyBody(size, 2048)).toBe(8);
    }, 180_000);
  }
  it('keeps the complete oversized valid input in every provider BODY', async () => {
    expect(await verifyBody(1, 9 * 1024 * 1024 + 1)).toBe(8);
  }, 180_000);
});
