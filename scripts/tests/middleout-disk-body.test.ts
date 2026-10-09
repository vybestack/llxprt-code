/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import {
  middleoutSetup,
  middleoutOracle,
  middleoutRow,
  MiddleoutDiskHistory,
} from '../../packages/agents/src/compression/__tests__/middleout-disk-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';

import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { isSpeakerContent } from '../../packages/core/src/services/history/historyJournalGuards.js';

function summaryRows(json: string): IContent[] {
  const rows: unknown = JSON.parse(json);
  if (!Array.isArray(rows) || !rows.every(isSpeakerContent))
    throw new Error('Invalid captured summary rows');
  return rows;
}
async function compareSummaryBody(
  size: number,
  provider: string,
  caching: boolean,
  actualContents: string,
  expectedContents: string,
): Promise<number> {
  const actual = await captureCuratedBody(
    provider,
    summaryRows(actualContents),
    caching,
    true,
    true,
  );
  const expected = await captureCuratedBody(
    provider,
    summaryRows(expectedContents),
    caching,
  );
  await savePair(
    `summary-body-${provider}-${size}-${caching}`,
    actual,
    expected,
  );
  expect(actual).toBe(expected);
  return actual.length;
}

const logger = new DebugLogger('test:middleout-body');
async function savePair(
  name: string,
  actual: string,
  expected: string,
): Promise<void> {
  const output = process.env.MIDDLEOUT_DISK_BODY_OUTPUT;
  if (output === undefined) return;
  await writeBodyFile(join(output, name + '-actual.json'), actual);
  await writeBodyFile(join(output, name + '-expected.json'), expected);
}

async function bodyPair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const pending = providerPendingFixture();
      const raw = Array.from({ length: size }, (_, index) =>
        middleoutRow(index),
      );
      const expected = await middleoutOracle(history, size);
      const { handler, transport } = middleoutSetup(history);
      for (const stage of ['before', 'after']) {
        if (stage === 'after')
          expect(await handler.performCompression('wire')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
        const actualRows = await recomposeFixture(history, pending);
        const oracleRows = buildProviderContent(
          buildCuratedHistory(
            logger,
            stage === 'before' ? raw : expected.rows,
            false,
          ),
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
          oracleRows,
          caching,
        );
        await savePair(
          `${stage}-${provider}-${size}-${caching}`,
          actual,
          expectedBody,
        );
        expect(actual).toBe(expectedBody);
      }
      expect(transport.requests).toStrictEqual(expected.requests);
      await savePair(
        `summary-contents-${provider}-${size}-${caching}`,
        transport.requests[0],
        expected.requests[0],
      );
      return compareSummaryBody(
        size,
        provider,
        caching,
        transport.requests[0],
        expected.requests[0],
      );
    },
    2048,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}
const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
describe('BODY BYTES around invoked disk middle-out', () => {
  it.each(cases)(
    'matches independent %i-row %s requests with caching %s and transport retry',
    async (size, provider, caching) => {
      expect(await bodyPair(size, provider, caching)).toBeGreaterThan(0);
    },
    180_000,
  );
});
