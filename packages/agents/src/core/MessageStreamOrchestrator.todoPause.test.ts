/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for MessageStreamOrchestrator's handling of tool-call
 * turns, focused on the post-#2657 architecture.
 *
 * Issue #2657: The orchestrator's pause-detection branch was dead code.
 * Turn.run() only emits ToolCallRequest events (never ToolCallResponse),
 * so the orchestrator never sees real tool responses — they arrive later
 * via the scheduler in AgenticLoop. Pause detection now lives exclusively
 * in AgenticLoop.buildNextMessage() (tested in agenticLoop.todoPause.test.ts).
 *
 * These tests verify the orchestrator's ACTUAL behavior:
 * 1. A tool-call turn (including pause-tool requests) routes through the
 *    generic _finishWithToolCalls path, ending the single-turn iteration.
 * 2. The orchestrator does NOT attempt pause detection — it treats every
 *    tool call identically, regardless of tool name.
 * 3. AfterAgent-hook continuation behavior works correctly for tool-call
 *    turns via the generic path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ServerAgentStreamEvent, ToolCallRequestInfo } from './turn.js';
import { AgentEventType } from './turn.js';
import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { Todo } from '@vybestack/llxprt-code-tools';

const mockTurnRun = vi.fn();

vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', (importOriginal) => {
  const result = importOriginal() as
    | typeof import('@vybestack/llxprt-code-core/core/tokenLimits.js')
    | Promise<typeof import('@vybestack/llxprt-code-core/core/tokenLimits.js')>;
  const buildExports = (
    actual: typeof import('@vybestack/llxprt-code-core/core/tokenLimits.js'),
  ) => {
    const tokenLimit = vi.fn(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
    return {
      ...actual,
      tokenLimit,
      resolveEffectiveContextLimit: vi.fn(
        (model: string, userCtx?: number, provCtx?: number) => {
          const ok = (v: unknown): v is number =>
            typeof v === 'number' && Number.isFinite(v) && v > 0;
          if (ok(userCtx)) return userCtx;
          if (ok(provCtx)) return provCtx;
          return tokenLimit(model);
        },
      ),
    };
  };
  if (result instanceof Promise) {
    return result.then(buildExports);
  }
  return buildExports(result);
});

vi.mock('./turn.js', (importOriginal) => {
  const result = importOriginal() as
    | typeof import('./turn.js')
    | Promise<typeof import('./turn.js')>;
  class MockTurn {
    pendingToolCalls: unknown[] = [];
    run = mockTurnRun;
  }
  if (result instanceof Promise) {
    return result.then((actual) => ({
      ...actual,
      Turn: MockTurn as unknown as typeof actual.Turn,
    }));
  }
  return {
    ...result,
    Turn: MockTurn as unknown as typeof result.Turn,
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

function makeGenericToolRequest(): ToolCallRequestInfo {
  return {
    name: 'read_file',
    args: { file_path: '/tmp/test.txt' },
    callId: 'read-call-1',
  } as unknown as ToolCallRequestInfo;
}

interface BuildOptions {
  turnStream?: AsyncGenerator<ServerAgentStreamEvent>;
  activeTodos?: Todo[];
  blockingAfterHook?: boolean;
}

function buildOrchestrator(options: BuildOptions = {}): {
  orchestrator: InstanceType<typeof MessageStreamOrchestrator>;
  deps: MessageStreamDeps;
} {
  const mockChat = {
    getLastPromptTokenCount: vi.fn().mockReturnValue(100),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(100),
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextLimit: vi.fn(() => tokenLimit()),
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
    isSuccessfulTodoPauseResponse: vi.fn().mockReturnValue(false),
    isTodoToolCall: vi.fn().mockReturnValue(false),
    applyPendingReminder: vi.fn((r: AgentMessageInput) => Promise.resolve(r)),
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
    getEffectiveModelIdentity: () => ({
      providerName: 'openai',
      model: 'gpt-4',
    }),
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
      async function* (): AsyncGenerator<ServerAgentStreamEvent> {
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

/**
 * Realistic turn stream: Turn.run() emits ONLY ToolCallRequest (never
 * ToolCallResponse — the scheduler response arrives later in AgenticLoop).
 */
function toolCallRequestOnlyStream(
  request: ToolCallRequestInfo,
): AsyncGenerator<ServerAgentStreamEvent> {
  return (async function* (): AsyncGenerator<ServerAgentStreamEvent> {
    yield {
      type: AgentEventType.ToolCallRequest,
      value: request,
    };
    yield {
      type: AgentEventType.Finished,
      value: { outcome: { hadVisibleOutput: true } },
    };
  })();
}

describe('MessageStreamOrchestrator — tool-call turns (issue #2657)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenLimit).mockImplementation(
      (_model: string, userContextLimit?: number) =>
        userContextLimit ?? 1_000_000,
    );
  });

  it('streams ordinary content before the turn source completes', async () => {
    let releaseSecondChunk = (): void => {};
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const turnStream = (async function* () {
      yield { type: AgentEventType.Content, value: 'Hello' };
      await secondChunkReady;
      yield { type: AgentEventType.Content, value: ' world' };
      yield {
        type: AgentEventType.Finished,
        value: { outcome: { hadVisibleOutput: true } },
      };
    })();
    const { orchestrator, deps } = buildOrchestrator({
      turnStream,
      activeTodos: [],
    });
    deps.todoContinuationService.shouldDeferStreamEvent = vi
      .fn()
      .mockReturnValue(false);

    const iterator = orchestrator.execute(
      [{ text: 'test' }] as unknown as AgentMessageInput,
      new AbortController().signal,
      'prompt-1',
      1,
      false,
    );

    const modelInfoResult = await iterator.next();
    expect(modelInfoResult.value.type).toBe(AgentEventType.ModelInfo);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: AgentEventType.Content, value: 'Hello' },
    });

    releaseSecondChunk();
    const remaining: ServerAgentStreamEvent[] = [];
    for await (const event of iterator) remaining.push(event);
    expect(remaining).toStrictEqual([
      { type: AgentEventType.Content, value: ' world' },
      {
        type: AgentEventType.Finished,
        value: { outcome: { hadVisibleOutput: true } },
      },
    ]);
  });

  describe('tool-call turns route through the generic finish path', () => {
    it('treats a pause-tool request as a normal tool-call turn', async () => {
      // Turn.run() emits only ToolCallRequest for the pause tool. The
      // orchestrator must NOT attempt pause detection — that's
      // AgenticLoop's job.
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: toolCallRequestOnlyStream(makePauseRequest()),
        blockingAfterHook: true,
      });

      const events = await collectEvents(orchestrator);

      // The generic tool-call finish path forwards blocking AfterAgent-hook
      // decisions into sendMessageStream.
      expect(deps.sendMessageStream).toHaveBeenCalledTimes(1);
      expect(
        events.some((event) => event.type === AgentEventType.ToolCallRequest),
      ).toBe(true);
      // The orchestrator never emits ToolCallResponse — Turn.run() doesn't.
      expect(
        events.some((event) => event.type === AgentEventType.ToolCallResponse),
      ).toBe(false);
    });

    it('treats a generic read_file tool-call request identically', async () => {
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: toolCallRequestOnlyStream(makeGenericToolRequest()),
        blockingAfterHook: true,
      });

      const events = await collectEvents(orchestrator);

      expect(deps.sendMessageStream).toHaveBeenCalledTimes(1);
      expect(
        events.some((event) => event.type === AgentEventType.ToolCallRequest),
      ).toBe(true);
    });

    it('does not call isSuccessfulTodoPauseResponse for tool-call turns', async () => {
      // The orchestrator no longer checks pause responses at all.
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: toolCallRequestOnlyStream(makePauseRequest()),
      });

      await collectEvents(orchestrator);

      expect(
        deps.todoContinuationService.isSuccessfulTodoPauseResponse,
      ).not.toHaveBeenCalled();
    });

    it('completes the turn without calling sendMessageStream when AfterAgent hook is non-blocking', async () => {
      // With a non-blocking AfterAgent hook (the default), the generic
      // tool-call finish path should NOT forward into sendMessageStream.
      const { orchestrator, deps } = buildOrchestrator({
        turnStream: toolCallRequestOnlyStream(makePauseRequest()),
        blockingAfterHook: false,
      });

      const events = await collectEvents(orchestrator);

      expect(deps.sendMessageStream).not.toHaveBeenCalled();
      expect(
        events.some((event) => event.type === AgentEventType.ToolCallRequest),
      ).toBe(true);
      // Still no pause detection.
      expect(
        deps.todoContinuationService.isSuccessfulTodoPauseResponse,
      ).not.toHaveBeenCalled();
    });
  });
});
