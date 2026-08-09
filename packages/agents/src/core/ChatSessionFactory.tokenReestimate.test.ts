/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for token re-estimation on HistoryService reuse.
 * Verifies that when createChatSession reuses a stored HistoryService
 * across a provider switch, it resets stale token accounting and
 * re-estimates all history tokens with the new provider's tokenizer.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));

void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a', 'tool_b']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  getEnvironmentContext: vi.fn().mockResolvedValue([]),
}));

void vi.mock('./chatSession.js', () => ({
  ChatSession: vi.fn().mockImplementation(() => ({
    setActiveTodosProvider: vi.fn(),
    getHistoryService: vi.fn().mockReturnValue(null),
  })),
}));

void vi.mock(
  '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js',
  () => ({
    loadAgentRuntime: vi.fn().mockResolvedValue({
      runtimeContext: {},
      contentGenerator: {},
      toolsView: { listToolNames: () => [] },
      history: {},
      providerAdapter: {},
      telemetryAdapter: {},
    }),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js',
  () => ({
    setProviderRuntimeStateFactory: vi.fn(),
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/ContentConverters.js',
  () => ({
    ContentConverters: {
      toIContent: vi.fn().mockReturnValue({ speaker: 'human', blocks: [] }),
    },
  }),
);

void vi.mock('@vybestack/llxprt-code-core/utils/toolOutputLimiter.js', () => ({
  estimateTokens: vi.fn().mockReturnValue(50),
}));

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js',
  () => ({
    HistoryService: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      setTokenizerFactory: vi.fn(),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      getTotalTokens: vi.fn().mockReturnValue(0),
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(false),
      getAll: vi.fn().mockReturnValue([]),
    })),
  }),
);

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { createChatSession } from './ChatSessionFactory.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(undefined),
    getUserMemory: vi.fn().mockReturnValue('user memory text'),
    getCoreMemory: vi.fn().mockReturnValue('core memory text'),
    getJitMemoryForPath: vi.fn().mockResolvedValue(null),
    getMcpInstructions: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getWorkingDir: vi.fn().mockReturnValue('/workspace'),
    getSettingsService: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    getToolRegistry: vi.fn().mockReturnValue(undefined),
    getProviderManager: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as Config;
}

function makeRuntimeState(
  overrides: Partial<AgentRuntimeState> = {},
): AgentRuntimeState {
  return {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    runtimeId: 'test-runtime-id',
    sessionId: 'test-session-id',
    proxyUrl: undefined,
    ...overrides,
  } as unknown as AgentRuntimeState;
}

function makeTodoContinuationService(): TodoContinuationService {
  return {
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    readTodoSnapshot: vi.fn().mockResolvedValue([]),
    getActiveTodos: vi.fn().mockReturnValue([]),
  } as unknown as TodoContinuationService;
}

function makeContentGenerator(): ContentGenerator {
  return {} as unknown as ContentGenerator;
}

function makeReusedHistoryService(): HistoryService & {
  resetTokenAccounting: ReturnType<typeof vi.fn>;
  recalculateTotalTokens: ReturnType<typeof vi.fn>;
  setTokenizerFactory: ReturnType<typeof vi.fn>;
  setActiveTokenizationTarget: ReturnType<typeof vi.fn>;
} {
  return {
    add: vi.fn(),
    generateTurnKey: vi.fn().mockReturnValue('turn-1'),
    setBaseTokenOffset: vi.fn(),
    estimateTokensForText: vi.fn().mockResolvedValue(100),
    setTokenizerFactory: vi.fn(),
    setActiveTokenizationTarget: vi.fn(),
    resetTokenAccounting: vi.fn(),
    recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
    getTotalTokens: vi.fn().mockReturnValue(0),
    waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    isEmpty: vi.fn().mockReturnValue(false),
    getAll: vi.fn().mockReturnValue([]),
  } as unknown as HistoryService & {
    resetTokenAccounting: ReturnType<typeof vi.fn>;
    recalculateTotalTokens: ReturnType<typeof vi.fn>;
    setTokenizerFactory: ReturnType<typeof vi.fn>;
    setActiveTokenizationTarget: ReturnType<typeof vi.fn>;
  };
}

describe('createChatSession - token re-estimation on HistoryService reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets token accounting and re-estimates tokens when reusing HistoryService', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('claude-3-5-sonnet-20241022'),
    });
    const runtimeState = makeRuntimeState({
      model: 'stale-model-snapshot',
      provider: 'anthropic',
    });
    const todoContinuationService = makeTodoContinuationService();
    const reusedHistory = makeReusedHistoryService();

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: reusedHistory,
      clearStoredHistoryService: vi.fn(),
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(reusedHistory.resetTokenAccounting).toHaveBeenCalledTimes(1);
    expect(reusedHistory.recalculateTotalTokens).toHaveBeenCalledTimes(1);
    expect(reusedHistory.setActiveTokenizationTarget).toHaveBeenCalledWith(
      'claude-3-5-sonnet-20241022',
      'anthropic',
    );
    expect(reusedHistory.recalculateTotalTokens).toHaveBeenCalledWith();
  });

  it('does NOT reset token accounting when creating a new HistoryService', async () => {
    const { HistoryService } = await import(
      '@vybestack/llxprt-code-core/services/history/HistoryService.js'
    );
    const newHistoryInstance = {
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      setActiveTokenizationTarget: vi.fn(),
      setTokenizerFactory: vi.fn(),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      getTotalTokens: vi.fn().mockReturnValue(0),
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    };
    (
      HistoryService as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(
      () => newHistoryInstance as unknown as HistoryService,
    );

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(newHistoryInstance.resetTokenAccounting).not.toHaveBeenCalled();
    expect(newHistoryInstance.recalculateTotalTokens).not.toHaveBeenCalled();
  });
});
