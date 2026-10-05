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

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  installSummaryTransport,
  failDiskFallbackEstimation,
  observeDiskFallback,
  regressionHistory,
  useCompressionClock,
  advanceCompressionClock,
} from './compression-regression-fixtures.js';

import { ChatSession } from '../../core/chatSession.js';
import { PerformCompressionResult } from '../../core/turn.js';
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

void vi.mock('@vybestack/llxprt-code-core/utils/delay.js', () => ({
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

function makeChatSession(
  runtimeSetup: ReturnType<typeof createChatSessionRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
): ChatSession {
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
    userMessages: 5,
    aiMessages: 5,
    toolCalls: 0,
    toolResponses: 0,
  });
  historyService.addAll(regressionHistory());
  vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionStrategy: 'one-shot',
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
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 100 }),
    embedContent: vi.fn(),
  };

  return new ChatSession(view, mockContentGenerator, {}, []);
}

let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
let providerRuntimeSnapshot: ProviderRuntimeContext;

const observeReturnsTrueWhenFallbackSucceedsAfterPrimaryTransientFailure =
  async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    const primaryCompress = installSummaryTransport(
      runtimeSetup.provider,
      async () => {
        throw makeHttpError(500);
      },
    );
    const fallbackCompress = observeDiskFallback();

    const result = await chat.performCompression('test-prompt');

    return { result, primaryCompress, fallbackCompress, chat };
  };

const observeReturnsCOMPRESSEDWhenFallbackSucceedsAfterPrimaryFailure =
  async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    installSummaryTransport(runtimeSetup.provider, async () => {
      throw makeHttpError(500);
    });

    const result = await chat.performCompression('test-prompt');

    return { result };
  };

function registerCompressionCase0(): void {
  describe('returns false before any compression has run', () => {
    it('returns false before any compression has run', () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);
      expect(chat.wasRecentlyCompressed()).toBe(false);
    });
  });
}

function registerCompressionCase1(): void {
  describe('returns true after a successful compression', () => {
    it('returns true after a successful compression', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider);

      await chat.performCompression('test-prompt');
      expect(chat.wasRecentlyCompressed()).toBe(true);
    });
  });
}

function registerCompressionCase2(): void {
  describe('returns false after the recency window expires', () => {
    it('returns false after the recency window expires', async () => {
      useCompressionClock();
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider);

      await chat.performCompression('test-prompt');
      expect(chat.wasRecentlyCompressed()).toBe(true);

      advanceCompressionClock(61_000);
      expect(chat.wasRecentlyCompressed()).toBe(false);

      vi.useRealTimers();
    });
  });
}

function registerCompressionCase3(): void {
  describe('returns false when both primary and fallback compression fail', () => {
    it('returns false when both primary and fallback compression fail', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider, async () => {
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        makeHttpError(500),
      );

      // Trigger 3+ failures so fallback also fails, entering cooldown
      await chat.performCompression('test-prompt');
      await chat.performCompression('test-prompt');
      await chat.performCompression('test-prompt');

      // All strategies failed for all 3 calls
      expect(chat.wasRecentlyCompressed()).toBe(false);
    });
  });
}

function registerCompressionCase4(): void {
  describe('returns true when fallback succeeds after primary transient failure', () => {
    it('returns true when fallback succeeds after primary transient failure', async () => {
      const { result, primaryCompress, fallbackCompress, chat } =
        await observeReturnsTrueWhenFallbackSucceedsAfterPrimaryTransientFailure();
      expect(result).toBe(PerformCompressionResult.COMPRESSED);
      expect(primaryCompress).toHaveBeenCalled();
      expect(fallbackCompress).toHaveBeenCalled();
      expect(chat.wasRecentlyCompressed()).toBe(true);
    });
  });
}

function registerCompressionCase5(): void {
  describe('clears cached prompt token baseline after successful compression rewrite', () => {
    it('clears cached prompt token baseline after successful compression rewrite', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number | null };
        }
      ).compressionHandler.lastPromptTokenCount = 95_000;

      installSummaryTransport(runtimeSetup.provider);

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
  });
}

function registerCompressionCase6(): void {
  describe('returns COMPRESSED when primary strategy succeeds', () => {
    it('returns COMPRESSED when primary strategy succeeds', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider);

      const result = await chat.performCompression('test-prompt');
      expect(result).toBe(PerformCompressionResult.COMPRESSED);
    });
  });
}

function registerCompressionCase7(): void {
  describe('returns COMPRESSED when fallback succeeds after primary failure', () => {
    it('returns COMPRESSED when fallback succeeds after primary failure', async () => {
      const { result } =
        await observeReturnsCOMPRESSEDWhenFallbackSucceedsAfterPrimaryFailure();
      expect(result).toBe(PerformCompressionResult.COMPRESSED);
    });
  });
}

function registerCompressionCase8(): void {
  describe('returns FAILED when both primary and fallback strategies fail', () => {
    it('returns FAILED when both primary and fallback strategies fail', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider, async () => {
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        makeHttpError(500),
      );

      const result = await chat.performCompression('test-prompt');
      expect(result).toBe(PerformCompressionResult.FAILED);
    });
  });
}

function registerCompressionCase9(): void {
  describe('returns SKIPPED_COOLDOWN when compression is in cooldown', () => {
    it('returns SKIPPED_COOLDOWN when compression is in cooldown', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider, async () => {
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        makeHttpError(500),
      );

      // Trigger 3 failures to enter cooldown
      await chat.performCompression('test-prompt');
      await chat.performCompression('test-prompt');
      await chat.performCompression('test-prompt');

      // Now the next call should return SKIPPED_COOLDOWN
      const result = await chat.performCompression('test-prompt');
      expect(result).toBe(PerformCompressionResult.SKIPPED_COOLDOWN);
    });
  });
}

function registerCompressionCase10(): void {
  describe('returns SKIPPED_EMPTY when history is empty', () => {
    it('returns SKIPPED_EMPTY when history is empty', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      await chat['historyService'].replaceAll([]);

      const result = await chat.performCompression('test-prompt');
      expect(result).toBe(PerformCompressionResult.SKIPPED_EMPTY);
    });
  });
}

function registerCompressionCase11(): void {
  describe('updates wasRecentlyCompressed only on COMPRESSED result', () => {
    it('updates wasRecentlyCompressed only on COMPRESSED result', async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      installSummaryTransport(runtimeSetup.provider, async () => {
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        makeHttpError(500),
      );

      // Failing compression should NOT set wasRecentlyCompressed
      const result = await chat.performCompression('test-prompt');
      expect(result).toBe(PerformCompressionResult.FAILED);
      expect(chat.wasRecentlyCompressed()).toBe(false);

      // Now make it succeed
      installSummaryTransport(runtimeSetup.provider);
      failDiskFallbackEstimation(chat.getHistoryService(), () => undefined);

      const result2 = await chat.performCompression('test-prompt');
      expect(result2).toBe(PerformCompressionResult.COMPRESSED);
      expect(chat.wasRecentlyCompressed()).toBe(true);
    });
  });
}

describe('CompressionHandler wasRecentlyCompressed (issue #1792)', () => {
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
  registerCompressionCase0();
  registerCompressionCase1();
  registerCompressionCase2();
  registerCompressionCase3();
  registerCompressionCase4();
});

describe('CompressionHandler performCompression result (issue #1792)', () => {
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
  registerCompressionCase5();
  registerCompressionCase6();
  registerCompressionCase7();
  registerCompressionCase8();
  registerCompressionCase9();
  registerCompressionCase10();
  registerCompressionCase11();
});
