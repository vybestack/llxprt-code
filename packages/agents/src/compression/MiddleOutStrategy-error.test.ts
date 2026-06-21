/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 *
 * Error-handling behavioral tests for MiddleOutStrategy: empty summary
 * handling and transient error classification.
 */

import { describe, it, expect } from 'vitest';
import {
  EmptySummaryError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  buildContext,
  createFakeProvider,
  generateHistory,
  testProviderRuntime,
} from './MiddleOutStrategy-test-helpers.js';

describe('MiddleOutStrategy empty summary handling', () => {
  /**
   * Helper: runs compress and returns the thrown error, asserting it throws.
   */
  async function captureCompressError(
    ctx: Parameters<MiddleOutStrategy['compress']>[0],
  ): Promise<unknown> {
    const strategy = new MiddleOutStrategy();
    try {
      await strategy.compress(ctx);
      throw new Error('Expected compress() to throw but it did not');
    } catch (error) {
      return error;
    }
  }

  it('throws EmptySummaryError when LLM returns empty summary', async () => {
    const emptyProvider = createFakeProvider('empty-provider', '');
    const history = generateHistory(20);
    const ctx = buildContext({
      history,
      resolveProvider: () => ({
        provider: emptyProvider,
        runtime: testProviderRuntime,
      }),
    });

    const error = await captureCompressError(ctx);
    expect(error).toBeInstanceOf(EmptySummaryError);
    expect(isTransientCompressionError(error)).toBe(false);
  });

  it('throws EmptySummaryError when LLM returns whitespace-only summary', async () => {
    const whitespaceProvider = createFakeProvider(
      'whitespace-provider',
      '   \n  \t  ',
    );
    const history = generateHistory(20);
    const ctx = buildContext({
      history,
      resolveProvider: () => ({
        provider: whitespaceProvider,
        runtime: testProviderRuntime,
      }),
    });

    const error = await captureCompressError(ctx);
    expect(error).toBeInstanceOf(EmptySummaryError);
    expect(isTransientCompressionError(error)).toBe(false);
  });
});
