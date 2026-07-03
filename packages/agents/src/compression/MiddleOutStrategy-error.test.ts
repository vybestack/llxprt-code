/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 *
 * Error-handling behavioral tests for MiddleOutStrategy: empty summary
 * handling, transient error classification, and enriched diagnostics
 * (issue #2333 — reasoning model burns budget on thinking, returns no text).
 */

import { describe, it, expect } from 'vitest';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
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

describe('MiddleOutStrategy empty summary handling', () => {
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

describe('MiddleOutStrategy enriched EmptySummaryError diagnostics (issue #2333)', () => {
  /**
   * Issue #2333 scenario: a reasoning model (e.g. gpt-5.5) burns its entire
   * output-token budget on thinking blocks and produces zero text. The stream
   * yields only thinking blocks with finishReason=incomplete. The strategy
   * must throw EmptySummaryError carrying diagnostics that reveal the root
   * cause (finishReason: incomplete, thinking block count > 0).
   */
  it('includes finishReason and thinkingBlockCount when provider yields only thinking blocks', async () => {
    const thinkingOnlyProvider: IProvider = {
      name: 'thinking-only-provider',
      getModels: async () => [],
      getDefaultModel: () => 'gpt-5.5',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
      async *generateChatCompletion() {
        yield {
          speaker: 'ai' as const,
          blocks: [
            {
              type: 'thinking' as const,
              thought: 'Let me analyze the conversation history deeply...',
              sourceField: 'reasoning_content',
              isHidden: false,
            },
          ],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [],
          metadata: {
            finishReason: 'incomplete',
            stopReason: 'max_tokens',
          },
        };
      },
    } as unknown as IProvider;

    const history = generateHistory(20);
    const ctx = buildContext({
      history,
      resolveProvider: () => ({
        provider: thinkingOnlyProvider,
        runtime: testProviderRuntime,
      }),
    });

    const thrownError = await captureCompressError(ctx);

    expect(thrownError).toBeInstanceOf(EmptySummaryError);
    const emptyError = thrownError as EmptySummaryError;
    expect(emptyError.finishReason).toBe('incomplete');
    expect(emptyError.stopReason).toBe('max_tokens');
    expect(emptyError.thinkingBlockCount).toBeGreaterThan(0);
    expect(emptyError.blockTypeCounts?.['thinking']).toBeGreaterThan(0);
    expect(isTransientCompressionError(thrownError)).toBe(false);
    expect(emptyError.message).toContain('finishReason: incomplete');
    expect(emptyError.message).toContain('thinking:');
  });

  /**
   * Backward compatibility: EmptySummaryError without diagnostics still works
   * and has the original message format.
   */
  it('EmptySummaryError without diagnostics has backward-compatible message', () => {
    const error = new EmptySummaryError('middle-out');
    expect(error.message).toBe(
      'Compression strategy "middle-out" produced an empty summary',
    );
    expect(error.finishReason).toBeUndefined();
    expect(error.blockTypeCounts).toBeUndefined();
    expect(isTransientCompressionError(error)).toBe(false);
  });
});
