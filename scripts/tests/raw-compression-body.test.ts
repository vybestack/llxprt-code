/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { annotateCompressionSpan } from '../../packages/core/src/services/history/historyChronology.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../../packages/core/src/services/history/IContent.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { applyCompressionWithAnchor } from '../../packages/agents/src/compression/cacheAnchor.js';
import {
  CursorCompressionHistory,
  summaryRow,
} from '../../packages/agents/src/compression/__tests__/raw-compression-fixtures.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

const logger = new DebugLogger('test:raw-compression-body');

function candidate(size: number): IContent[] {
  return [
    providerFarFixtureRow(0),
    providerFarFixtureRow(1),
    providerFarFixtureRow(2),
    summaryRow(),
    ...Array.from({ length: 6 }, (_, index) =>
      providerFarFixtureRow(size - 6 + index),
    ),
  ];
}

function legacyCompression(size: number): IContent[] {
  const input = Array.from({ length: size }, (_, index) =>
    providerFarFixtureRow(index),
  );
  const annotated = annotateCompressionSpan(input, candidate(size));
  return invalidateResponsesStatefulChain(
    annotated.map((row, index) => {
      const metadata = { ...row.metadata };
      delete metadata.cacheAnchor;
      if (index === 2) metadata.cacheAnchor = true;
      return { ...row, metadata };
    }),
  );
}

async function bodies(
  size: number,
  provider: string,
  caching: boolean,
): Promise<{ actual: string; expected: string }> {
  return withSuffixFixture(
    size,
    async (history) => {
      await applyCompressionWithAnchor(history, candidate(size), 3, 'test');
      const pending = providerPendingFixture();
      const actualRows = await recomposeFixture(history, pending);
      const expectedRows = buildProviderContent(
        legacyCompression(size).filter(
          (row) => row.speaker !== 'ai' || row.blocks.length > 0,
        ),
        pending,
        logger,
      );
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        provider === 'openai-responses',
      );
      const expected = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.RAW_COMPRESSION_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `compressed-${provider}-${size}-${caching}`;
        await writeBodyFile(join(output, name + '-actual.json'), actual);
        await writeBodyFile(join(output, name + '-expected.json'), expected);
      }
      return { actual, expected };
    },
    2048,
    providerFarFixtureRow,
    undefined,
    (options) => new CursorCompressionHistory(options),
  );
}

const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);

describe('provider BODY BYTES after invoked raw-stream compression annotation', () => {
  it.each(cases)(
    'preserves %i-row %s compressed bytes with caching %s',
    async (size, provider, caching) => {
      const { actual, expected } = await bodies(size, provider, caching);
      expect(actual).toBe(expected);
      expect(actual.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
