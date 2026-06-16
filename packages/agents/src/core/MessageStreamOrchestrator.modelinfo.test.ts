/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for MessageStreamOrchestrator ModelInfo emission.
 *
 * Issue #1770 requirements:
 * 1. ModelInfo must be emitted when composite provider/profile/model identity
 *    changes during same-prompt retries/continuations — not only inside
 *    isNewPrompt.
 * 2. Duplicate ModelInfo must be suppressed for the same identity.
 * 3. Model resolution should prefer the provider manager's active model where
 *    available, not just config.getModel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PartListUnion } from '@google/genai';
import type { ServerGeminiStreamEvent, ModelInfo } from './turn.js';
import { GeminiEventType } from './turn.js';
import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';

const mockTurnRun = vi.fn();

vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => ({
  tokenLimit: vi.fn(
    (_model: string, userContextLimit?: number) =>
      userContextLimit ?? 1_000_000,
  ),
}));

vi.mock('./turn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./turn.js')>();
  class MockTurn {
    pendingToolCalls: unknown[] = [];
    run = mockTurnRun;
  }
  return {
    ...actual,
    Turn: MockTurn as unknown as typeof actual.Turn,
  };
});

import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';

interface HarnessState {
  model: string;
  providerName?: string;
  profileName?: string | null;
  providerManagerDefaultModel?: string;
  providerManagerActiveModel?: string;
  lastPromptId?: string;
  currentSequenceModel: string | null;
  contextLimit?: number;
}

interface BuildOptions extends Partial<HarnessState> {
  /** Override the stream produced by Turn.run */
  turnStream?: AsyncGenerator<ServerGeminiStreamEvent>;
}

function buildOrchestrator(options: BuildOptions = {}): {
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>;
  state: HarnessState;
} {
  const state: HarnessState = {
    model: options.model ?? 'gpt-4',
    providerName: options.providerName,
    profileName: options.profileName ?? null,
    providerManagerDefaultModel: options.providerManagerDefaultModel,
    providerManagerActiveModel: options.providerManagerActiveModel,
    lastPromptId: options.lastPromptId,
    currentSequenceModel: options.currentSequenceModel ?? null,
    contextLimit: options.contextLimit,
  };

  const mockChat = {
    getLastPromptTokenCount: vi.fn().mockReturnValue(100),
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
  };

  const providerManager = {
    getActiveProviderName: vi.fn(() => state.providerName ?? ''),
    getActiveProvider: vi.fn(() => ({
      name: state.providerName ?? 'openai',
      getCurrentModel: vi.fn(() => state.providerManagerActiveModel ?? ''),
      getDefaultModel: vi.fn(() => state.providerManagerDefaultModel ?? ''),
    })),
  };

  const config = {
    getContentGeneratorConfig: vi.fn(() => ({
      providerManager,
      model: state.model,
    })),
    getMaxSessionTurns: vi.fn(() => 0),
    getIdeMode: vi.fn(() => false),
    getModel: vi.fn(() => state.model),
    getEphemeralSetting: vi.fn((key: string) =>
      key === 'context-limit' ? state.contextLimit : undefined,
    ),
    getSettingsService: vi.fn(() => ({
      getCurrentProfileName: vi.fn(() => state.profileName ?? null),
      get: vi.fn((key: string) =>
        key === 'currentProfile' ? state.profileName : undefined,
      ),
    })),
  } as unknown as Config;

  const stream =
    options.turnStream ??
    (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
      yield { type: GeminiEventType.Content, value: 'hello' };
      yield {
        type: GeminiEventType.Finished,
        value: { outcome: { hadVisibleOutput: true } },
      };
    })();

  mockTurnRun.mockReturnValue(stream);

  const deps: MessageStreamDeps = {
    config,
    getChat: () => mockChat as unknown as ChatSession,
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as unknown as DebugLogger,
    loopDetector: {
      reset: vi.fn(),
      turnStarted: vi.fn().mockResolvedValue(false),
      addAndCheck: vi.fn().mockReturnValue(false),
    } as unknown as LoopDetectionService,
    todoContinuationService: {
      clearPausedState: vi.fn().mockResolvedValue(undefined),
      toolActivityCount: 0,
      toolCallReminderLevel: 'none',
      consecutiveComplexTurns: 0,
      lastTodoSnapshot: [],
      recordModelActivity: vi.fn(),
      isTodoPauseResponse: vi.fn().mockReturnValue(false),
      isTodoToolCall: vi.fn().mockReturnValue(false),
      applyPendingReminder: vi.fn((r: PartListUnion) => Promise.resolve(r)),
      getTodoReminderForCurrentState: vi.fn().mockResolvedValue({
        todos: [],
        activeTodos: [],
        reminder: undefined,
      }),
      areTodoSnapshotsEqual: vi.fn().mockReturnValue(true),
      processComplexityAnalysis: vi.fn().mockReturnValue(undefined),
      appendTodoSuffixToRequest: vi.fn(),
      appendSystemReminderToRequest: vi.fn(),
      updateTodoToolAvailabilityFromDeclarations: vi.fn(),
      setLastTodoToolTurn: vi.fn(),
      shouldDeferStreamEvent: vi.fn().mockReturnValue(false),
    } as unknown as MessageStreamDeps['todoContinuationService'],
    ideContextTracker: {
      getContextParts: vi.fn().mockReturnValue({
        contextParts: [],
        newIdeContext: undefined,
      }),
      recordSentContext: vi.fn(),
    } as unknown as MessageStreamDeps['ideContextTracker'],
    agentHookManager: {
      cleanupOldHookState: vi.fn(),
      fireBeforeAgentHookSafe: vi.fn().mockResolvedValue(undefined),
      fireAfterAgentHookSafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageStreamDeps['agentHookManager'],
    getEffectiveModel: () => {
      if (state.currentSequenceModel) return state.currentSequenceModel;
      return state.model;
    },
    getHistory: vi.fn().mockResolvedValue([]),
    getSessionTurnCount: vi.fn().mockReturnValue(1),
    incrementSessionTurnCount: vi.fn(),
    lazyInitialize: vi.fn().mockResolvedValue(undefined),
    startChat: vi.fn().mockResolvedValue(mockChat),
    getPreviousHistory: vi.fn().mockReturnValue(undefined),
    setChat: vi.fn(),
    hasChat: vi.fn().mockReturnValue(true),
    complexityAnalyzer: {
      analyzeComplexity: vi.fn().mockReturnValue({
        complexityScore: 0.2,
        isComplex: false,
        detectedTasks: [],
        sequentialIndicators: [],
        questionCount: 0,
        shouldSuggestTodos: false,
      }),
    } as unknown as ComplexityAnalyzer,
    getLastPromptId: () => state.lastPromptId,
    setLastPromptId: (id: string) => {
      state.lastPromptId = id;
    },
    resetCurrentSequenceModel: () => {
      state.currentSequenceModel = null;
    },
    updateTelemetryTokenCount: vi.fn(),
    sendMessageStream: vi.fn(),
  };

  return {
    orchestrator: new MessageStreamOrchestrator(deps),
    state,
  };
}

/** Run execute and collect all ModelInfo events. */
async function collectModelInfos(
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>,
  promptId: string,
): Promise<ModelInfo[]> {
  const events: ServerGeminiStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'test' }] as PartListUnion,
    new AbortController().signal,
    promptId,
    1,
    false,
  )) {
    events.push(event);
  }
  return events
    .filter(
      (e): e is { type: typeof GeminiEventType.ModelInfo; value: ModelInfo } =>
        e.type === GeminiEventType.ModelInfo,
    )
    .map((e) => e.value);
}

describe('MessageStreamOrchestrator — ModelInfo emission (issue #1770)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenLimit).mockImplementation(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
  });

  it('emits ModelInfo for a new prompt', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'gpt-4',
      providerName: 'openai',
      profileName: null,
    });

    const infos = await collectModelInfos(orchestrator, 'prompt-1');

    expect(infos).toHaveLength(1);
    expect(infos[0]?.model).toBe('gpt-4');
  });

  it('emits exactly one ModelInfo on a continuation when model identity changes', async () => {
    const { orchestrator, state } = buildOrchestrator({
      model: 'gpt-4',
      providerName: 'openai',
    });

    // Simulate the first prompt already completed (lastPromptId is set)
    state.lastPromptId = 'prompt-1';

    // Now simulate a model change during a continuation (same prompt id)
    state.model = 'claude-3';
    state.providerName = 'anthropic';
    state.currentSequenceModel = 'claude-3';

    // Re-enter execute with the SAME prompt id (continuation/retry)
    const infos = await collectModelInfos(orchestrator, 'prompt-1');

    // Should emit exactly one ModelInfo for the changed identity
    expect(infos).toHaveLength(1);
    expect(infos[0]?.model).toBe('claude-3');
    expect(infos[0]?.providerName).toBe('anthropic');
  });

  it('does not emit duplicate ModelInfo for same identity on continuation', async () => {
    const { orchestrator, state } = buildOrchestrator({
      model: 'gpt-4',
      providerName: 'openai',
    });

    // First: run the initial prompt to set the last-emitted identity
    const infos1 = await collectModelInfos(orchestrator, 'prompt-1');
    expect(infos1).toHaveLength(1);

    // Now re-enter with the SAME prompt id — same model/provider/profile
    state.lastPromptId = 'prompt-1';

    const infos2 = await collectModelInfos(orchestrator, 'prompt-1');

    // No new prompt, no identity change → zero ModelInfo events
    expect(infos2).toHaveLength(0);
  });

  it('emits ModelInfo when only profile changes on continuation', async () => {
    const { orchestrator, state } = buildOrchestrator({
      model: 'gpt-4',
      providerName: 'openai',
      profileName: 'profile-a',
    });

    state.lastPromptId = 'prompt-1';

    // Change profile only
    state.profileName = 'profile-b';

    const infos = await collectModelInfos(orchestrator, 'prompt-1');

    expect(infos).toHaveLength(1);
    expect(infos[0]?.profileName).toBe('profile-b');
    expect(infos[0]?.displayLabel).toBe('profile-b');
  });

  it('prefers provider manager active model over config.getModel', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'config-model',
      providerName: 'openai',
      providerManagerActiveModel: 'provider-active-model',
    });

    const infos = await collectModelInfos(orchestrator, 'prompt-new');

    expect(infos).toHaveLength(1);
    // The ModelInfo should reflect provider manager active model,
    // not the config model
    expect(infos[0]?.model).toBe('provider-active-model');
  });

  it('does not report provider defaults as the active model when a user-selected provider model exists', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'selected-provider-model',
      providerName: 'Makora',
      providerManagerDefaultModel: 'nvidia/Kimi-K2.6-NVFP4',
      providerManagerActiveModel: 'zai-org/GLM-5.1-FP8',
    });

    const infos = await collectModelInfos(
      orchestrator,
      'prompt-selected-model',
    );

    expect(infos).toHaveLength(1);
    expect(infos[0]?.model).toBe('zai-org/GLM-5.1-FP8');
  });

  it('uses the configured context-limit for preflight overflow checks', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'claude-opus-4-8',
      providerName: 'anthropic',
      profileName: 'opusthinking',
      contextLimit: 200_000,
    });

    await collectModelInfos(orchestrator, 'prompt-context-limit');

    expect(vi.mocked(tokenLimit).mock.calls).toContainEqual([
      'claude-opus-4-8',
      200_000,
    ]);
  });
});
