/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-1791.1, REQ-1791.2, REQ-1791.3, REQ-1791.4, REQ-1791.5, REQ-1791.6, REQ-2067.1, REQ-2067.2
 *
 * Behavioral tests for hard-limit compression bypass behavior (Issue #1791).
 * Extracted from the original monolithic compression-retry.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatSession } from '../../core/chatSession.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { makeHttpError } from './compression-retry-helpers.js';

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
// Phase 5: Hard-limit compression bypass (Issue #1791)
// ---------------------------------------------------------------------------

describe('Hard-limit compression behavior (Issue #1791)', () => {
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
   * Helper: build a ChatSession with mocked history for enforceContextWindow tests.
   * The token counts are controlled so projected > marginAdjustedLimit.
   */
  function makeChatForEnforceContextWindow(overrides?: {
    totalTokens?: number;
    contextLimit?: number;
    maxOutputTokens?: number;
  }): ChatSession {
    const totalTokens = overrides?.totalTokens ?? 100000;
    const contextLimit = overrides?.contextLimit ?? 200000;
    const maxOutputTokens = overrides?.maxOutputTokens ?? 65_536;

    const runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'test-model',
      sessionId: 'test-session-id',
    });

    const historyService = new HistoryService();
    vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(totalTokens);
    vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );
    vi.spyOn(historyService, 'getStatistics').mockReturnValue({
      totalMessages: 10,
      userMessages: 5,
      aiMessages: 5,
      toolCalls: 0,
      toolResponses: 0,
    });
    vi.spyOn(historyService, 'startCompression').mockImplementation(() => {});
    vi.spyOn(historyService, 'endCompression').mockImplementation(() => {});
    vi.spyOn(historyService, 'getCurated').mockReturnValue([
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi' }] },
    ]);
    vi.spyOn(historyService, 'getRawHistory').mockReturnValue([]);
    vi.spyOn(historyService, 'applyDensityResult').mockResolvedValue(undefined);
    vi.spyOn(historyService, 'clear').mockImplementation(() => {});
    vi.spyOn(historyService, 'add').mockImplementation(() => {});
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.5,
        contextLimit,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: false,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        runtimeSetup.config.getProviderManager(),
      ),
      telemetry: createTelemetryAdapterFromConfig(runtimeSetup.config),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: providerRuntimeSnapshot,
    });

    const mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 100 }),
      embedContent: vi.fn(),
    };

    return new ChatSession(view, mockContentGenerator, { maxOutputTokens }, []);
  }

  /**
   * @requirement REQ-2067.1
   * Hard-limit gate allows a small estimation cushion before mutating history.
   */
  it('allows projected tokens within the 0.5% context-limit fudge factor', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 149_002,
      contextLimit: 200_000,
      maxOutputTokens: 40_000,
    });

    const getStrategy = vi.spyOn(compressionFactory, 'getCompressionStrategy');

    await expect(
      chat['enforceContextWindow'](10_000, 'test-prompt'),
    ).resolves.toBeUndefined();

    expect(getStrategy).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-2067.2
   * Hard-limit gate still enforces requests beyond the estimation cushion.
   */
  it('still enforces projected tokens beyond the 0.5% context-limit fudge factor', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 150_000,
      contextLimit: 200_000,
      maxOutputTokens: 40_000,
    });

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          return {
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(150_000);

    await expect(
      chat['enforceContextWindow'](10_000, 'test-prompt'),
    ).rejects.toThrow('tokensStillNeeded=5');

    expect(compressionAttempts).toBeGreaterThan(0);
  });
  /**
   * @requirement REQ-1791.1
   * enforceContextWindow bypasses cooldown and still attempts compression.
   */
  it('bypasses cooldown when enforcing hard context window limit', async () => {
    vi.useFakeTimers();
    try {
      // Set totalTokens high enough that projected > marginAdjustedLimit
      // marginAdjustedLimit = 200000 - 1000 = 199000
      // projected = totalTokens + pendingTokens + completionBudget
      // With totalTokens=100000, pendingTokens=50000, completionBudget=65536 => 215536 > 199000
      const chat = makeChatForEnforceContextWindow({ totalTokens: 100_000 });

      // Put the chat into cooldown by forcing 3 compression failures
      let primaryAttempts = 0;
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        () => ({
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockImplementation(async () => {
            primaryAttempts++;
            throw makeHttpError(500);
          }),
        }),
      );

      // Trigger cooldown: 3 failures via performCompression
      await chat.performCompression('test-prompt'); // failure 1
      await chat.performCompression('test-prompt'); // failure 2
      await chat.performCompression('test-prompt'); // failure 3 → cooldown

      const attemptsBeforeCooldown = primaryAttempts;

      // 4th performCompression should be skipped (cooldown active)
      await chat.performCompression('test-prompt');
      expect(primaryAttempts).toBe(attemptsBeforeCooldown);

      // Now make compression succeed so enforceContextWindow can get past it
      const succeedAfter = primaryAttempts;
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        () => ({
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockImplementation(async () => {
            primaryAttempts++;
            if (primaryAttempts <= succeedAfter) {
              throw makeHttpError(500);
            }
            return {
              newHistory: [],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 0,
                strategyUsed: 'middle-out' as const,
                llmCallMade: true,
              },
            };
          }),
        }),
      );

      // Mock getTotalTokens to return a low value after a few calls
      // (simulating compression having succeeded)
      let tokenCallCount = 0;
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockImplementation(
        () => {
          tokenCallCount++;
          // After the initial checks, return low tokens
          if (tokenCallCount > 3) {
            return 10_000; // Well under limit
          }
          return 100_000;
        },
      );

      // enforceContextWindow should bypass cooldown and attempt compression
      await chat['enforceContextWindow'](50_000, 'test-prompt');

      // Compression should have been attempted despite cooldown
      expect(primaryAttempts).toBeGreaterThan(attemptsBeforeCooldown);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * @requirement REQ-1791.2
   * When primary compression barely reduces tokens, fallback truncation is triggered.
   */
  it('forces fallback truncation when compression barely reduces tokens', async () => {
    // totalTokens=150000, pendingTokens=50000, completionBudget=65536
    // projected = 150000 + 50000 + 65536 = 265536 > 199000
    const chat = makeChatForEnforceContextWindow({ totalTokens: 150_000 });

    let truncationCalled = false;
    let primaryCallCount = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          truncationCalled = true;
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 2,
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
            // Primary succeeds but barely reduces tokens (returns same history)
            return {
              newHistory: [
                { role: 'user', parts: [{ text: 'hello' }] },
                { role: 'model', parts: [{ text: 'hi' }] },
              ],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 9, // Barely reduced
                strategyUsed: 'middle-out' as const,
                llmCallMade: true,
              },
            };
          }),
        };
      },
    );

    // Mock getTotalTokens to stay high even after "compression"
    // so the fallback is triggered
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(150_000);

    // enforceContextWindow should detect ineffective compression and force fallback
    try {
      await chat['enforceContextWindow'](50_000, 'test-prompt');
    } catch {
      // May still throw if tokens remain over limit, but truncation should have been called
    }

    expect(truncationCalled).toBe(true);
    expect(primaryCallCount).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-1791.6
   * Hard-limit fallback rewrite clears stale API prompt baseline.
   */
  it('clears lastPromptTokenCount when forceTruncationIfIneffective rewrites history', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 150_000,
      contextLimit: 200_000,
      maxOutputTokens: 65_536,
    });

    (
      chat as unknown as {
        compressionHandler: { lastPromptTokenCount: number | null };
      }
    ).compressionHandler.lastPromptTokenCount = 95_000;

    let fallbackApplied = false;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockImplementation(async () => {
              fallbackApplied = true;
              return {
                newHistory: [{ role: 'user', parts: [{ text: 'truncated' }] }],
                metadata: {
                  originalMessageCount: 10,
                  compressedMessageCount: 2,
                  strategyUsed: 'top-down-truncation' as const,
                  llmCallMade: false,
                },
              };
            }),
          };
        }

        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockResolvedValue({
            // Ineffective primary compression triggers forceTruncationIfIneffective.
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          }),
        };
      },
    );

    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(150_000);

    await expect(
      chat['enforceContextWindow'](50_000, 'test-prompt'),
    ).rejects.toThrow(Error);

    expect(fallbackApplied).toBe(true);
    expect(
      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number | null };
        }
      ).compressionHandler.lastPromptTokenCount,
    ).toBeNull();
  });

  /**
   * @requirement REQ-1791.5
   * Hard-limit gate uses API-observed prompt baseline when available.
   */
  it('uses lastPromptTokenCount in hard-limit gate projection when available', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 1_000,
      contextLimit: 100_000,
      maxOutputTokens: 10_000,
    });

    // If hard-limit gate used raw history (1,000), projection would be:
    // 1,000 + 10,000 + 10,000 = 21,000 <= 99,000 and compression would not run.
    // With API-observed baseline (95,000), projection is:
    // 95,000 + 10,000 + 10,000 = 115,000 > 99,000 and compression should run.
    // Set API-observed prompt baseline directly on compression handler via private field.
    (
      chat as unknown as {
        compressionHandler: { lastPromptTokenCount: number };
      }
    ).compressionHandler.lastPromptTokenCount = 95_000;

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          return {
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(1_000);

    try {
      await chat['enforceContextWindow'](10_000, 'test-prompt');
    } catch {
      // We only care that hard-limit path did not early-return and attempted compression.
    }

    expect(compressionAttempts).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-1791.3
   * Error message includes reduction amount, completion budget, and budget warning.
   */
  it('includes diagnostic info in error when budget is large relative to context window', async () => {
    // contextLimit=100000, maxOutputTokens=90000 (90% of window)
    // projected = 80000 + 10000 + 90000 = 180000
    // marginAdjustedLimit = 100000 - 1000 = 99000
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 80_000,
      contextLimit: 100_000,
      maxOutputTokens: 90_000,
    });

    // Make compression return the same history (ineffective)
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [
                { role: 'user', parts: [{ text: 'hello' }] },
                { role: 'model', parts: [{ text: 'hi' }] },
              ],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 9,
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
          compress: vi.fn().mockResolvedValue({
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          }),
        };
      },
    );

    // Keep tokens high so nothing reduces enough
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(80_000);

    let errorMessage = '';
    try {
      await chat['enforceContextWindow'](10_000, 'test-prompt');
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    expect(errorMessage).toContain(
      'Request still exceeds the safety-adjusted context limit (99495 tokens).',
    );
    expect(errorMessage).toContain(
      'density optimization and compression reduced 0 tokens',
    );
    expect(errorMessage).toContain('completionBudget=90000');
    expect(errorMessage).toContain('tokensStillNeeded=80505');
    expect(errorMessage).toContain(
      'consumes more than 80% of the context window (100000)',
    );
    expect(errorMessage).toContain('Consider lowering maxOutputTokens.');
  });

  /**
   * @requirement REQ-1791.4
   * Cooldown is still respected when bypassCooldown is not set (default behavior).
   */
  it('preserves cooldown behavior when not called from enforceContextWindow', async () => {
    const chat = makeChatForEnforceContextWindow({ totalTokens: 100_000 });

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

    // Force cooldown
    await chat.performCompression('test-prompt'); // failure 1
    await chat.performCompression('test-prompt'); // failure 2
    await chat.performCompression('test-prompt'); // failure 3 → cooldown

    const countAtCooldown = compressionAttempts;

    // Should still skip due to cooldown (not bypassed)
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBe(countAtCooldown);
  });
});
