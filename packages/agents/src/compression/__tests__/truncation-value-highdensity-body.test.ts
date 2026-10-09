/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendBodyEvidence } from '../../../../test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  highdensityRow,
  highdensityOracle,
  highdensitySetup,
} from './highdensity-disk-helpers.js';
import { captureTruncationBody } from './truncation-value-body-capture.js';

function bodyInput(index: number): IContent {
  const row = highdensityRow(index);
  return row.blocks.length === 0
    ? { ...row, blocks: [{ type: 'text', text: `valid-prefix-${index}` }] }
    : row;
}

async function compare(size: number): Promise<number> {
  return withValueTransformFixture(async ({ history }) => {
    await history.detachedValues.replace(
      (async function* () {
        for (let index = 0; index < size; index++) yield bodyInput(index);
      })(),
    );
    const oracle = await highdensityOracle(history, size, 2048, bodyInput);
    const independent = buildProviderContent(
      [...oracle],
      [],
      new DebugLogger('test:highdensity-value-body'),
    );
    const { handler } = highdensitySetup(history);
    await handler.performCompression('highdensity-body');
    let count = 0;
    for (const provider of [
      'openai',
      'anthropic',
      'openai-responses',
      'gemini',
    ]) {
      for (const caching of [false, true]) {
        const response: IContent[] = [];
        const expectedResponse: IContent[] = [];
        const actual = await captureTruncationBody(
          provider,
          history.getCuratedForProviderStream([]),
          caching,
          true,
          true,
          response,
        );
        const expected = await captureTruncationBody(
          provider,
          independent,
          caching,
          false,
          false,
          expectedResponse,
        );
        const output = process.env.TRUNCATION_HIGHDENSITY_BODY_OUTPUT;
        if (output !== undefined)
          await appendBodyEvidence(
            output,
            {
              size,
              candidateRows: oracle.length,
              provider,
              caching,
              bodyBytes: Buffer.byteLength(actual),
              sha256: createHash('sha256').update(actual).digest('hex'),
              response: JSON.stringify(response),
            },
            actual,
            expected,
          );
        expect(actual).toBe(expected);
        expect(JSON.stringify(response)).toBe(JSON.stringify(expectedResponse));
        expect(
          response
            .flatMap((row) => row.blocks)
            .filter((block) => block.type === 'text').length,
        ).toBeGreaterThan(0);

        count++;
      }
    }
    return count;
  });
}

describe('high-density shared publication complete provider request and response BODY', () => {
  it.each([512, 8192])(
    'compares the full %i-row route against the eager output oracle',
    async (size) => {
      expect(await compare(size)).toBe(8);
    },
    180_000,
  );
});
