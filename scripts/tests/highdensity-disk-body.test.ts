/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import {
  highdensitySetup,
  highdensityOracle,
  highdensityRow,
  HighdensityDiskHistory,
} from '../../packages/agents/src/compression/__tests__/highdensity-disk-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

const logger = new DebugLogger('test:highdensity-disk-bytes');
async function compareBody(
  size: number,
  provider: string,
  caching: boolean,
  stage: string,
  actualRows: readonly IContent[],
  expectedRows: readonly IContent[],
): Promise<number> {
  const actual = await captureCuratedBody(
    provider,
    actualRows,
    caching,
    true,
    true,
  );
  const expected = await captureCuratedBody(provider, expectedRows, caching);
  const output = process.env.HIGHDENSITY_BODY_OUTPUT;
  if (output !== undefined) {
    const name = `highdensity-${stage}-${provider}-${size}-${caching}`;
    await writeBodyFile(join(output, name + '-actual.json'), actual);
    await writeBodyFile(join(output, name + '-expected.json'), expected);
  }
  expect(actual).toBe(expected);
  return actual.length;
}

async function bodyPair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const expected = await highdensityOracle(history, size);
      const raw = Array.from({ length: size }, (_, index) =>
        highdensityRow(index),
      );
      const pending = providerPendingFixture();
      let bytes = 0;
      for (const stage of ['before', 'after']) {
        if (stage === 'after')
          expect(
            await highdensitySetup(history).handler.performCompression('body'),
          ).toBe(PerformCompressionResult.COMPRESSED);
        const actualRows = await recomposeFixture(history, pending);
        const expectedRows = buildProviderContent(
          buildCuratedHistory(
            logger,
            stage === 'before' ? raw : expected,
            false,
          ),
          pending,
          logger,
        );
        bytes += await compareBody(
          size,
          provider,
          caching,
          stage,
          actualRows,
          expectedRows,
        );
      }
      return bytes;
    },
    2048,
    highdensityRow,
    undefined,
    (options) => new HighdensityDiskHistory(options),
  );
}
const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
describe('BODY BYTES around invoked disk high-density compression', () => {
  it.each(cases)(
    'matches independent legacy %i-row %s bodies with caching %s and identical transport retries',
    async (size, provider, caching) => {
      expect(await bodyPair(size, provider, caching)).toBeGreaterThan(0);
    },
    600_000,
  );
});
