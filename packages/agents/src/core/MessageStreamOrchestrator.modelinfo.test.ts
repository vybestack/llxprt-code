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
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ServerAgentStreamEvent, ModelInfo } from './turn.js';
import { AgentEventType } from './turn.js';
import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import {
  buildEffectiveModelIdentity,
  type EffectiveModelIdentity,
} from './modelInfoHelpers.js';

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
  identity: EffectiveModelIdentity;
  profileName?: string | null;
  lastPromptId?: string;
  contextLimit?: number;
}

interface BuildOptions {
  providerName?: string;
  model?: string;
  profileName?: string | null;
  lastPromptId?: string;
  contextLimit?: number;
  /** Override the stream produced by Turn.run */
  turnStream?: AsyncGenerator<ServerAgentStreamEvent>;
  identityProvider?: () => EffectiveModelIdentity;
}

function buildOrchestrator(options: BuildOptions = {}): {
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>;
  state: HarnessState;
} {
  const state: HarnessState = {
    identity: {
      providerName: options.providerName ?? 'openai',
      model: options.model ?? 'gpt-4',
    },
    profileName: options.profileName ?? null,
    lastPromptId: options.lastPromptId,
    contextLimit: options.contextLimit,
  };

  const mockChat = {
    getLastPromptTokenCount: vi.fn().mockReturnValue(100),
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
  };

  const config = {
    getMaxSessionTurns: vi.fn(() => 0),
    getIdeMode: vi.fn(() => false),
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
    (async function* (): AsyncGenerator<ServerAgentStreamEvent> {
      yield { type: AgentEventType.Content, value: 'hello' };
      yield {
        type: AgentEventType.Finished,
        value: { outcome: { hadVisibleOutput: true } },
      };
    })();

  mockTurnRun.mockReturnValue(stream);

  const identityFn = options.identityProvider ?? (() => state.identity);

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
      applyPendingReminder: vi.fn((r: AgentMessageInput) => Promise.resolve(r)),
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
    getEffectiveModelIdentity: identityFn,
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
    resetCurrentSequenceModel: vi.fn(),
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
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'test' }] as AgentMessageInput,
    new AbortController().signal,
    promptId,
    1,
    false,
  )) {
    events.push(event);
  }
  return events
    .filter(
      (e): e is { type: typeof AgentEventType.ModelInfo; value: ModelInfo } =>
        e.type === AgentEventType.ModelInfo,
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
    let identity: EffectiveModelIdentity = {
      providerName: 'openai',
      model: 'gpt-4',
    };
    const { orchestrator, state } = buildOrchestrator({
      identityProvider: () => identity,
    });

    state.lastPromptId = 'prompt-1';
    identity = {
      providerName: 'anthropic',
      model: 'claude-3',
    };

    const infos = await collectModelInfos(orchestrator, 'prompt-1');

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
    expect(infos[0]?.displayLabel).toBe('profile-b:gpt-4');
  });

  it('restores all committed previous history when initializing the next chat', async () => {
    const previousHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first user turn' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first model response' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second user turn' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'second model response' }],
      },
    ];
    const { orchestrator } = buildOrchestrator();
    const deps = orchestrator['deps'];
    vi.mocked(deps.hasChat).mockReturnValue(false);
    vi.mocked(deps.getPreviousHistory).mockReturnValue(previousHistory);

    await collectModelInfos(orchestrator, 'prompt-restore-history');

    expect(deps.startChat).toHaveBeenCalledWith(previousHistory);
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

  it('B1: load-balancer profile reports the active sub-profile model, not the config default', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'glm-5.2',
      providerName: 'load-balancer',
      profileName: 'glm',
    });

    const infos = await collectModelInfos(orchestrator, 'prompt-lb-active');

    expect(infos).toHaveLength(1);
    expect(infos[0]?.model).toBe('glm-5.2');
    expect(infos[0]?.providerName).toBe('load-balancer');
    expect(infos[0]?.profileName).toBe('glm');
    expect(infos[0]?.displayLabel).toBe('glm:glm-5.2');
  });

  it('displayLabel shows profile:model when a profile is active (issue #2501)', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'gpt-5.6-sol',
      providerName: 'codex',
      profileName: 'gpt56solhigh',
    });

    const infos = await collectModelInfos(orchestrator, 'prompt-2501');

    expect(infos).toHaveLength(1);
    expect(infos[0]?.model).toBe('gpt-5.6-sol');
    expect(infos[0]?.displayLabel).toBe('gpt56solhigh:gpt-5.6-sol');
  });

  it('displayLabel shows just the model when no profile is active (issue #2501)', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'gpt-5.6-sol',
      providerName: 'codex',
      profileName: null,
    });

    const infos = await collectModelInfos(
      orchestrator,
      'prompt-2501-noprofile',
    );

    expect(infos).toHaveLength(1);
    expect(infos[0]?.displayLabel).toBe('gpt-5.6-sol');
  });

  it('issue #2544: reports the routed Codex identity, never a stale manager Gemini identity', async () => {
    const { orchestrator } = buildOrchestrator({
      model: 'gpt-5.6-sol',
      providerName: 'codex',
      profileName: null,
    });

    const infos = await collectModelInfos(orchestrator, 'prompt-2544');

    expect(infos).toHaveLength(1);
    expect(infos[0]?.providerName).toBe('codex');
    expect(infos[0]?.model).toBe('gpt-5.6-sol');
    expect(infos[0]?.displayLabel).toBe('gpt-5.6-sol');
  });
});

describe('buildEffectiveModelIdentity — model precedence (issue #2544)', () => {
  it('prefers currentSequenceModel, then routed getCurrentModel, then routed getDefaultModel, then config fallback', () => {
    const routedProvider = {
      name: 'codex',
      getCurrentModel: () => 'routed-current',
      getDefaultModel: () => 'routed-default',
    };
    expect(
      buildEffectiveModelIdentity('codex', routedProvider, 'seq', 'fallback')
        .model,
    ).toBe('seq');
    expect(
      buildEffectiveModelIdentity('codex', routedProvider, null, 'fallback')
        .model,
    ).toBe('routed-current');
  });

  it('falls back to routed getDefaultModel when getCurrentModel is blank, then config fallback', () => {
    const blankCurrent = {
      name: 'codex',
      getCurrentModel: () => '',
      getDefaultModel: () => 'routed-default',
    };
    expect(
      buildEffectiveModelIdentity('codex', blankCurrent, null, 'fallback')
        .model,
    ).toBe('routed-default');
    const blankAll = {
      name: 'codex',
      getCurrentModel: () => '',
      getDefaultModel: () => '',
    };
    expect(
      buildEffectiveModelIdentity('codex', blankAll, null, 'config-fallback')
        .model,
    ).toBe('config-fallback');
  });

  it('returns the config fallback and routed provider name when the routed provider is undefined', () => {
    const identity = buildEffectiveModelIdentity(
      'codex',
      undefined,
      null,
      'config-fallback',
    );
    expect(identity.model).toBe('config-fallback');
    expect(identity.providerName).toBe('codex');
  });

  it('issue #2544: never mixes a stale manager model with a routed provider name', () => {
    const routedCodexProvider = {
      name: 'codex',
      getCurrentModel: () => 'gpt-5.6-sol',
      getDefaultModel: () => 'gpt-5.6-sol',
    };
    const identity = buildEffectiveModelIdentity(
      'codex',
      routedCodexProvider,
      null,
      'gemini-pro',
    );
    expect(identity.providerName).toBe('codex');
    expect(identity.model).toBe('gpt-5.6-sol');
    expect(identity.model).not.toBe('gemini-pro');
  });

  it('does not evaluate provider models when the sequence model is available', () => {
    const routedProvider = {
      name: 'codex',
      getCurrentModel: () => {
        throw new Error('should not run');
      },
      getDefaultModel: () => {
        throw new Error('should not run');
      },
    };

    expect(
      buildEffectiveModelIdentity(
        'codex',
        routedProvider,
        'sequence',
        'fallback',
      ).model,
    ).toBe('sequence');
  });

  it('uses the default model when the current model accessor fails', () => {
    const routedProvider = {
      name: 'codex',
      getCurrentModel: () => {
        throw new Error('unavailable');
      },
      getDefaultModel: () => 'routed-default',
    };

    expect(
      buildEffectiveModelIdentity('codex', routedProvider, null, 'fallback')
        .model,
    ).toBe('routed-default');
  });

  it('issue #1770 load-balancer: current selection wins over default', () => {
    const routedProvider = {
      name: 'Makora',
      getCurrentModel: () => 'zai-org/GLM-5.1-FP8',
      getDefaultModel: () => 'nvidia/Kimi-K2.6-NVFP4',
    };
    expect(
      buildEffectiveModelIdentity('Makora', routedProvider, null, 'default')
        .model,
    ).toBe('zai-org/GLM-5.1-FP8');
  });

  it('issue #1770 load-balancer: default wins when no active selection', () => {
    const routedProvider = {
      name: 'Makora',
      getCurrentModel: () => '',
      getDefaultModel: () => 'nvidia/Kimi-K2.6-NVFP4',
    };
    expect(
      buildEffectiveModelIdentity('Makora', routedProvider, null, 'default')
        .model,
    ).toBe('nvidia/Kimi-K2.6-NVFP4');
  });
});
