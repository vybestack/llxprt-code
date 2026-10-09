/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002, REQ-CR-003, REQ-CR-004, REQ-CR-005
 *
 * Shared helpers for compression retry test files. Extracted from the
 * original monolithic compression-retry.test.ts so no file-level max-lines
 * disable is needed.
 */

import { vi } from 'bun:test';
import {
  regressionHistory,
  installSummaryTransport,
  observeDiskFallback,
} from './compression-regression-fixtures.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { EmptySummaryError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { ChatSession } from '../../core/chatSession.js';
import type { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

// ---------------------------------------------------------------------------
// Helper error factories
// ---------------------------------------------------------------------------

export function makeHttpError(status: number): Error {
  const err = new Error(`HTTP error ${status}`);
  (err as { status?: number }).status = status;
  return err;
}

export function makeNetworkError(code: string): Error {
  const err = new Error(`Network error: ${code}`);
  (err as { code?: string }).code = code;
  return err;
}

/**
 * Creates an Anthropic-style overload/rate-limit error. The real provider
 * attaches a structured `error` object to the thrown Error, e.g.
 * `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`.
 * These errors carry no HTTP status code, so they must be classified via
 * {@link isOverloadError} rather than via status.
 *
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002
 */
export function makeAnthropicOverloadError(
  type: 'overloaded_error' | 'rate_limit_error' | 'api_error',
  message = 'Overloaded',
): Error {
  const err = new Error(message) as Error & {
    error?: { type?: string; message?: string };
  };
  err.error = { type, message };
  return err;
}

/**
 * Creates an Anthropic SDK-wrapped error. The Anthropic SDK throws stream error
 * events as an APIError whose `error` property holds the entire response body,
 * so the meaningful type is nested at `error.error.error.type` while the
 * intermediate `error.error.type` is the generic envelope value "error". This
 * is the shape that actually reaches retry classification in production
 * (issue #2053).
 */
export function makeAnthropicSdkWrappedError(
  type: 'overloaded_error' | 'rate_limit_error' | 'api_error',
  message = 'Internal server error',
): Error {
  const err = new Error(message) as Error & {
    status?: number;
    error?: { type?: string; error?: { type?: string; message?: string } };
  };
  err.status = undefined;
  err.error = { type: 'error', error: { type, message } };
  return err;
}

// ---------------------------------------------------------------------------
// ChatSession factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal ChatSession instance for compression behavior testing.
 * Provider transport and fallback estimation control compression outcomes.
 */
export function makeChatSession(
  runtimeSetup: ReturnType<typeof createChatSessionRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
  rows: IContent[] = regressionHistory(),
): ChatSession {
  const runtimeState = createAgentRuntimeState({
    runtimeId: runtimeSetup.runtime.runtimeId ?? 'test-chatSession-runtime',
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
  historyService.addAll(rows);
  vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionStrategy: 'one-shot',
      compressionThreshold: 0.5, // Low threshold so shouldCompress() returns true
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

// ---------------------------------------------------------------------------
// Strategy factory mocks
// ---------------------------------------------------------------------------

/**
 * Injects an EmptySummaryError at the provider boundary against a one-row disk
 * source. The disk strategy seam keeps that source eligible for the fault:
 * real top-down truncation must publish the single retained row unchanged.
 * This preserves the original Issue #2333 fallback consequence without a
 * fabricated fallback candidate or eager primary dispatch.
 *
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-004
 */
export function installEmptySummaryDiskFailure(provider: RuntimeProvider): {
  getFallbackCalled: () => boolean;
  getPrimaryCallCount: () => number;
  restore: () => void;
} {
  let primaryCallCount = 0;
  const transport = installSummaryTransport(provider, async () => {
    primaryCallCount++;
    throw new EmptySummaryError('middle-out');
  });
  const fallback = observeDiskFallback();
  const primary = vi
    .spyOn(OneShotStrategy.prototype, 'compressDisk')
    .mockImplementation(async (context) => {
      const { provider } = await context.resolveProvider(undefined);
      for await (const _row of provider.generateChatCompletion({
        contents: (async function* () {
          yield context.history.readRow(0);
        })(),
        runtime: context.runtimeContext.providerRuntime,
      })) {
        throw new Error(
          'Empty-summary failure transport unexpectedly returned a row',
        );
      }
      throw new Error('Empty-summary failure transport unexpectedly completed');
    });
  return {
    getFallbackCalled: () => fallback.mock.calls.length > 0,
    getPrimaryCallCount: () => primaryCallCount,
    restore: () => {
      primary.mockRestore();
      fallback.mockRestore();
      transport.mockRestore();
    },
  };
}

/**
 * Helper: build a ChatSession with mocked history for enforceContextWindow tests.
 * The token counts are controlled so projected > marginAdjustedLimit.
 */
export function makeChatForEnforceContextWindow(
  runtimeSetup: ReturnType<typeof createChatSessionRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
  overrides?: {
    totalTokens?: number;
    contextLimit?: number;
    maxOutputTokens?: number;
  },
): ChatSession {
  const totalTokens = overrides?.totalTokens ?? 100000;
  const contextLimit = overrides?.contextLimit ?? 200000;
  const maxOutputTokens = overrides?.maxOutputTokens ?? 65_536;

  const runtimeState = createAgentRuntimeState({
    runtimeId: runtimeSetup.runtime.runtimeId ?? 'test-chatSession-runtime',
    provider: runtimeSetup.provider.name,
    model: 'test-model',
    sessionId: 'test-session-id',
  });

  const historyService = new HistoryService();
  vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(totalTokens);
  vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(undefined);
  vi.spyOn(historyService, 'getStatistics').mockReturnValue({
    totalMessages: 10,
    userMessages: 5,
    aiMessages: 5,
    toolCalls: 0,
    toolResponses: 0,
  });
  historyService.addAll(regressionHistory());

  vi.spyOn(historyService, 'applyDensityResult').mockResolvedValue(undefined);
  vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionStrategy: 'one-shot',
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

export function hardLimitReplacement(): IContent[] {
  return [{ speaker: 'human', blocks: [{ type: 'text', text: 'truncated' }] }];
}

export function mockHardLimitRewriteStrategy(): () => boolean {
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
              newHistory: [
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'truncated' }],
                },
              ],
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
          // Insufficient compression triggers hard-limit truncation.
          newHistory: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
            { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
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
  return () => fallbackApplied;
}
