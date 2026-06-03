/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the wasRecentlyCompressed recency tracking.
 * Verifies that CompressionHandler correctly records successful compression
 * and exposes recency state, which the /compress command uses to distinguish
 * ALREADY_COMPRESSED from NOOP (issue #1792).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { GeminiChat } from '../../geminiChat.js';
import { PerformCompressionResult } from '../../turn.js';
import { createGeminiChatRuntime } from '../../../test-utils/runtime.js';
import { createAgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../../../runtime/runtimeAdapters.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import * as providerRuntime from '../../../runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';

vi.mock('../../../utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  createAbortError: () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  },
}));

function makeHttpError(status: number): Error {
  const err = new Error(`HTTP error ${status}`);
  (err as { status?: number }).status = status;
  return err;
}

function makeGeminiChat(
  runtimeSetup: ReturnType<typeof createGeminiChatRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
): GeminiChat {
  const runtimeState = createAgentRuntimeState({
    runtimeId: runtimeSetup.runtime.runtimeId,
    provider: runtimeSetup.provider.name,
    model: 'test-model',
    sessionId: 'test-session-id',
  });

  const historyService = new HistoryService();
  vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(100000);
  vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(undefined);
  vi.spyOn(historyService, 'getStatistics').mockReturnValue({
    totalMessages: 10,
    humanMessages: 5,
    aiMessages: 5,
  });
  vi.spyOn(historyService, 'startCompression').mockImplementation(() => {});
  vi.spyOn(historyService, 'endCompression').mockImplementation(() => {});
  vi.spyOn(historyService, 'getCurated').mockReturnValue([
    { role: 'user', parts: [{ text: 'hello' }] },
    { role: 'model', parts: [{ text: 'hi' }] },
  ]);
  vi.spyOn(historyService, 'clear').mockImplementation(() => {});
  vi.spyOn(historyService, 'add').mockImplementation(() => {});
  vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.5,
      contextLimit: 200000,
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
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  };

  return new GeminiChat(view, mockContentGenerator, {}, []);
}

describe('CompressionHandler wasRecentlyCompressed (issue #1792)', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false before any compression has run', () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);
    expect(chat.wasRecentlyCompressed()).toBe(false);
  });

  it('returns true after a successful compression', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockResolvedValue({
          newHistory: [],
          metadata: {
            originalMessageCount: 10,
            compressedMessageCount: 5,
            strategyUsed: 'middle-out' as const,
            llmCallMade: true,
          },
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(chat.wasRecentlyCompressed()).toBe(true);
  });

  it('returns false after the recency window expires', async () => {
    vi.useFakeTimers();
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockResolvedValue({
          newHistory: [],
          metadata: {
            originalMessageCount: 10,
            compressedMessageCount: 5,
            strategyUsed: 'middle-out' as const,
            llmCallMade: true,
          },
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(chat.wasRecentlyCompressed()).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(chat.wasRecentlyCompressed()).toBe(false);

    vi.useRealTimers();
  });

  it('returns false when both primary and fallback compression fail', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    // Trigger 3+ failures so fallback also fails, entering cooldown
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    // All strategies failed for all 3 calls
    expect(chat.wasRecentlyCompressed()).toBe(false);
  });

  it('returns true when fallback succeeds after primary transient failure', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    const primaryCompress = vi.fn().mockRejectedValue(makeHttpError(500));
    const fallbackCompress = vi.fn().mockResolvedValue({
      newHistory: [{ role: 'user', parts: [{ text: 'truncated' }] }],
      metadata: {
        originalMessageCount: 10,
        compressedMessageCount: 2,
        strategyUsed: 'top-down-truncation' as const,
        llmCallMade: false,
      },
    });

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: fallbackCompress,
          };
        }

        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: primaryCompress,
        };
      },
    );

    const result = await chat.performCompression('test-prompt');

    expect(result).toBe(PerformCompressionResult.COMPRESSED);
    expect(primaryCompress).toHaveBeenCalled();
    expect(fallbackCompress).toHaveBeenCalled();
    expect(chat.wasRecentlyCompressed()).toBe(true);
  });
});

describe('CompressionHandler performCompression result (issue #1792)', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  it('clears cached prompt token baseline after successful compression rewrite', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    (
      chat as unknown as {
        compressionHandler: { lastPromptTokenCount: number | null };
      }
    ).compressionHandler.lastPromptTokenCount = 95_000;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockResolvedValue({
          newHistory: [{ role: 'user', parts: [{ text: 'summary' }] }],
          metadata: {
            originalMessageCount: 10,
            compressedMessageCount: 1,
            strategyUsed: 'middle-out' as const,
            llmCallMade: true,
          },
        }),
      }),
    );

    const result = await chat.performCompression('test-prompt');

    expect(result).toBe(PerformCompressionResult.COMPRESSED);
    expect(
      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number | null };
        }
      ).compressionHandler.lastPromptTokenCount,
    ).toBeNull();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns COMPRESSED when primary strategy succeeds', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockResolvedValue({
          newHistory: [{ role: 'user', parts: [{ text: 'summary' }] }],
          metadata: {
            originalMessageCount: 10,
            compressedMessageCount: 1,
            strategyUsed: 'middle-out' as const,
            llmCallMade: true,
          },
        }),
      }),
    );

    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.COMPRESSED);
  });

  it('returns COMPRESSED when fallback succeeds after primary failure', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [{ role: 'user', parts: [{ text: 'truncated' }] }],
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
          compress: vi.fn().mockRejectedValue(makeHttpError(500)),
        };
      },
    );

    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.COMPRESSED);
  });

  it('returns FAILED when both primary and fallback strategies fail', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.FAILED);
  });

  it('returns SKIPPED_COOLDOWN when compression is in cooldown', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    // Trigger 3 failures to enter cooldown
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    // Now the next call should return SKIPPED_COOLDOWN
    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.SKIPPED_COOLDOWN);
  });

  it('returns SKIPPED_EMPTY when history is empty', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    // Override getCurated to return empty history
    vi.spyOn(chat['historyService'], 'getCurated').mockReturnValue([]);

    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.SKIPPED_EMPTY);
  });

  it('updates wasRecentlyCompressed only on COMPRESSED result', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    // Failing compression should NOT set wasRecentlyCompressed
    const result = await chat.performCompression('test-prompt');
    expect(result).toBe(PerformCompressionResult.FAILED);
    expect(chat.wasRecentlyCompressed()).toBe(false);

    // Now make it succeed
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockResolvedValue({
          newHistory: [],
          metadata: {
            originalMessageCount: 10,
            compressedMessageCount: 5,
            strategyUsed: 'middle-out' as const,
            llmCallMade: true,
          },
        }),
      }),
    );

    const result2 = await chat.performCompression('test-prompt');
    expect(result2).toBe(PerformCompressionResult.COMPRESSED);
    expect(chat.wasRecentlyCompressed()).toBe(true);
  });
});
