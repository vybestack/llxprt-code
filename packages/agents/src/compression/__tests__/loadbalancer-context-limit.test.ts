/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test for issue #2251 (PR #2262 follow-up):
 * LB profile + backend with a sub-1M window →
 * CompressionHandler.computeContextLimits().limit equals that backend's
 * tokenLimit, not DEFAULT_TOKEN_LIMIT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeContextFactoryOptions,
  AgentRuntimeProviderAdapter,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  DEFAULT_TOKEN_LIMIT,
  tokenLimit,
} from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { buildMockContentGenerator } from '../../core/__tests__/chatSession-density-helpers.js';
import { ChatSession } from '../../core/chatSession.js';

/**
 * Build a real AgentRuntimeContext whose provider adapter's active provider
 * reports the given getContextLimit value. Mirrors the LB provider mock shape
 * used in createAgentRuntimeContext.test.ts.
 */
function buildLbRuntimeContext(
  historyService: HistoryService,
  options: {
    contextLimitSetting?: number;
    providerContextLimit?: number;
    stateModel?: string;
    stateProvider?: string;
  },
): AgentRuntimeContext {
  const stateModel = options.stateModel ?? 'load-balancer';
  const stateProvider = options.stateProvider ?? 'load-balancer';

  const runtimeState: AgentRuntimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: stateProvider,
    model: stateModel,
    sessionId: 'test-session',
  });

  const providerShape: Record<string, unknown> = {
    name: 'load-balancer',
    generateChatCompletion: vi.fn(),
  };
  if (options.providerContextLimit !== undefined) {
    providerShape.getContextLimit = () => options.providerContextLimit;
  }
  const lbProvider = providerShape as unknown as IProvider;

  const lbProviderAdapter: AgentRuntimeProviderAdapter = {
    getActiveProvider: vi.fn().mockReturnValue(lbProvider),
    setActiveProvider: vi.fn(),
  };

  const mockTelemetryAdapter = {
    recordTokenUsage: vi.fn(),
    recordEvent: vi.fn(),
  } as never;

  const mockToolsView = {
    getToolRegistry: vi.fn(() => undefined),
  } as never;

  const providerRuntime = {
    runtimeId: 'test-runtime',
    settingsService: { get: vi.fn(() => undefined) } as never,
    config: {} as never,
  } as ProviderRuntimeContext;

  const factoryOptions: AgentRuntimeContextFactoryOptions = {
    state: runtimeState,
    settings:
      options.contextLimitSetting !== undefined
        ? { contextLimit: options.contextLimitSetting }
        : {},
    provider: lbProviderAdapter,
    telemetry: mockTelemetryAdapter,
    tools: mockToolsView,
    providerRuntime,
  };

  return createAgentRuntimeContext(factoryOptions);
}

describe('CompressionHandler.computeContextLimits() — LB provider-derived context limit (issue #2251)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ReturnType<typeof buildMockContentGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    mockContentGenerator = buildMockContentGenerator();
  });

  it('uses the provider-derived limit (200K), not DEFAULT_TOKEN_LIMIT, under LB with no explicit override', () => {
    const runtimeContext = buildLbRuntimeContext(historyService, {
      providerContextLimit: 200_000,
    });

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
    const lbProvider = runtimeContext.provider.getActiveProvider();

    const limits = chat['compressionHandler'].computeContextLimits(lbProvider);
    expect(limits.limit).toBe(200_000);
    expect(limits.limit).not.toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('honors the min-across-pool value when the provider reports the smaller window', () => {
    const runtimeContext = buildLbRuntimeContext(historyService, {
      providerContextLimit: 200_000,
    });

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
    const lbProvider = runtimeContext.provider.getActiveProvider();

    const limits = chat['compressionHandler'].computeContextLimits(lbProvider);
    expect(limits.limit).toBe(200_000);
  });

  it('respects an explicit user context-limit override over the provider limit', () => {
    const runtimeContext = buildLbRuntimeContext(historyService, {
      contextLimitSetting: 50_000,
      providerContextLimit: 200_000,
    });

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
    const lbProvider = runtimeContext.provider.getActiveProvider();

    const limits = chat['compressionHandler'].computeContextLimits(lbProvider);
    expect(limits.limit).toBe(50_000);
  });

  it('falls back to the model lookup for a non-LB provider lacking getContextLimit', () => {
    const runtimeContext = buildLbRuntimeContext(historyService, {
      stateModel: 'gemini-2.0-flash',
      stateProvider: 'gemini',
    });

    const chat = new ChatSession(runtimeContext, mockContentGenerator, {}, []);
    const provider = runtimeContext.provider.getActiveProvider();

    const limits = chat['compressionHandler'].computeContextLimits(provider);
    expect(limits.limit).toBe(tokenLimit('gemini-2.0-flash'));
    expect(limits.limit).toBe(DEFAULT_TOKEN_LIMIT);
  });
});
