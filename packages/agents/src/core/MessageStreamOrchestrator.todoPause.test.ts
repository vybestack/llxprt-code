/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for MessageStreamOrchestrator pause-tool handling.
 *
 * Issue #2287 requirements:
 * 1. A successful pause-tool result must immediately break the retry/
 *    continuation loop, even though the pause was issued as a tool call
 *    (which otherwise routes through the generic tool-call finish path).
 * 2. Only SUCCESSFUL pause responses break the loop. A pause
 *    response carrying an error (invalid schema, empty/overlong reason,
 *    filtered reason) must NOT break the loop.
 * 3. The orchestrator must rely on the authoritative in-memory
 *    isSuccessfulTodoPauseResponse signal, not persisted pause-state timing.
 *
 * The observable that DISTINGUISHES the explicit pause branch
 * (_evaluateTodoContinuation with todoPauseSeen) from the generic
 * tool-call finish (_finishWithToolCalls) is the AfterAgent-hook
 * continuation: _finishWithToolCalls forwards a blocking AfterAgent hook
 * decision into sendMessageStream (a new continuation turn), whereas the
 * pause branch returns done immediately and never calls sendMessageStream.
 * Asserting on sendMessageStream is asserting on the hook's public
 * observable effect (a follow-up model turn), not on a private method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PartListUnion } from '@google/genai';
import type {
  ServerGeminiStreamEvent,
  ToolCallResponseInfo,
  ToolCallRequestInfo,
} from './turn.js';
import { GeminiEventType } from './turn.js';
import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { Todo } from '@vybestack/llxprt-code-tools';

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

function makePauseRequest(): ToolCallRequestInfo {
  return {
    name: 'todo_pause',
    args: { reason: 'blocked' },
    callId: 'pause-call-1',
  } as unknown as ToolCallRequestInfo;
}

function makePauseResponse(success: boolean): ToolCallResponseInfo {
  const base = {
    callId: 'pause-call-1',
    responseParts: [
      {
        functionResponse: {
          name: 'todo_pause',
          id: 'pause-call-1',
          response: success ? { ok: true } : {},
        },
      },
    ],
    resultDisplay: undefined,
  };
  if (success) {
    return {
      ...base,
      error: undefined,
      errorType: undefined,
    } as unknown as ToolCallResponseInfo;
  }
  return {
    ...base,
    error: new Error('reason exceeds maximum length of 500 characters'),
    errorType: 'EXECUTION_ERROR',
  } as unknown as ToolCallResponseInfo;
}

interface BuildOptions {
  turnStream?: AsyncGenerator<ServerGeminiStreamEvent>;
  activeTodos?: Todo[];
  blockingAfterHook?: boolean;
  isSuccessfulTodoPauseResponse?: (
    response: ToolCallResponseInfo | undefined,
  ) => boolean;
}

function buildOrchestrator(options: BuildOptions = {}): {
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>;
  deps: MessageStreamDeps;
} {
  const mockChat = {
    getLastPromptTokenCount: vi.fn().mockReturnValue(100),
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
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

  // A blocking AfterAgent hook is the observable distinguisher:
  // _finishWithToolCalls forwards its reason into sendMessageStream, but the
  // pause branch returns done immediately and never calls sendMessageStream.
  const blockingAfterHookOutput =
    options.blockingAfterHook === true
      ? ({
          isBlockingDecision: () => true,
          shouldStopExecution: () => false,
          getEffectiveReason: () => 'hook-says-continue',
          shouldClearContext: () => false,
        } as unknown as ReturnType<
          MessageStreamDeps['agentHookManager']['fireAfterAgentHookSafe']
        >)
      : undefined;

  const todoContinuationService = {
    clearPausedState: vi.fn().mockResolvedValue(undefined),
    toolActivityCount: 0,
    toolCallReminderLevel: 'none',
    consecutiveComplexTurns: 0,
    lastTodoSnapshot: [],
    recordModelActivity: vi.fn(),
    isSuccessfulTodoPauseResponse:
      options.isSuccessfulTodoPauseResponse ?? vi.fn().mockReturnValue(false),
    isTodoToolCall: vi.fn().mockReturnValue(false),
    applyPendingReminder: vi.fn((r: PartListUnion) => Promise.resolve(r)),
    getTodoReminderForCurrentState: vi.fn().mockResolvedValue({
      todos: activeTodos,
      activeTodos,
      reminder: 'Please continue working on the following task...',
    }),
    areTodoSnapshotsEqual: vi.fn().mockReturnValue(true),
    processComplexityAnalysis: vi.fn().mockReturnValue(undefined),
    appendTodoSuffixToRequest: vi.fn(),
    appendSystemReminderToRequest: vi.fn(),
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    setLastTodoToolTurn: vi.fn(),
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
      fireAfterAgentHookSafe: vi
        .fn()
        .mockResolvedValue(blockingAfterHookOutput),
    } as unknown as MessageStreamDeps['agentHookManager'],
    getEffectiveModel: () => 'gpt-4',
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
    getLastPromptId: () => undefined,
    setLastPromptId: vi.fn(),
    resetCurrentSequenceModel: vi.fn(),
    updateTelemetryTokenCount: vi.fn(),
    sendMessageStream: vi.fn(
      async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        // Empty — only its invocation (via _finishWithToolCalls) matters.
      },
    ),
  };

  return {
    orchestrator: new MessageStreamOrchestrator(deps),
    deps,
  };
}

async function collectEvents(
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>,
): Promise<ServerGeminiStreamEvent[]> {
  const events: ServerGeminiStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'test' }] as PartListUnion,
    new AbortController().signal,
    'prompt-1',
    1,
    false,
  )) {
    events.push(event);
  }
  return events;
}

function toolCallTurnStream(
  response: ToolCallResponseInfo,
): AsyncGenerator<ServerGeminiStreamEvent> {
  return (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
    yield {
      type: GeminiEventType.ToolCallRequest,
      value: makePauseRequest(),
    };
    yield {
      type: GeminiEventType.ToolCallResponse,
      value: response,
    };
    yield {
      type: GeminiEventType.Finished,
      value: { outcome: { hadVisibleOutput: true } },
    };
  })();
}

function pauseTurnStream(
  success: boolean,
): AsyncGenerator<ServerGeminiStreamEvent> {
  return toolCallTurnStream(makePauseResponse(success));
}

function expectPauseToolEvents(events: ServerGeminiStreamEvent[]): void {
  expect(
    events.some((event) => event.type === GeminiEventType.ToolCallRequest),
  ).toBe(true);
  expect(
    events.some((event) => event.type === GeminiEventType.ToolCallResponse),
  ).toBe(true);
}

describe('MessageStreamOrchestrator — todo_pause loop break (issue #2287)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenLimit).mockImplementation(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
  });

  describe('successful pause breaks the loop via the explicit pause branch', () => {
    it('suppresses the AfterAgent-hook continuation that the generic tool-call finish would fire', async () => {
      // If todoPauseSeen is not evaluated before hadToolCallsThisTurn,
      // _finishWithToolCalls runs and forwards the blocking hook reason into
      // sendMessageStream. The pause branch must not.
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: pauseTurnStream(true),
        blockingAfterHook: true,
        isSuccessfulTodoPauseResponse: vi.fn().mockReturnValue(true),
      });

      const events = await collectEvents(orchestrator);

      expect(deps.sendMessageStream).not.toHaveBeenCalled();
      expectPauseToolEvents(events);
    });

    it('breaks without depending on an AfterAgent-hook continuation', async () => {
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: pauseTurnStream(true),
        isSuccessfulTodoPauseResponse: vi.fn().mockReturnValue(true),
      });

      const events = await collectEvents(orchestrator);

      expect(deps.sendMessageStream).not.toHaveBeenCalled();
      expectPauseToolEvents(events);
    });
  });

  describe('invalid/error pause does NOT trigger the authoritative pause branch', () => {
    it('routes through the generic tool-call finish, forwarding the blocking hook into a continuation', async () => {
      // An invalid pause must NOT set todoPauseSeen, so _finishWithToolCalls
      // runs and forwards the blocking hook into sendMessageStream.
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: pauseTurnStream(false),
        blockingAfterHook: true,
        isSuccessfulTodoPauseResponse: vi.fn().mockReturnValue(false),
      });

      await collectEvents(orchestrator);

      expect(deps.sendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('passes the raw pause response to the success classifier without short-circuiting', async () => {
      const errorResponse = {
        callId: 'pause-call-1',
        responseParts: [
          {
            functionResponse: {
              name: 'todo_pause',
              id: 'pause-call-1',
              response: {},
            },
          },
        ],
        resultDisplay: undefined,
        error: new Error('filtered'),
        errorType: 'EXECUTION_ERROR',
      } as unknown as ToolCallResponseInfo;
      const classifier = vi.fn().mockReturnValue(false);
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: toolCallTurnStream(errorResponse),
        blockingAfterHook: true,
        isSuccessfulTodoPauseResponse: classifier,
      });

      await collectEvents(orchestrator);

      expect(classifier).toHaveBeenCalledWith(errorResponse);
      expect(deps.sendMessageStream).toHaveBeenCalledTimes(1);
    });
  });
});
