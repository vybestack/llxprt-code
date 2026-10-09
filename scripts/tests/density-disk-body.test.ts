/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import {
  densityHandler,
  densityOracle,
  densityRow,
  DensityDiskHistory,
} from '../../packages/agents/src/compression/__tests__/density-disk-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

const logger = new DebugLogger('test:density-disk-bytes');
async function bodyPair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      const expected = densityOracle(size);
      await densityHandler(history).ensureDensityOptimized();
      const pending = providerPendingFixture();
      const actualRows = await recomposeFixture(history, pending);
      const expectedRows = buildProviderContent(
        buildCuratedHistory(logger, expected, false),
        pending,
        logger,
      );
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        true,
        true,
      );
      const expectedBody = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.DENSITY_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `density-${provider}-${size}-${caching}`;
        await writeBodyFile(join(output, name + '-actual.json'), actual);
        await writeBodyFile(
          join(output, name + '-expected.json'),
          expectedBody,
        );
      }
      expect(actual).toBe(expectedBody);
      expect(actual.length).toBeGreaterThan(0);
    },
    2048,
    densityRow,
    undefined,
    (options) => new DensityDiskHistory(options),
  );
}
const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
describe('BODY BYTES after invoked disk density optimization', () => {
  it.each(cases)(
    'matches independent legacy %i-row %s bodies with caching %s',
    bodyPair,
    600_000,
  );
});
