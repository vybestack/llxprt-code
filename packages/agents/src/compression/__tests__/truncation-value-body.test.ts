/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { withRollbackFixture } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { captureTruncationBody } from './truncation-value-body-capture.js';
import {
  executeTruncation,
  truncationValues,
  expectedTruncationValue,
} from './truncation-value-helpers.js';

type BodyFixture = {
  size: number;
  start: number;
  bytes: number;
  independent: IContent[];
  expected: Awaited<ReturnType<typeof detachedDigest>>;
};

async function compareBody(
  history: HistoryService,
  fixture: BodyFixture,
  provider: string,
  caching: boolean,
): Promise<void> {
  const { size, start, bytes, independent, expected } = fixture;
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
  const oracle = await captureTruncationBody(
    provider,
    independent,
    caching,
    false,
    false,
    expectedResponse,
  );
  expect(actual).toBe(oracle);
  expect(actual).toContain('x'.repeat(bytes));
  expect(Buffer.byteLength(actual)).toBeGreaterThan((size - start) * bytes);
  expect(JSON.stringify(response)).toBe(JSON.stringify(expectedResponse));
  expect(
    response
      .flatMap((row) => row.blocks)
      .filter((block) => block.type === 'text').length,
  ).toBeGreaterThan(0);
  const output = process.env.TRANSFORM_BODY_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({
        size,
        bytes,
        provider,
        caching,
        expected,
        tokens: size - start,
        bodyBytes: Buffer.byteLength(actual),
        sha256: createHash('sha256').update(actual).digest('hex'),
      }) + '\n',
    );
  const responseOutput = process.env.TRUNCATION_RESPONSE_OUTPUT;
  if (responseOutput !== undefined)
    appendFileSync(
      responseOutput,
      JSON.stringify({
        size,
        bytes,
        provider,
        caching,
        actual: JSON.stringify(response),
        expected: JSON.stringify(expectedResponse),
      }) + '\n',
    );
}

async function bodies(size: number, bytes: number): Promise<number> {
  return withRollbackFixture(async (history, recorder) => {
    await history.detachedValues.replace(truncationValues(size, 0, bytes));
    history.setCacheAnchorSeq(1);
    const start = size > 11 ? 11 : 1;
    const result = await executeTruncation(history, size);
    expect(result.outcome).toBe('applied');
    expect(result.summary).toBeUndefined();
    await history.waitForCommit();
    const expected = await detachedDigest(
      truncationValues(size, start, bytes, true),
    );
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getTotalTokens()).toBe(size - start);
    expect(history.getCacheAnchorSeq()).toBe(0);
    const independent = buildProviderContent(
      Array.from({ length: size - start }, (_, index) =>
        expectedTruncationValue(index + start, start, bytes),
      ),
      [],
      new DebugLogger('test:truncation-body'),
    );
    let compared = 0;
    for (const provider of [
      'openai',
      'anthropic',
      'openai-responses',
      'gemini',
    ]) {
      for (const caching of [false, true]) {
        await compareBody(
          history,
          { size, start, bytes, independent, expected },
          provider,
          caching,
        );
        compared++;
      }
    }
    return compared;
  });
}

describe('truncation complete provider BODY and independent value order', () => {
  it.each([512, 8192])(
    'keeps every surviving payload in the full %i-row input',
    async (size) => {
      expect(await bodies(size, 2048)).toBe(8);
    },
    180_000,
  );
  it('keeps valid rows larger than nine MiB without a row-size ban', async () => {
    expect(await bodies(3, 9 * 1024 * 1024 + 1)).toBe(8);
  }, 180_000);
});
