/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-005
 *
 * Behavioral tests for ChatSession compression failure tracking and cooldown
 * logic. Extracted from the original monolithic compression-retry.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { makeHttpError, makeChatSession } from './compression-retry-helpers.js';

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
// Phase 4: Failure tracking and cooldown
// ---------------------------------------------------------------------------

describe('ChatSession compression cooldown @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    runtimeSetup = createChatSessionRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-005
   * After 3 failures within 60 seconds, compression is skipped
   */
  it('skips compression after 3 consecutive failures within cooldown period', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Force 3 compressions to trigger cooldown
    await chat.performCompression('test-prompt'); // attempt 1 (fails)
    await chat.performCompression('test-prompt'); // attempt 2 (fails)
    await chat.performCompression('test-prompt'); // attempt 3 (fails)

    const attemptsAfter3 = compressionAttempts;

    // 4th call should be skipped due to cooldown
    await chat.performCompression('test-prompt');
    // Should not have increased the counter (skipped)
    expect(compressionAttempts).toBe(attemptsAfter3);
  });

  /**
   * @requirement REQ-CR-005
   * Cooldown expires after 60 seconds
   */
  it('cooldown expires after 60 seconds allowing compression to resume', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Trigger 3 failures to enter cooldown
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    const countAfterCooldown = compressionAttempts;

    // Advance time past cooldown period (60 seconds)
    vi.advanceTimersByTime(61000);

    // Should attempt compression again after cooldown expires
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBeGreaterThan(countAfterCooldown);
  });

  /**
   * @requirement REQ-CR-005
   * Cooldown resets on successful compression
   */
  it('resets failure count after successful compression', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let shouldFail = true;
    let compressionAttempts = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          if (shouldFail) {
            throw makeHttpError(500);
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

    // Cause 2 failures (not yet at cooldown threshold)
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    // Succeed once — should reset counter
    shouldFail = false;
    await chat.performCompression('test-prompt');

    // Now fail again — need 3 more failures to reach cooldown
    shouldFail = true;
    const countBeforeNewFailures = compressionAttempts;

    await chat.performCompression('test-prompt'); // failure 1
    await chat.performCompression('test-prompt'); // failure 2
    await chat.performCompression('test-prompt'); // failure 3 → cooldown

    const countAtCooldown = compressionAttempts;

    // 4th failure after reset should be skipped (cooldown active)
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBe(countAtCooldown);
    expect(compressionAttempts).toBeGreaterThan(countBeforeNewFailures);
  });
});
