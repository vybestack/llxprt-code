import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { makeRuntimeContext } from './__tests__/structural-history-fixture.js';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { createOwnerPolicyFixture } from './__tests__/session-policy-fixture.js';
import { isToolBlocked } from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { environmentContextMock } from './__tests__/chat-factory-fixture.js';
import {
  fixturePaths,
  realHistoryServiceModule,
} from './__tests__/chat-factory-fixture.js';

import {
  makeConfig,
  makeRuntimeState,
  makeTodoContinuationService,
  noMcp,
  makeGenerationDeps,
  createTestChatSession,
} from './__tests__/chat-factory-fixture.js';
import { instructionFixture } from './__tests__/instruction-fixture.js';
import { createFactoryFixtureMediaStore } from './chatSessionFactoryMediaTestHelper.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildSystemInstruction,
  createChatSession,
  createChatSessionSafe,
  resolveModelForSystemPrompt,
} from './ChatSessionFactory.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

describe('session-owned runtime policy', () => {
  it('assembles compression settings from the supplied store', () => {
    const { owner, runtime } = createOwnerPolicyFixture({
      'compression-threshold': 0.9,
      'compression-preserve-threshold': 0.3,
      'context-limit': 50000,
    });
    expect(runtime.ephemerals.compressionThreshold()).toBe(0.9);
    expect(owner.readRuntimePolicy().preserveThreshold).toBe(0.3);
    expect(runtime.ephemerals.contextLimit()).toBe(50000);
  });

  it('uses runtime defaults when policies are not set', () => {
    const { owner, runtime } = createOwnerPolicyFixture();
    expect(runtime.ephemerals.compressionThreshold()).toBe(0.85);
    expect(owner.readRuntimePolicy().preserveThreshold).toBeUndefined();
    expect(runtime.ephemerals.preserveThreshold()).toBe(0.4);
    expect(owner.readRuntimePolicy().contextLimit).toBeUndefined();
    expect(runtime.ephemerals.contextLimit()).toBe(128000);
  });

  it('falls back to defaults when thresholds are NaN or Infinity', () => {
    const { owner, runtime } = createOwnerPolicyFixture({
      'compression-threshold': NaN,
      'compression-preserve-threshold': Infinity,
      'context-limit': -Infinity,
    });
    expect(runtime.ephemerals.compressionThreshold()).toBe(0.85);
    expect(owner.readRuntimePolicy().preserveThreshold).toBeUndefined();
    expect(runtime.ephemerals.preserveThreshold()).toBe(0.4);
    expect(owner.readRuntimePolicy().contextLimit).toBeUndefined();
    expect(runtime.ephemerals.contextLimit()).toBe(128000);
  });

  it('includes reasoning settings from the supplied store', () => {
    const { owner } = createOwnerPolicyFixture({
      'reasoning.enabled': true,
      'reasoning.effort': 'max',
      'reasoning.maxTokens': 8192,
    });
    const policy = owner.readRuntimePolicy();
    expect(policy['reasoning.enabled']).toBe(true);
    expect(policy['reasoning.effort']).toBe('max');
    expect(policy['reasoning.maxTokens']).toBe(8192);
  });

  it('normalizes tool governance while retaining disabled precedence', () => {
    const { owner } = createOwnerPolicyFixture({
      'tools.allowed': ['read_file', 'glob'],
      'tools.disabled': ['glob'],
    });
    const governance = owner.readToolGovernance([]);
    expect(isToolBlocked('glob', governance)).toBe(true);
    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('does not let session policy writes change declared Config telemetry', () => {
    const config = makeConfig();
    const { owner } = createOwnerPolicyFixture();
    owner.writeUserParameter('telemetry.enabled', true);
    expect(config.getTelemetryEnabled()).toBe(false);
    expect(owner.readRuntimePolicy()).not.toHaveProperty('telemetry');
  });
});

describe('buildSystemInstruction', () => {
  const MODEL = 'gemini-2.5-flash';

  beforeEach(() => {
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue('core system prompt');
  });

  it('includes user memory in the system prompt', async () => {
    const config = makeConfig({
      userMemory: 'remember this',
    });

    await buildSystemInstruction(
      config,
      noMcp,
      ['tool_a'],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory text'),
      fixturePromptPolicy(config),
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ userMemory: 'remember this' }),
    );
  });

  it('includes core memory in the system prompt', async () => {
    const config = makeConfig();

    await buildSystemInstruction(
      config,
      noMcp,
      ['tool_a'],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory'),
      fixturePromptPolicy(config),
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ coreMemory: 'core memory' }),
    );
  });

  it('includes MCP instructions when available', async () => {
    const config = makeConfig();

    await buildSystemInstruction(
      config,
      () => 'use the mcp tool',
      [],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory text'),
      fixturePromptPolicy(config),
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mcpInstructions: 'use the mcp tool' }),
    );
  });

  it('prepends environment context to the system instruction', async () => {
    const config = makeConfig();
    const envParts = [{ text: 'CWD: /workspace' }];

    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue('base prompt');

    const result = await buildSystemInstruction(
      config,
      noMcp,
      [],
      envParts,
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory text'),
      fixturePromptPolicy(config),
    );

    expect(result).toBe('CWD: /workspace\n\nbase prompt');
  });

  it('appends JIT memory to user memory when available', async () => {
    const config = makeConfig({
      isJitContextEnabled: vi.fn().mockReturnValue(false),
      userMemory: 'base memory',
    });

    await buildSystemInstruction(
      config,
      noMcp,
      [],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
        config.getProvidedInstructions(),
        'jit memory content',
      ),
      fixturePromptPolicy(config),
    );

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
    (
      shouldIncludeSubagentDelegationForConfig as Mock<
        typeof shouldIncludeSubagentDelegationForConfig
      >
    ).mockResolvedValueOnce(true);

    const config = makeConfig();
    await buildSystemInstruction(
      config,
      noMcp,
      ['task', 'list_subagents'],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory text'),
      fixturePromptPolicy(config),
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ includeSubagentDelegation: true }),
    );
  });

  it('uses non-interactive mode when config reports non-interactive', async () => {
    const config = makeConfig({
      isInteractive: vi.fn().mockReturnValue(false),
    });

    await buildSystemInstruction(
      config,
      noMcp,
      [],
      [],
      undefined,
      MODEL,
      fixturePaths().directories(),
      instructionFixture(config.getProvidedInstructions(), 'core memory text'),
      fixturePromptPolicy(config),
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ interactionMode: 'non-interactive' }),
    );
  });
});

describe('createChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue('system prompt');
    environmentContextMock.mockResolvedValue([]);
    (loadAgentRuntime as Mock<typeof loadAgentRuntime>).mockResolvedValue({
      runtimeContext: makeRuntimeContext(true),
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
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: existingHistoryService,
      clearStoredHistoryService: clearFn,
      todoContinuationService,
    });

    expect(clearFn).toHaveBeenCalled();
    expect(
      loadAgentRuntime as Mock<typeof loadAgentRuntime>,
    ).toHaveBeenCalledWith(
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
    const { HistoryService: RealHistoryService } = realHistoryServiceModule;
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
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService,
      clearStoredHistoryService: vi.fn(),
      extraHistory,
      todoContinuationService,
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
    const { historyState, clearStoredHistoryService } =
      await observeReusedHistory();
    expect(historyState).toStrictEqual({
      wasInitiallyNonEmpty: true,
      isEmptyAfterReuse: false,
      historyLength: 1,
      retainedLiveTurn: true,
    });
    expect(clearStoredHistoryService).toHaveBeenCalledTimes(1);
  });

  const observeReusedHistory = async () => {
    // A mid-session provider switch stores the live (non-empty) HistoryService;
    // setupHistoryService must reuse it as-is and NOT also load extraHistory,
    // or the conversation would be duplicated. This pins the isEmpty()
    // discriminator's other branch.
    const { HistoryService: RealHistoryService } = realHistoryServiceModule;
    const storedHistoryService = new RealHistoryService();
    // Pre-seed the stored service so it is non-empty (simulating a live conv).
    storedHistoryService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'live turn before switch' }],
      },
      'model-x',
    );
    const wasInitiallyNonEmpty = !storedHistoryService.isEmpty();

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
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService,
      clearStoredHistoryService,
      extraHistory,
      todoContinuationService,
    });

    // The stored service keeps exactly its one live turn; extraHistory was
    // ignored, not appended.
    const after = storedHistoryService.getAll();

    // Reusing the stored service must still hand ownership to the chat session
    // (the stored reference is cleared on the client so it cannot be reused).

    const retainedLiveTurn = after[0].blocks.some(
      (b) => b.type === 'text' && b.text === 'live turn before switch',
    );
    return {
      clearStoredHistoryService,
      historyState: {
        wasInitiallyNonEmpty,
        isEmptyAfterReuse: storedHistoryService.isEmpty(),
        historyLength: after.length,
        retainedLiveTurn,
      },
    };
  };

  it('passes profile context-limit into the rebuilt runtime settings', async () => {
    await configureProfileContextLimit();
    expect(
      loadAgentRuntime as Mock<typeof loadAgentRuntime>,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          settings: expect.objectContaining({
            contextLimit: 200000,
          }),
        }),
      }),
    );
  });

  const configureProfileContextLimit = async () => {
    const config = makeConfig();
    const { owner } = createOwnerPolicyFixture({ 'context-limit': 200000 });
    const runtimeState = makeRuntimeState({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    });
    const todoContinuationService = makeTodoContinuationService();

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId, owner),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      todoContinuationService,
    });
  };

  it('creates a new HistoryService when none is stored', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const clearFn = vi.fn();
    const createHistoryService = vi.fn(() => new HistoryService());

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: clearFn,
      todoContinuationService,
      createHistoryService,
    });

    expect(clearFn).not.toHaveBeenCalled();
    expect(createHistoryService).toHaveBeenCalledOnce();
  });

  it('adds extra history to a new HistoryService', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    let recordedHistory: IContent[] = [];
    const mockHistoryInstance = {
      add: vi.fn(),
      addBatch: async (contents: readonly IContent[]): Promise<void> => {
        recordedHistory = [...recordedHistory, ...contents];
      },
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      resetTokenAccounting: vi.fn(),
      setActiveTokenizationTarget: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
    };
    (
      HistoryService as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(
      () => mockHistoryInstance as unknown as HistoryService,
    );

    const extraHistory = [
      { speaker: 'human' as const, blocks: [{ type: 'text', text: 'hello' }] },
    ];

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      extraHistory,
      todoContinuationService,
    });

    expect(recordedHistory).toStrictEqual([
      {
        ...extraHistory[0],
        metadata: { turnId: 'turn-1' },
      },
    ]);
  });

  it('configures thinking for supported models', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState({ model: 'gemini-2.5-flash' });
    const todoContinuationService = makeTodoContinuationService();

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      todoContinuationService,
    });

    expect(ChatSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        reasoning: { includeInOutput: true },
      }),
      [],
      expect.anything(),
      expect.anything(),
    );
  });

  it('disables thinking config for gemini-2.0 models', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState({ model: 'gemini-2.0-flash' });
    const todoContinuationService = makeTodoContinuationService();

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      todoContinuationService,
    });

    expect(ChatSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({ reasoning: expect.anything() }),
      [],
      expect.anything(),
      expect.anything(),
    );
  });

  it('sets active todos provider on the created chat', async () => {
    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();
    const mockChat = {
      setActiveTodosProvider: vi.fn(),
      setTranscriptPathProvider: vi.fn(),
      getHistoryService: vi.fn().mockReturnValue(null),
    };
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(() => mockChat as unknown as ChatSession);

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      todoContinuationService,
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
    (
      buildToolDeclarationsFromView as Mock<
        typeof buildToolDeclarationsFromView
      >
    ).mockReturnValueOnce(mockDeclarations as never);

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

    await createChatSession({
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      ...makeGenerationDeps(runtimeState.runtimeId),
      config,
      mediaStore: createFactoryFixtureMediaStore(config),
      runtimeState,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      todoContinuationService,
    });

    expect(
      todoContinuationService.updateTodoToolAvailabilityFromDeclarations,
    ).toHaveBeenCalledWith(mockDeclarations);
  });
});

describe('createChatSessionSafe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue('system prompt');
    environmentContextMock.mockResolvedValue([]);
  });

  it('wraps errors and throws with descriptive message', async () => {
    (loadAgentRuntime as Mock<typeof loadAgentRuntime>).mockRejectedValueOnce(
      new Error('runtime init failed'),
    );

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

    await expect(
      createChatSessionSafe({
        instructions: instructionFixture(
          config.getProvidedInstructions(),
          'core memory text',
        ),
        ...makeGenerationDeps(runtimeState.runtimeId),
        config,
        mediaStore: createFactoryFixtureMediaStore(config),
        runtimeState,
        storedHistoryService: undefined,
        clearStoredHistoryService: vi.fn(),
        todoContinuationService,
      }),
    ).rejects.toThrow('Failed to initialize chat');
  });
});

describe('resolveModelForSystemPrompt (issue #3138)', () => {
  it('retains a non-blank admitted model', () => {
    expect(resolveModelForSystemPrompt('glm-5.2')).toBe('glm-5.2');
  });

  it('throws when the admitted model is an empty string', () => {
    expect(() => resolveModelForSystemPrompt('')).toThrow(/no model identity/i);
  });

  it('throws when an external caller supplies undefined', () => {
    expect(() =>
      Reflect.apply(resolveModelForSystemPrompt, undefined, [undefined]),
    ).toThrow(/no model identity/i);
  });

  it('throws when the admitted model is only whitespace', () => {
    expect(() => resolveModelForSystemPrompt('   ')).toThrow(
      /no model identity/i,
    );
  });
});

describe('createChatSession: model identity in system prompt (issue #3138)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue('core system prompt');
    environmentContextMock.mockResolvedValue([]);
  });

  it('uses the explicitly selected runtime model instead of declared Config model', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('glm-5.2'),
    });
    const runtimeState = makeRuntimeState({
      model: 'gpt-5.5',
      provider: 'openai',
    });
    await createTestChatSession(config, runtimeState);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.5' }),
    );
  });

  it('uses the selected runtime model for tokenization despite different Config declaration', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('profile-model'),
    });
    const runtimeState = makeRuntimeState({
      model: 'selected-model',
      provider: 'openai',
    });
    const mockHistoryInstance = {
      add: vi.fn(),
      addBatch: vi.fn().mockResolvedValue(undefined),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(42),
      resetTokenAccounting: vi.fn(),
      setActiveTokenizationTarget: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(true),
      getAll: vi.fn().mockReturnValue([]),
    };
    (
      HistoryService as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(() => mockHistoryInstance);

    await createTestChatSession(config, runtimeState);

    expect(
      mockHistoryInstance.setActiveTokenizationTarget,
    ).toHaveBeenCalledWith('selected-model', 'openai');
  });

  it('pairs the selected runtime provider and model without Config selection', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('claude-opus-4'),
    });
    const runtimeState = makeRuntimeState({
      model: 'gpt-5.5',
      provider: 'openai',
    });
    await createTestChatSession(config, runtimeState);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        provider: 'openai',
      }),
    );
  });

  it('throws when the selected runtime has no model rather than substituting Config declaration', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('declared-model'),
    });
    const runtimeState = makeRuntimeState({
      model: '',
      provider: 'openai',
    });
    await expect(createTestChatSession(config, runtimeState)).rejects.toThrow(
      /no model identity/i,
    );
  });
});

function fixturePromptPolicy(config: Config) {
  const policy =
    createSessionSettingsFixture(config).settingsOwner.readRuntimePolicy()
      .promptPolicy;
  if (policy === undefined)
    throw new Error('Fixture settings owner did not provide prompt policy');
  return policy;
}
