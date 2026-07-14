/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));

vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a', 'tool_b']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  getEnvironmentContext: vi.fn().mockResolvedValue([]),
}));

vi.mock('./chatSession.js', () => ({
  ChatSession: vi.fn().mockImplementation(() => ({
    setActiveTodosProvider: vi.fn(),
    getHistoryService: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js', () => ({
  loadAgentRuntime: vi.fn().mockResolvedValue({
    runtimeContext: {},
    contentGenerator: {},
    toolsView: { listToolNames: () => [] },
    history: {},
    providerAdapter: {},
    telemetryAdapter: {},
  }),
}));

vi.mock(
  '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js',
  () => ({
    setProviderRuntimeStateFactory: vi.fn(),
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  }),
);

vi.mock(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js',
  () => ({
    HistoryService: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(true),
      getAll: vi.fn().mockReturnValue([]),
    })),
  }),
);

vi.mock(
  '@vybestack/llxprt-code-core/services/history/ContentConverters.js',
  () => ({
    ContentConverters: {
      toIContent: vi.fn().mockReturnValue({ speaker: 'human', blocks: [] }),
    },
  }),
);

vi.mock('@vybestack/llxprt-code-core/utils/toolOutputLimiter.js', () => ({
  estimateTokens: vi.fn().mockReturnValue(50),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildSettingsSnapshot,
  buildSystemInstruction,
  createChatSession,
  createChatSessionSafe,
} from './ChatSessionFactory.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
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
        if (key === 'reasoning.effort') return 'max';
        if (key === 'reasoning.maxTokens') return 8192;
        return undefined;
      }),
    });

    const snapshot = buildSettingsSnapshot(config);

    expect(snapshot['reasoning.enabled']).toBe(true);
    expect(snapshot['reasoning.effort']).toBe('max');
    expect(snapshot['reasoning.maxTokens']).toBe(8192);
  });

  it('includes tool governance in snapshot', () => {
    const config = makeConfig();
    const snapshot = buildSettingsSnapshot(config, () => ({
      allowed: ['bash', 'read_file'],
    }));

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

  it('folds extraHistory into an empty reused HistoryService (#2500)', async () => {
    // Use a REAL HistoryService so the round-trip into the reused service is
    // exercised — the component under test is setupHistoryService's folding of
    // extraHistory into a stored service, and a real service proves the
    // restored turn is actually retained (not silently dropped).
    const { HistoryService: RealHistoryService } = await vi.importActual<
      typeof import('@vybestack/llxprt-code-core/services/history/HistoryService.js')
    >('@vybestack/llxprt-code-core/services/history/HistoryService.js');
    const storedHistoryService = new RealHistoryService();
    expect(storedHistoryService.isEmpty()).toBe(true);

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

    const extraHistory = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Soft circuits awaken' }],
      },
    ];

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService,
      clearStoredHistoryService: vi.fn(),
      extraHistory,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    // The reused stored service — the one forwarded to the chat the model
    // reads from — must now carry the restored turn rather than staying empty.
    expect(storedHistoryService.isEmpty()).toBe(false);
    const restored = storedHistoryService.getAll();
    expect(restored.length).toBe(1);
    expect(restored[0].speaker).toBe('human');
    const textBlock = restored[0].blocks.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect((textBlock as { text?: string }).text).toBe('Soft circuits awaken');
  });

  it('does not fold extraHistory into a non-empty reused HistoryService', async () => {
    // A mid-session provider switch stores the live (non-empty) HistoryService;
    // setupHistoryService must reuse it as-is and NOT also load extraHistory,
    // or the conversation would be duplicated. This pins the isEmpty()
    // discriminator's other branch.
    const { HistoryService: RealHistoryService } = await vi.importActual<
      typeof import('@vybestack/llxprt-code-core/services/history/HistoryService.js')
    >('@vybestack/llxprt-code-core/services/history/HistoryService.js');
    const storedHistoryService = new RealHistoryService();
    // Pre-seed the stored service so it is non-empty (simulating a live conv).
    storedHistoryService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'live turn before switch' }],
      },
      'model-x',
    );
    expect(storedHistoryService.isEmpty()).toBe(false);

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const clearStoredHistoryService = vi.fn();

    const extraHistory = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'stale carried history' }],
      },
    ];

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService,
      clearStoredHistoryService,
      extraHistory,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    // The stored service keeps exactly its one live turn; extraHistory was
    // ignored, not appended.
    const after = storedHistoryService.getAll();
    expect(after.length).toBe(1);
    expect(
      after[0].blocks.some(
        (b) => b.type === 'text' && b.text === 'live turn before switch',
      ),
    ).toBe(true);
    // Reusing the stored service must still hand ownership to the chat session
    // (the stored reference is cleared on the client so it cannot be reused).
    expect(clearStoredHistoryService).toHaveBeenCalledTimes(1);
  });

  it('passes profile context-limit into the rebuilt runtime settings', async () => {
    const config = makeConfig({
      getEphemeralSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'context-limit') return 200000;
        return undefined;
      }),
    });
    const runtimeState = makeRuntimeState({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    });
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

    expect(vi.mocked(loadAgentRuntime)).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          settings: expect.objectContaining({
            contextLimit: 200000,
          }),
        }),
      }),
    );
  });

  it('creates a new HistoryService when none is stored', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const clearFn = vi.fn();
    const createHistoryService = vi.fn(() => new HistoryService());

    await createChatSession({
      config,
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: undefined,
      clearStoredHistoryService: clearFn,
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
      createHistoryService,
    });

    expect(clearFn).not.toHaveBeenCalled();
    expect(createHistoryService).toHaveBeenCalledOnce();
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
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(HistoryService).mockImplementationOnce(
      () => mockHistoryInstance as unknown as HistoryService,
    );

    const extraHistory = [
      { speaker: 'human' as const, blocks: [{ type: 'text', text: 'hello' }] },
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

    expect(ChatSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        reasoning: { includeInOutput: true },
      }),
      [],
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

    expect(ChatSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({ reasoning: expect.anything() }),
      [],
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
    vi.mocked(ChatSession).mockImplementationOnce(
      () => mockChat as unknown as ChatSession,
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
