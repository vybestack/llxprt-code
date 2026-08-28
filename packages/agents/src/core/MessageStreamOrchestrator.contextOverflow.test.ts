/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { Todo } from '@vybestack/llxprt-code-tools';
import type { ChatSession } from './chatSession.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ServerAgentStreamEvent } from './turn.js';
import { AgentEventType } from './turn.js';
import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';

const mockTurnRun = vi.fn();

const actualTokenLimits = {
  ...(await import('@vybestack/llxprt-code-core/core/tokenLimits.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => {
  const buildExports = (
    actual: typeof import('@vybestack/llxprt-code-core/core/tokenLimits.js'),
  ) => ({
    ...actual,
    tokenLimit: vi.fn(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    ),
  });
  return buildExports(actualTokenLimits);
});

const actualTurn = { ...(await import('./turn.js')) };
void vi.mock('./turn.js', () => {
  class MockTurn {
    pendingToolCalls: unknown[] = [];
    run = mockTurnRun;
  }
  return {
    ...actualTurn,
    Turn: MockTurn as unknown as typeof actualTurn.Turn,
  };
});

interface BuildOptions {
  activeTodos?: Todo[];
  /**
   * Reminder level the continuation service reaches while observing model
   * activity during the turn. Mirrors TodoContinuationService, which raises
   * the level from recordModelActivity() — that is, after the orchestrator's
   * per-prompt reset to 'none'.
   */
  raisedReminderLevel?: 'base' | 'escalated';
  turnStreamFactory?: () => AsyncGenerator<ServerAgentStreamEvent>;
  shouldClearContext?: boolean;
}

function overflowStream(): AsyncGenerator<ServerAgentStreamEvent> {
  return (async function* (): AsyncGenerator<ServerAgentStreamEvent> {
    yield {
      type: AgentEventType.ContextWindowWillOverflow,
      value: {
        estimatedRequestTokenCount: 135262,
        remainingTokenCount: 134144,
      },
    };
  })();
}

function contentStream(): AsyncGenerator<ServerAgentStreamEvent> {
  return (async function* (): AsyncGenerator<ServerAgentStreamEvent> {
    yield { type: AgentEventType.Content, value: 'hello' };
    yield {
      type: AgentEventType.Finished,
      value: {
        reason: 'stop',
        outcome: {
          hadVisibleOutput: true,
          hadThinking: false,
          hadToolCalls: false,
        },
      },
    };
  })();
}

function buildOrchestrator(options: BuildOptions): {
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>;
  deps: MessageStreamDeps;
} {
  const mockChat = {
    getLastPromptTokenCount: vi.fn().mockReturnValue(100),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(100),
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextLimit: vi.fn(() => tokenLimit('gpt-4')),
  };
  const providerManager = {
    getActiveProviderName: vi.fn(() => 'openai'),
    getActiveProvider: vi.fn(() => ({
      name: 'openai',
      getCurrentModel: vi.fn(() => ''),
      getDefaultModel: vi.fn(() => ''),
    })),
  };
  const config = {
    getContentGeneratorConfig: vi.fn(() => ({
      providerManager,
      model: 'gpt-4',
    })),
    getMaxSessionTurns: vi.fn(() => 0),
    getIdeMode: vi.fn(() => false),
    getContinueOnFailedApiCall: vi.fn(() => false),
    getModel: vi.fn(() => 'gpt-4'),
    getEphemeralSetting: vi.fn(() => undefined),
    getSettingsService: vi.fn(() => ({
      getCurrentProfileName: vi.fn(() => null),
      get: vi.fn(() => undefined),
    })),
  } as unknown as Config;

  const activeTodos = options.activeTodos ?? [
    { id: 'todo-1', content: 'Active task', status: 'in_progress' },
  ];
  const turnStreamFactory = options.turnStreamFactory ?? overflowStream;
  mockTurnRun.mockImplementation(() => turnStreamFactory());

  const afterHookOutput =
    options.shouldClearContext === true
      ? {
          isBlockingDecision: () => false,
          shouldStopExecution: () => false,
          getEffectiveReason: () => 'context cleared',
          shouldClearContext: () => true,
        }
      : undefined;
  const raisedReminderLevel = options.raisedReminderLevel;
  const reminderState: { level: 'none' | 'base' | 'escalated' } = {
    level: 'none',
  };

  const todoContinuationService = {
    clearPausedState: vi.fn().mockResolvedValue(undefined),
    toolActivityCount: 0,
    get toolCallReminderLevel(): 'none' | 'base' | 'escalated' {
      return reminderState.level;
    },
    set toolCallReminderLevel(value: 'none' | 'base' | 'escalated') {
      reminderState.level = value;
    },
    consecutiveComplexTurns: 0,
    lastTodoSnapshot: [],
    recordModelActivity: vi.fn((): void => {
      if (raisedReminderLevel !== undefined) {
        reminderState.level = raisedReminderLevel;
      }
    }),
    isSuccessfulTodoPauseResponse: vi.fn().mockReturnValue(false),
    isTodoToolCall: vi.fn().mockReturnValue(false),
    applyPendingReminder: vi.fn((request: AgentMessageInput) =>
      Promise.resolve(request),
    ),
    getTodoReminderForCurrentState: vi.fn().mockResolvedValue({
      todos: activeTodos,
      activeTodos,
      reminder: 'Please continue working on the following task...',
    }),
    areTodoSnapshotsEqual: vi.fn().mockReturnValue(true),
    processComplexityAnalysis: vi.fn().mockReturnValue(undefined),
    appendTodoSuffixToRequest: vi.fn(),
    appendSystemReminderToRequest: vi.fn(
      (request: AgentMessageInput) => request,
    ),
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    setLastTodoToolTurn: vi.fn(),
    checkpoint: vi.fn().mockReturnValue({}),
    restore: vi.fn(),
    shouldDeferStreamEvent: vi.fn().mockReturnValue(false),
  } as unknown as MessageStreamDeps['todoContinuationService'];

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
      checkpoint: vi.fn().mockReturnValue({}),
      restore: vi.fn(),
    } as unknown as LoopDetectionService,
    todoContinuationService,
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
      fireAfterAgentHookSafe: vi.fn().mockResolvedValue(afterHookOutput),
    } as unknown as MessageStreamDeps['agentHookManager'],
    getEffectiveModelIdentity: () => ({
      providerName: 'openai',
      model: 'gpt-4',
    }),
    getHistory: vi.fn().mockResolvedValue([]),
    getSessionTurnCount: vi.fn().mockReturnValue(2),
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
    getLastPromptId: () => undefined,
    setLastPromptId: vi.fn(),
    resetCurrentSequenceModel: vi.fn(),
    updateTelemetryTokenCount: vi.fn(),
    sendMessageStream: vi.fn(
      async function* (): AsyncGenerator<ServerAgentStreamEvent> {
        // No follow-up stream is needed for these tests.
      },
    ),
  };

  return { orchestrator: new MessageStreamOrchestrator(deps), deps };
}

async function collectEvents(
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'test' }] as AgentMessageInput,
    new AbortController().signal,
    'prompt-1',
    1,
    false,
  )) {
    events.push(event);
  }
  return events;
}

describe('MessageStreamOrchestrator context-overflow terminal handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (tokenLimit as Mock<typeof tokenLimit>).mockImplementation(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
  });

  it('emits the context-overflow guard once and stops when a todo is still active', async () => {
    const { orchestrator } = buildOrchestrator({});

    const events = await collectEvents(orchestrator);
    const overflowEvents = events.filter(
      (event) => event.type === AgentEventType.ContextWindowWillOverflow,
    );

    expect(overflowEvents).toHaveLength(1);
    expect(mockTurnRun.mock.calls.length).toBe(1);
    expect(overflowEvents[0]).toMatchObject({
      value: {
        estimatedRequestTokenCount: 135262,
        remainingTokenCount: 134144,
      },
    });
  });

  it('emits the context-overflow guard once and stops when a tool-call reminder is pending', async () => {
    const { orchestrator } = buildOrchestrator({
      activeTodos: [],
      raisedReminderLevel: 'base',
    });

    const events = await collectEvents(orchestrator);
    const overflowEvents = events.filter(
      (event) => event.type === AgentEventType.ContextWindowWillOverflow,
    );

    expect(overflowEvents).toHaveLength(1);
    expect(mockTurnRun.mock.calls.length).toBe(1);
    expect(overflowEvents[0]).toMatchObject({
      value: {
        estimatedRequestTokenCount: 135262,
        remainingTokenCount: 134144,
      },
    });
  });

  it('runs AfterAgent context clearing when the turn ends on context overflow', async () => {
    const { orchestrator } = buildOrchestrator({ shouldClearContext: true });

    const events = await collectEvents(orchestrator);
    const overflowIndex = events.findIndex(
      (event) => event.type === AgentEventType.ContextWindowWillOverflow,
    );
    const stoppedIndex = events.findIndex(
      (event) => event.type === AgentEventType.AgentExecutionStopped,
    );

    expect(mockTurnRun.mock.calls.length).toBe(1);
    expect(stoppedIndex).toBeGreaterThan(overflowIndex);
    expect(events[stoppedIndex]).toMatchObject({ contextCleared: true });
  });

  it('still continues a non-overflow turn while todos remain active', async () => {
    const { orchestrator } = buildOrchestrator({
      turnStreamFactory: contentStream,
    });

    await collectEvents(orchestrator);

    expect(mockTurnRun.mock.calls.length).toBeGreaterThan(1);
  });
});
