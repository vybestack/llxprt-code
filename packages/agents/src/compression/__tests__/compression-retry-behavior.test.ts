/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-003, REQ-CR-004
 *
 * Behavioral tests for ChatSession compression retry behavior and fallback
 * strategy usage. Extracted from the original monolithic
 * compression-retry.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompressionExecutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { PerformCompressionResult } from '../../core/turn.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { ChatSession } from '../../core/chatSession.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  makeHttpError,
  makeAnthropicOverloadError,
  makeAnthropicSdkWrappedError,
  makeChatSession,
} from './compression-retry-helpers.js';

// Mock the delay utility so retryWithBackoff doesn't actually wait in tests
vi.mock('@vybestack/llxprt-code-core/utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  createAbortError: () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  },
}));

// ---------------------------------------------------------------------------
// Phase 2: Retry behavior in performCompression
// ---------------------------------------------------------------------------

describe('ChatSession compression retry behavior @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createChatSessionRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-003
   * performCompression retries on transient errors
   */
  it('retries a transient error and eventually succeeds', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw makeHttpError(503);
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 5,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(callCount).toBe(3);
  });

  /**
   * @requirement REQ-CR-003
   * Issue #2045: performCompression retries an Anthropic overload error
   * (which carries no HTTP status) and eventually succeeds.
   */
  it('retries an Anthropic overloaded_error and eventually succeeds', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw makeAnthropicOverloadError('overloaded_error');
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 5,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(callCount).toBe(3);
  });

  /**
   * @requirement REQ-CR-001
   * Issue #2053: performCompression retries an Anthropic api_error
   * (Internal server error) delivered in the real SDK-wrapped shape
   * (HTTP status undefined, retryable type nested at error.error.error.type)
   * and eventually succeeds instead of breaking compression.
   */
  it('retries an SDK-wrapped Anthropic api_error and eventually succeeds', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw makeAnthropicSdkWrappedError(
              'api_error',
              'Internal server error',
            );
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 5,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(callCount).toBe(3);
  });

  /**
   * @requirement REQ-CR-003
   * performCompression fails fast on permanent errors (no retry)
   */
  it('does not retry permanent errors', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          throw new CompressionExecutionError(
            'middle-out',
            'permanent failure',
          );
        }),
      }),
    );

    await expect(chat.performCompression('test-prompt')).rejects.toThrow(
      CompressionExecutionError,
    );
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Fallback compression strategy
// ---------------------------------------------------------------------------

describe('ChatSession compression fallback @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createChatSessionRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-004
   * Falls back to TopDownTruncation when primary strategy fails
   */
  it('uses fallback strategy when primary strategy fails after retries', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let fallbackCalled = false;
    let primaryCallCount = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          fallbackCalled = true;
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 5,
                strategyUsed: 'top-down-truncation' as const,
                llmCallMade: false,
              },
            }),
          };
        }
        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockImplementation(async () => {
            primaryCallCount++;
            throw makeHttpError(500);
          }),
        };
      },
    );

    // performCompression internally catches and falls back
    await chat.performCompression('test-prompt');
    expect(fallbackCalled).toBe(true);
    expect(primaryCallCount).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-CR-004
   * When fallback also fails, logs error and continues without throwing
   */
  it('does not throw when fallback also fails', async () => {
    const chat: ChatSession = makeChatSession(
      runtimeSetup,
      providerRuntimeSnapshot,
    );

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    // When both primary and fallback fail, should not throw and should return FAILED
    await expect(chat.performCompression('test-prompt')).resolves.toBe(
      PerformCompressionResult.FAILED,
    );
  });
});
