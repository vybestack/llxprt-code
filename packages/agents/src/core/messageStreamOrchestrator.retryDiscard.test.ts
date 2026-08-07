/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for MessageStreamOrchestrator per-attempt discard on
 * AgentEventType.Retry (issue #3048, REQ-3048-007).
 *
 * When a transport retry restarts the turn mid-stream, every per-attempt
 * accumulator owned by this loop must be discarded so the AfterAgent hook,
 * post-turn flags and deferred events reflect only the successful attempt.
 *
 * @plan PLAN-20260806-ISSUE3048.P07
 * @requirement REQ-3048-007
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ServerAgentStreamEvent,
  ServerFinishedOutcome,
  ThoughtSummary,
  ToolCallRequestInfo,
} from './turn.js';
import { AgentEventType } from './turn.js';
import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';

const realTurnJsModule = { ...(await import('./turn.js')) };
const mockTurnRun = vi.fn();

void vi.mock('./turn.js', () => {
  const actual = realTurnJsModule;
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

// --- scripted event constructors (fully typed) ---

function content(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Content, value: text };
}

function citation(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Citation, value: text };
}

function retryEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.Retry };
}

function thoughtEvent(): ServerAgentStreamEvent {
  const value: ThoughtSummary = {
    subject: 'planning',
    description: 'abandoned reasoning',
  };
  return { type: AgentEventType.Thought, value };
}

function finishedEvent(
  outcome?: ServerFinishedOutcome,
): ServerAgentStreamEvent {
  return outcome
    ? { type: AgentEventType.Finished, value: { reason: 'stop', outcome } }
    : { type: AgentEventType.Finished, value: { reason: 'stop' } };
}

function invalidStreamEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.InvalidStream };
}

function toolCallRequest(callId: string): ServerAgentStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name: 'read_file',
    args: { file_path: '/tmp/x' },
    isClientInitiated: false,
    prompt_id: 'prompt-1',
  };
  return { type: AgentEventType.ToolCallRequest, value };
}

function streamFrom(
  events: readonly ServerAgentStreamEvent[],
): AsyncGenerator<ServerAgentStreamEvent> {
  return (async function* (): AsyncGenerator<ServerAgentStreamEvent> {
    for (const e of events) yield e;
  })();
}

interface BuildOptions {
  stream: readonly ServerAgentStreamEvent[];
  continueOnFailedApiCall?: boolean;
}

interface Harness {
  orchestrator: MessageStreamOrchestrator;
  deps: MessageStreamDeps;
  afterAgentTexts: string[];
}

function buildHarness(options: BuildOptions): Harness {
  const afterAgentTexts: string[] = [];

  const mockChat = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextLimit: vi.fn().mockReturnValue(1_000_000),
  };

  const config = {
    getMaxSessionTurns: vi.fn(() => 100),
    getIdeMode: vi.fn(() => false),
    getContinueOnFailedApiCall: vi.fn(
      () => options.continueOnFailedApiCall ?? false,
    ),
    getSettingsService: vi.fn(() => ({
      getCurrentProfileName: vi.fn(() => null),
      get: vi.fn(() => undefined),
    })),
  } as unknown as Config;

  mockTurnRun.mockReturnValue(streamFrom(options.stream));

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
    todoContinuationService: {
      clearPausedState: vi.fn().mockResolvedValue(undefined),
      toolActivityCount: 0,
      toolCallReminderLevel: 'none',
      consecutiveComplexTurns: 0,
      lastTodoSnapshot: [],
      recordModelActivity: vi.fn(),
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
      checkpoint: vi.fn().mockReturnValue({}),
      restore: vi.fn(),
      // Faithful to production: Finished and Citation are deferred.
      shouldDeferStreamEvent: vi.fn(
        (event: ServerAgentStreamEvent) =>
          event.type === AgentEventType.Finished ||
          event.type === AgentEventType.Citation,
      ),
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
      fireAfterAgentHookSafe: vi.fn(
        (_id: string, _promptText: string, responseText: string) => {
          afterAgentTexts.push(responseText);
          return Promise.resolve(undefined);
        },
      ),
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
        complexityScore: 0.1,
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
        /* empty recovery stream */
      },
    ),
  };

  return {
    orchestrator: new MessageStreamOrchestrator(deps),
    deps,
    afterAgentTexts,
  };
}

async function drain(
  orchestrator: MessageStreamOrchestrator,
  isInvalidStreamRetry = false,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'hi' }] as AgentMessageInput,
    new AbortController().signal,
    'prompt-1',
    1,
    isInvalidStreamRetry,
  )) {
    events.push(event);
  }
  return events;
}

const VISIBLE = (
  overrides: Partial<ServerFinishedOutcome> = {},
): ServerFinishedOutcome => ({
  hadVisibleOutput: true,
  hadThinking: false,
  hadToolCalls: false,
  ...overrides,
});

describe('MessageStreamOrchestrator — per-attempt discard on Retry (issue #3048)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes only the successful attempt text to the AfterAgent hook', async () => {
    const { orchestrator, afterAgentTexts } = buildHarness({
      stream: [
        content('abandoned '),
        retryEvent(),
        content('kept'),
        finishedEvent(VISIBLE()),
      ],
    });

    await drain(orchestrator);

    expect(afterAgentTexts).toHaveLength(1);
    expect(afterAgentTexts[0]).toBe('kept');
  });

  it('drops deferred citations from the abandoned attempt', async () => {
    const { orchestrator } = buildHarness({
      stream: [
        content('abandoned '),
        citation('abandoned-citation'),
        retryEvent(),
        content('kept'),
        finishedEvent(VISIBLE()),
      ],
    });

    const events = await drain(orchestrator);
    const citations = events.filter((e) => e.type === AgentEventType.Citation);

    expect(citations).toHaveLength(0);
    expect(
      events.some(
        (e) => e.type === AgentEventType.Content && e.value === 'kept',
      ),
    ).toBe(true);
  });

  it('reports hadContent false when the only content belonged to the abandoned attempt', async () => {
    // An InvalidStream after the retry can only trigger recovery when
    // canRetryFailedStream sees no content — i.e. the abandoned content was
    // discarded. This observes hadContent === false.
    const { orchestrator, deps } = buildHarness({
      stream: [content('abandoned'), retryEvent(), invalidStreamEvent()],
      continueOnFailedApiCall: true,
    });

    await drain(orchestrator, false);

    expect(deps.sendMessageStream).toHaveBeenCalled();
  });

  it('keeps hadToolCallsThisTurn reset to the prior value across a Retry', async () => {
    // An abandoned tool call must not leave hadToolCallsThisTurn true, which
    // would block InvalidStream recovery via canRetryFailedStream.
    const { orchestrator, deps } = buildHarness({
      stream: [
        toolCallRequest('abandoned-tool'),
        retryEvent(),
        invalidStreamEvent(),
      ],
      continueOnFailedApiCall: true,
    });

    await drain(orchestrator, false);

    expect(deps.sendMessageStream).toHaveBeenCalled();
  });

  it('still yields the Retry event to consumers before replacement content', async () => {
    const { orchestrator } = buildHarness({
      stream: [
        content('abandoned'),
        retryEvent(),
        content('kept'),
        finishedEvent(VISIBLE()),
      ],
    });

    const events = await drain(orchestrator);
    const retryIndex = events.findIndex((e) => e.type === AgentEventType.Retry);
    const keptIndex = events.findIndex(
      (e) => e.type === AgentEventType.Content && e.value === 'kept',
    );

    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(retryIndex).toBeLessThan(keptIndex);
  });

  it('does not reset finishedOutcome when discarding an abandoned attempt', async () => {
    // Fence: a Finished outcome set before the retry must survive the
    // discard. Here hadVisibleOutput stays true, so the turn ends normally
    // instead of entering the thinking-only retry loop (which would consume
    // the turn stream more than once).
    const { orchestrator } = buildHarness({
      stream: [
        finishedEvent(VISIBLE()),
        retryEvent(),
        thoughtEvent(),
        finishedEvent(),
      ],
    });

    await drain(orchestrator);

    expect(mockTurnRun).toHaveBeenCalledTimes(1);
  });
});
