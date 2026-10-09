/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendBodyEvidence } from '../../../../../scripts/lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { captureCompressionBody } from './compression-value-openai-body.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { withRollbackFixture } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  purgeRankingRows,
  expectedPurgeRankingRow,
  prepareValueRoute,
  type ValueRoute,
} from './purge-ranking-value-helpers.js';

async function compareBodies(
  history: HistoryService,
  route: ValueRoute,
  size: number,
  bytes: number,
  before: Awaited<ReturnType<typeof detachedDigest>>,
  expected: Awaited<ReturnType<typeof detachedDigest>>,
  beforeTokens: number,
): Promise<number> {
  const independent = buildProviderContent(
    Array.from({ length: size }, (_, index) =>
      expectedPurgeRankingRow(route, index, size, bytes),
    ),
    [],
    new DebugLogger('test:purge-ranking-body'),
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
        history.getCuratedForProviderStream([]),
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
            route,
            size,
            bytes,
            provider,
            caching,
            before,
            expected,
            beforeTokens,
            tokens: history.getTotalTokens(),
            range: history.getContextRange(),
            bodyBytes: Buffer.byteLength(actual),
            sha256: createHash('sha256').update(actual).digest('hex'),
          },
          actual,
          oracle,
        );
      expect(actual).toBe(oracle);
      expect(actual).toContain('x'.repeat(bytes));
      if (route === 'purge')
        expect(Buffer.byteLength(actual)).toBeGreaterThan(size * bytes);

      compared++;
    }
  }
  return compared;
}

async function verifyBody(
  route: ValueRoute,
  size: number,
  bytes: number,
): Promise<number> {
  return withRollbackFixture(async (history, recorder) => {
    await history.detachedValues.replace(purgeRankingRows(size, bytes));
    const before = await detachedDigest(purgeRankingRows(size, bytes));
    const beforeTokens = size * 2 + 1000;
    expect(history.getTotalTokens()).toBe(beforeTokens);
    const prepared = await prepareValueRoute(history, route, size);
    try {
      expect(await prepared.execute()).toBe(true);
      await history.waitForCommit();
      const expected = await detachedDigest(
        purgeRankingRows(size, bytes, route),
      );
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      const compared = await compareBodies(
        history,
        route,
        size,
        bytes,
        before,
        expected,
        beforeTokens,
      );
      if (route === 'purge') {
        await prepared.rollback();
        expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
        expect(history.getTotalTokens()).toBe(beforeTokens);
      }
      return compared;
    } finally {
      prepared.close();
    }
  });
}

describe('real purge and ranked response complete provider BODY', () => {
  for (const route of ['purge', 'ranking'] satisfies ValueRoute[]) {
    for (const size of [512, 8192]) {
      it(`${route} preserves full ${size}-row values, pairing, cache and retry BODY`, async () => {
        expect(await verifyBody(route, size, 2048)).toBe(8);
      }, 180_000);
    }
    it(`${route} accepts complete valid input larger than nine MiB`, async () => {
      expect(await verifyBody(route, 1, 9 * 1024 * 1024 + 1)).toBe(8);
    }, 180_000);
  }
});
