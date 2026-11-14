/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { computeMarginAdjustedLimit } from '../compression/contextLimitPolicy.js';
import { largestSourceRowBytes } from './__tests__/support/streamprocessor-source-fixture.js';
import { ladderAttempt } from './__tests__/support/source-compression-ladder-fixture.js';

const root = sourceRootSetup();
/**
 * A catalogued 128,000-token window holds the five-chunk protected tail,
 * but accumulated earlier turns require compression before sending.
 */
const FITS_TAIL_LIMIT = 128_000;
/** Two 64 KiB chunks: still over the 4000-token limit, small enough for the array route. */
const OVER_LIMIT_SMALL_TAIL = 2;
const SMALL_LIMIT = 4000;

function assertSourceSuccess(
  source: Awaited<ReturnType<typeof ladderAttempt>>,
  limit = SMALL_LIMIT,
): void {
  expect(source.activeBodies).toBe(0);
  expect(source.owners.every((owner) => owner.closed)).toBe(true);
  expect(source.error).toBeUndefined();
  expect(source.bodies).toHaveLength(1);
  expect(source.estimate?.estimatedPromptTokens).toBeLessThanOrEqual(
    computeMarginAdjustedLimit(limit) - 128,
  );
}

function assertStructuredOverflow(
  attempt: Awaited<ReturnType<typeof ladderAttempt>>,
): void {
  expect(attempt.activeBodies).toBe(0);
  expect(attempt.owners.every((owner) => owner.closed)).toBe(true);
  expect(attempt.errorName).toBe('ContextOverflowError');
  expect(attempt.error).toContain(
    'Request still exceeds the safety-adjusted context limit (3015 tokens).',
  );
  expect(attempt.error).toContain(
    'Last-resort tool-response truncation replaced 0 response(s)',
  );
  expect(attempt.bodies).toHaveLength(0);
}

describe('required real disk compression HTTP parity with the unchanged array route', () => {
  it('compresses manageable configured over-limit history and matches complete array HTTP and response bytes', async () => {
    const array = await ladderAttempt(root(), false, false);
    const source = await ladderAttempt(root(), true, false);
    expect(array.error).toBeUndefined();
    expect(array.bodies).toHaveLength(1);
    expect(array.estimate?.estimatedPromptTokens).toBeLessThanOrEqual(
      computeMarginAdjustedLimit(SMALL_LIMIT) - 128,
    );
    assertSourceSuccess(source);
    expect(source.bodies).toStrictEqual(array.bodies);
    expect(source.output).toStrictEqual(array.output);
    expect(source.estimate).toStrictEqual(array.estimate);
  }, 600000);

  it('sends a realistic protected tail after earlier history overflows the model window', async () => {
    const tail = { mixedChunks: 5 };
    const source = await ladderAttempt(root(), true, tail, FITS_TAIL_LIMIT);
    expect(source.initialHistoryTokens).toBeGreaterThan(FITS_TAIL_LIMIT);
    assertSourceSuccess(source, FITS_TAIL_LIMIT);
    expect(source.bodies[0]?.bytes).toBeGreaterThan(
      largestSourceRowBytes(tail),
    );
    expect(source.after).not.toBe(source.before);
  }, 600000);

  it('returns the structured overflow when the protected tail alone exceeds the limit, matching the array route', async () => {
    const array = await ladderAttempt(
      root(),
      false,
      OVER_LIMIT_SMALL_TAIL,
      SMALL_LIMIT,
    );
    const source = await ladderAttempt(
      root(),
      true,
      OVER_LIMIT_SMALL_TAIL,
      SMALL_LIMIT,
    );
    assertStructuredOverflow(array);
    assertStructuredOverflow(source);
    expect(source.error).toBe(array.error);
    expect(source.historyTokens).toBe(array.historyTokens);
    expect(source.cooldown).toBe(array.cooldown);
  }, 600000);

  it('returns the structured overflow when a valid row above 10MiB is the protected tail and exceeds the limit', async () => {
    const source = await ladderAttempt(
      root(),
      true,
      { mixedChunks: 161 },
      SMALL_LIMIT,
    );
    expect(source.errorName).toBe('ContextOverflowError');
    assertStructuredOverflow(source);
  }, 600000);
});
