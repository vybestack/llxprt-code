/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));

vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a', 'tool_b']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

vi.mock('../utils/environmentContext.js', () => ({
  getEnvironmentContext: vi.fn().mockResolvedValue([]),
}));

vi.mock('./geminiChat.js', () => ({
  GeminiChat: vi.fn().mockImplementation(() => ({
    setActiveTodosProvider: vi.fn(),
    getHistoryService: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../runtime/AgentRuntimeLoader.js', () => ({
  loadAgentRuntime: vi.fn().mockResolvedValue({
    runtimeContext: {},
    contentGenerator: {},
    toolsView: { listToolNames: () => [] },
    history: {},
    providerAdapter: {},
    telemetryAdapter: {},
  }),
}));

vi.mock('../runtime/providerRuntimeContext.js', () => ({
  createProviderRuntimeContext: vi.fn().mockReturnValue({}),
}));

vi.mock('../services/history/HistoryService.js', () => ({
  HistoryService: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    generateTurnKey: vi.fn().mockReturnValue('turn-1'),
    setBaseTokenOffset: vi.fn(),
    estimateTokensForText: vi.fn().mockResolvedValue(100),
  })),
}));

vi.mock('../services/history/ContentConverters.js', () => ({
  ContentConverters: {
    toIContent: vi.fn().mockReturnValue({ role: 'user', parts: [] }),
  },
}));

vi.mock('../utils/toolOutputLimiter.js', () => ({
  estimateTokens: vi.fn().mockReturnValue(50),
}));

vi.mock('../utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildSettingsSnapshot,
  buildSystemInstruction,
  createChatSession,
  createChatSessionSafe,
} from './ChatSessionFactory.js';
import { getCoreSystemPromptAsync } from './prompts.js';
import { getEnvironmentContext } from '../utils/environmentContext.js';
import { loadAgentRuntime } from '../runtime/AgentRuntimeLoader.js';
import { GeminiChat } from './geminiChat.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { Config } from '../config/config.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(undefined),
    getUserMemory: vi.fn().mockReturnValue('user memory text'),
    getCoreMemory: vi.fn().mockReturnValue('core memory text'),
    getJitMemoryForPath: vi.fn().mockResolvedValue(null),
    getMcpClientManager: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getWorkingDir: vi.fn().mockReturnValue('/workspace'),
    getSettingsService: vi.fn().mockReturnValue({}),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
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

describe('buildSettingsSnapshot', () => {
  it('assembles compression settings from config ephemerals', () => {
    const config = makeConfig({
      getEphemeralSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'compression-threshold') return 0.9;
        if (key === 'compression-preserve-threshold') return 0.3;
        if (key === 'context-limit') return 50000;
        return undefined;
      }),
    });

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot.compressionThreshold).toBe(0.9);
    expect(snapshot.preserveThreshold).toBe(0.3);
    expect(snapshot.contextLimit).toBe(50000);
  });

  it('uses defaults when ephemerals are not set', () => {
    const config = makeConfig();

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot.compressionThreshold).toBe(0.85);
    expect(snapshot.preserveThreshold).toBe(0.2);
    expect(snapshot.contextLimit).toBeUndefined();
  });

  it('falls back to defaults when thresholds are NaN or Infinity', () => {
    const config = makeConfig({
      getEphemeralSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'compression-threshold') return NaN;
        if (key === 'compression-preserve-threshold') return Infinity;
        if (key === 'context-limit') return -Infinity;
        return undefined;
      }),
    });

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot.compressionThreshold).toBe(0.85);
    expect(snapshot.preserveThreshold).toBe(0.2);
    expect(snapshot.contextLimit).toBeUndefined();
  });

  it('includes reasoning settings from ephemerals', () => {
    const config = makeConfig({
      getEphemeralSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'reasoning.enabled') return true;
        if (key === 'reasoning.effort') return 'high';
        if (key === 'reasoning.maxTokens') return 8192;
        return undefined;
      }),
    });

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot['reasoning.enabled']).toBe(true);
    expect(snapshot['reasoning.effort']).toBe('high');
    expect(snapshot['reasoning.maxTokens']).toBe(8192);
  });

  it('includes tool governance in snapshot', async () => {
    const { getToolGovernanceEphemerals } = await import(
      './clientToolGovernance.js'
    );
    vi.mocked(getToolGovernanceEphemerals).mockReturnValueOnce({
      allowed: ['bash', 'read_file'],
    });

    const config = makeConfig();
    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot.tools).toStrictEqual({ allowed: ['bash', 'read_file'] });
  });

  it('includes telemetry configuration', () => {
    const config = makeConfig();

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot.telemetry).toStrictEqual({ enabled: true, target: null });
  });
});

describe('buildSystemInstruction', () => {
  const MODEL = 'gemini-2.5-flash';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('core system prompt');
  });

  it('includes user memory in the system prompt', async () => {
    const config = makeConfig({
      getUserMemory: vi.fn().mockReturnValue('remember this'),
    });

    await buildSystemInstruction(config, ['tool_a'], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ userMemory: 'remember this' }),
    );
  });

  it('includes core memory in the system prompt', async () => {
    const config = makeConfig({
      getCoreMemory: vi.fn().mockReturnValue('core memory'),
    });

    await buildSystemInstruction(config, ['tool_a'], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ coreMemory: 'core memory' }),
    );
  });

  it('includes MCP instructions when available', async () => {
    const config = makeConfig({
      getMcpClientManager: vi.fn().mockReturnValue({
        getMcpInstructions: vi.fn().mockReturnValue('use the mcp tool'),
      }),
    });

    await buildSystemInstruction(config, [], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mcpInstructions: 'use the mcp tool' }),
    );
  });

  it('prepends environment context to the system instruction', async () => {
    const config = makeConfig();
    const envParts = [{ text: 'CWD: /workspace' }];

    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('base prompt');

    const result = await buildSystemInstruction(config, [], envParts, MODEL);

    expect(result).toBe('CWD: /workspace\n\nbase prompt');
  });

  it('appends JIT memory to user memory when available', async () => {
    const config = makeConfig({
      isJitContextEnabled: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue('base memory'),
      getJitMemoryForPath: vi.fn().mockResolvedValue('jit memory content'),
    });

    await buildSystemInstruction(config, [], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userMemory: 'base memory\n\njit memory content',
      }),
    );
  });

  it('passes subagent delegation flag when appropriate', async () => {
    const { shouldIncludeSubagentDelegationForConfig } = await import(
      './clientToolGovernance.js'
    );
    vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValueOnce(
      true,
    );

    const config = makeConfig();
    await buildSystemInstruction(config, ['task', 'list_subagents'], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ includeSubagentDelegation: true }),
    );
  });

  it('uses non-interactive mode when config reports non-interactive', async () => {
    const config = makeConfig({
      isInteractive: vi.fn().mockReturnValue(false),
    });

    await buildSystemInstruction(config, [], [], MODEL);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ interactionMode: 'non-interactive' }),
    );
  });
});

describe('createChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('system prompt');
    vi.mocked(getEnvironmentContext).mockResolvedValue([]);
    vi.mocked(loadAgentRuntime).mockResolvedValue({
      runtimeContext: {},
      contentGenerator: {},
      toolsView: { listToolNames: () => [], getToolMetadata: () => undefined },
      history: {},
      providerAdapter: {},
      telemetryAdapter: {},
    });
  });

  it('reuses stored HistoryService when one is provided', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const existingHistoryService = new HistoryService();
    const clearFn = vi.fn();

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: existingHistoryService,
      clearStoredHistoryService: clearFn,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(clearFn).toHaveBeenCalled();
    expect(vi.mocked(loadAgentRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({
          historyService: existingHistoryService,
        }),
      }),
    );
  });

  it('creates a new HistoryService when none is stored', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const clearFn = vi.fn();

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: undefined,
      clearStoredHistoryService: clearFn,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(clearFn).not.toHaveBeenCalled();
    expect(HistoryService).toHaveBeenCalled();
  });

  it('adds extra history to a new HistoryService', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const mockHistoryInstance = {
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
    };
    vi.mocked(HistoryService).mockImplementationOnce(
      () => mockHistoryInstance as unknown as HistoryService,
    );

    const extraHistory = [
      { role: 'user' as const, parts: [{ text: 'hello' }] },
    ];

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      extraHistory,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(mockHistoryInstance.add).toHaveBeenCalled();
  });

  it('configures thinking for supported models', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState({ model: 'gemini-2.5-flash' });
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

    expect(GeminiChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      }),
      expect.anything(),
    );
  });

  it('disables thinking config for gemini-2.0 models', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState({ model: 'gemini-2.0-flash' });
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

    expect(GeminiChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({ thinkingConfig: expect.anything() }),
      expect.anything(),
    );
  });

  it('sets active todos provider on the created chat', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const mockChat = {
      setActiveTodosProvider: vi.fn(),
      getHistoryService: vi.fn().mockReturnValue(null),
    };
    vi.mocked(GeminiChat).mockImplementationOnce(
      () => mockChat as unknown as GeminiChat,
    );

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

    expect(mockChat.setActiveTodosProvider).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('updates todo tool availability from filtered declarations', async () => {
    const { buildToolDeclarationsFromView } = await import(
      './clientToolGovernance.js'
    );
    const mockDeclarations = [{ name: 'todo_write' }];
    vi.mocked(buildToolDeclarationsFromView).mockReturnValueOnce(
      mockDeclarations as never,
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

    expect(
      todoContinuationService.updateTodoToolAvailabilityFromDeclarations,
    ).toHaveBeenCalledWith(mockDeclarations);
  });
});

describe('createChatSessionSafe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('system prompt');
    vi.mocked(getEnvironmentContext).mockResolvedValue([]);
  });

  it('wraps errors and throws with descriptive message', async () => {
    vi.mocked(loadAgentRuntime).mockRejectedValueOnce(
      new Error('runtime init failed'),
    );

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

    await expect(
      createChatSessionSafe({
        config,
        runtimeState,
        contentGenerator: makeContentGenerator(),
        storedHistoryService: undefined,
        clearStoredHistoryService: vi.fn(),
        generateContentConfig: {},
        todoContinuationService,
        toolRegistry: undefined,
      }),
    ).rejects.toThrow('Failed to initialize chat');
  });
});
