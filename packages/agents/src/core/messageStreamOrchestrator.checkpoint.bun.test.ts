/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the unified attempt checkpoint in
 * MessageStreamOrchestrator (issue #3048 review findings 2, 3, 4).
 *
 * These tests exercise the REAL LoopDetectionService and REAL
 * TodoContinuationService through the orchestrator's public `execute` loop, and
 * prove that Retry restores attempt-mutable detector/task-list state and
 * preserves response text contributed by earlier successful internal-loop
 * iterations.
 *
 * @requirement REQ-3048-007 (review findings 2, 3, 4)
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
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import { TodoContinuationService } from './TodoContinuationService.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import type { Todo } from '@vybestack/llxprt-code-tools';

const realTurnJsModule = { ...(await import('./turn.js')) };
const realLlxprtCodeToolsModule = {
  ...(await import('@vybestack/llxprt-code-tools')),
};
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

void vi.mock('@vybestack/llxprt-code-tools', () => {
  const actual = realLlxprtCodeToolsModule;
  const fakeStore = () => ({
    readTodos: vi.fn().mockResolvedValue([]),
    readPausedState: vi.fn().mockResolvedValue(false),
    writePausedState: vi.fn().mockResolvedValue(undefined),
  });
  return {
    ...actual,
    LocalTodoStore: vi.fn().mockImplementation(fakeStore),
  };
});

import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';

// --- scripted event constructors ---

function content(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Content, value: text };
}

function retryEvent(): ServerAgentStreamEvent {
  return { type: AgentEventType.Retry };
}

function thoughtEvent(): ServerAgentStreamEvent {
  const value: ThoughtSummary = {
    subject: 'planning',
    description: 'reasoning',
  };
  return { type: AgentEventType.Thought, value };
}

function finishedEvent(
  outcome?: Partial<ServerFinishedOutcome>,
): ServerAgentStreamEvent {
  const full: ServerFinishedOutcome = {
    hadVisibleOutput: outcome?.hadVisibleOutput ?? true,
    hadThinking: outcome?.hadThinking ?? false,
    hadToolCalls: outcome?.hadToolCalls ?? false,
  };
  return {
    type: AgentEventType.Finished,
    value: { reason: 'stop', outcome: full },
  };
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

function todoWriteRequest(
  callId: string,
  todos: readonly Todo[],
): ServerAgentStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name: 'todo_write',
    args: { todos: [...todos] },
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

// --- real service construction ---

function makeLoopConfig(
  toolCallThreshold: number,
  maxTurnsPerPrompt?: number,
): Config {
  return {
    getEphemeralSetting: (key: string) => {
      if (key === 'toolCallLoopThreshold') return toolCallThreshold;
      if (key === 'maxTurnsPerPrompt' && maxTurnsPerPrompt !== undefined)
        return maxTurnsPerPrompt;
      return undefined;
    },
    getMaxSessionTurns: () => 100,
    getIdeMode: () => false,
    getContinueOnFailedApiCall: () => false,
    getSettingsService: () => ({
      getCurrentProfileName: () => null,
      get: () => undefined,
    }),
    getSessionId: () => 'test-session',
  } as unknown as Config;
}

function makeRealLoopDetector(
  threshold: number,
  maxTurnsPerPrompt?: number,
): LoopDetectionService {
  return new LoopDetectionService(makeLoopConfig(threshold, maxTurnsPerPrompt));
}

function makeRealTodoContinuationService(): TodoContinuationService {
  return new TodoContinuationService({
    config: makeLoopConfig(50),
    todoReminderService: new TodoReminderService(),
    complexitySuggestionCooldown: 300000,
    todoDataDirResolver: () => '/mock/data/dir',
  });
}

interface HarnessOptions {
  streams: ReadonlyArray<readonly ServerAgentStreamEvent[]>;
  loopDetector?: LoopDetectionService;
  todoContinuationService?: TodoContinuationService;
  complexity?: {
    isComplex?: boolean;
    shouldSuggestTodos?: boolean;
  };
}

interface Harness {
  orchestrator: MessageStreamOrchestrator;
  deps: MessageStreamDeps;
  afterAgentTexts: string[];
  loopDetector: LoopDetectionService;
  todoContinuationService: TodoContinuationService;
}

function buildHarness(options: HarnessOptions): Harness {
  const afterAgentTexts: string[] = [];
  const mockChat = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextLimit: vi.fn().mockReturnValue(1_000_000),
  };

  const config = makeLoopConfig(50);

  const loopDetector = options.loopDetector ?? makeRealLoopDetector(50);
  const todoContinuationService =
    options.todoContinuationService ?? makeRealTodoContinuationService();

  // Queue of per-iteration streams. Each turn.run() call consumes one entry;
  // if more iterations run than provided, the last stream repeats.
  let queueIndex = 0;
  const streams = [...options.streams];
  mockTurnRun.mockImplementation(() => {
    const events = streams[Math.min(queueIndex, streams.length - 1)];
    queueIndex += 1;
    return streamFrom(events);
  });

  const deps: MessageStreamDeps = {
    config,
    getChat: () => mockChat as unknown as ChatSession,
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as unknown as DebugLogger,
    loopDetector,
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
        isComplex: options.complexity?.isComplex ?? false,
        detectedTasks: [],
        sequentialIndicators: [],
        questionCount: 0,
        shouldSuggestTodos: options.complexity?.shouldSuggestTodos ?? false,
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
    loopDetector,
    todoContinuationService,
  };
}

async function drain(
  orchestrator: MessageStreamOrchestrator,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of orchestrator.execute(
    [{ text: 'hi' }] as AgentMessageInput,
    new AbortController().signal,
    'prompt-1',
    1,
    false,
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

describe('MessageStreamOrchestrator — attempt checkpoint rollback (issue #3048 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----- Finding 2: loop detection transactional rollback -----

  describe('loop detection rollback (finding 2)', () => {
    /**
     * @requirement REQ-3048-007
     * @given a real LoopDetectionService with toolCallLoopThreshold=2.
     * @when an abandoned tool A is fed, then a transport Retry, then a
     *   replacement tool A (same signature).
     * @then the replacement tool A is forwarded (not rejected as a loop),
     *   because the abandoned attempt's detector state was rolled back.
     */
    it('forwards the replacement tool call after an abandoned identical one (threshold 2)', async () => {
      const loopDetector = makeRealLoopDetector(2);
      const { orchestrator } = buildHarness({
        loopDetector,
        streams: [
          [
            toolCallRequest('abandoned-a'),
            retryEvent(),
            toolCallRequest('replacement-a'),
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      const events = await drain(orchestrator);

      const loopDetected = events.some(
        (e) => e.type === AgentEventType.LoopDetected,
      );
      expect(loopDetected).toBe(false);

      const forwardedToolCalls = events.filter(
        (event) =>
          event.type === AgentEventType.ToolCallRequest &&
          event.value.callId === 'replacement-a',
      );
      expect(forwardedToolCalls).toHaveLength(1);
    });

    /**
     * @requirement REQ-3048-007
     * @given two identical tool calls in an abandoned attempt reach the detector
     *   threshold immediately before the transport Retry signal.
     * @when the replacement attempt emits the same tool once.
     * @then the pending loop verdict is discarded with the abandoned attempt and
     *   the replacement call is forwarded.
     */
    it('discards a loop verdict reached by the abandoned attempt before retry', async () => {
      const loopDetector = makeRealLoopDetector(2);
      const { orchestrator } = buildHarness({
        loopDetector,
        streams: [
          [
            toolCallRequest('abandoned-a-1'),
            toolCallRequest('abandoned-a-2'),
            retryEvent(),
            toolCallRequest('replacement-a'),
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      const events = await drain(orchestrator);

      expect(
        events.some((event) => event.type === AgentEventType.LoopDetected),
      ).toBe(false);
      expect(
        events.some(
          (event) =>
            event.type === AgentEventType.ToolCallRequest &&
            event.value.callId === 'replacement-a',
        ),
      ).toBe(true);
    });

    /**
     * @requirement REQ-3048-007
     * @given threshold 2 and the SAME detector without rollback wiring would
     *   flag the second identical tool call as a loop. This fence proves the
     *   detector still catches a genuine repeated tool call within ONE attempt.
     */
    it('still detects a genuine repeated tool call within a single attempt', async () => {
      const loopDetector = makeRealLoopDetector(2);
      const { orchestrator } = buildHarness({
        loopDetector,
        streams: [
          [
            toolCallRequest('first'),
            toolCallRequest('second'), // same signature -> 2nd -> loop
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      const events = await drain(orchestrator);

      expect(events.some((e) => e.type === AgentEventType.LoopDetected)).toBe(
        true,
      );
    });

    /**
     * @requirement REQ-3048-007
     * @scenario content detector rollback: abandoned content must not
     *   contaminate the content-chanting detector for the replacement attempt.
     */
    it('rolls back content detector state on retry', async () => {
      const loopDetector = makeRealLoopDetector(50);
      const repeatedChunk = 'A'.repeat(50);
      // Abandoned attempt emits the chunk once; replacement attempt emits it
      // only once more. Without rollback, the abandoned chunk persists in the
      // history and the second chunk could look like a repeat.
      const { orchestrator } = buildHarness({
        loopDetector,
        streams: [
          [
            content(repeatedChunk),
            retryEvent(),
            content(repeatedChunk),
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      const events = await drain(orchestrator);
      expect(events.some((e) => e.type === AgentEventType.LoopDetected)).toBe(
        false,
      );
    });
  });

  // ----- Finding 3: earlier successful internal-loop response preservation -----

  describe('response text preservation across internal iterations (finding 3)', () => {
    /**
     * @requirement REQ-3048-007
     * @given an earlier internal-loop iteration contributes text, then the loop
     *   continues; a later iteration emits abandoned text, then Retry, then
     *   replacement text.
     * @when the AfterAgent hook fires for the completed turn.
     * @then its responseText is earlier + replacement text, excluding the
     *   abandoned text.
     */
    it('preserves earlier iteration text and excludes abandoned text on AfterAgent', async () => {
      const { orchestrator, afterAgentTexts } = buildHarness({
        // Iteration 1: contributes "earlier " but is classified thinking-only
        // (Finished outcome hadVisibleOutput:false, hadThinking:true), so the
        // internal loop continues without firing AfterAgent.
        streams: [
          [
            content('earlier '),
            thoughtEvent(),
            finishedEvent({ hadVisibleOutput: false, hadThinking: true }),
          ],
          // Iteration 2: abandoned text, then transport Retry, then replacement.
          [
            content('abandoned '),
            retryEvent(),
            content('replacement'),
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      await drain(orchestrator);

      expect(afterAgentTexts).toHaveLength(1);
      expect(afterAgentTexts[0]).toBe('earlier replacement');
    });
  });

  // ----- Finding 4: TodoContinuationService transactional rollback -----

  describe('task-list continuation rollback (finding 4)', () => {
    /**
     * @requirement REQ-3048-007
     * @given a real TodoContinuationService whose complexity analysis has
     *   incremented consecutiveComplexTurns to 1 at stream-iteration entry.
     * @when an abandoned task-list write resets consecutiveComplexTurns,
     *   then Retry occurs and the replacement produces no task-list call.
     * @then consecutiveComplexTurns is restored to its pre-attempt value (1),
     *   not left at the abandoned attempt's 0.
     */
    it('restores consecutiveComplexTurns after an abandoned todo_write on retry', async () => {
      const todoContinuationService = makeRealTodoContinuationService();
      // Enable complexity tracking so the entry value is non-zero.
      todoContinuationService.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);

      const { orchestrator } = buildHarness({
        todoContinuationService,
        complexity: { isComplex: true, shouldSuggestTodos: true },
        streams: [
          [
            todoWriteRequest('abandoned-todo', [
              { id: 'abandoned', content: 'abandoned task', status: 'pending' },
            ]),
            retryEvent(),
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      await drain(orchestrator);

      // processComplexityAnalysis incremented this to 1 at entry; the
      // The abandoned task-list write reset the counter; restoration must
      // return it to the value captured at attempt entry.
      expect(todoContinuationService.consecutiveComplexTurns).toBe(1);
    });

    /**
     * @requirement REQ-3048-007
     * @scenario an abandoned task-list write must not leak its snapshot:
     *   restoration retains the snapshot captured at attempt entry.
     */
    it('does not leak the abandoned todo snapshot after rollback', async () => {
      const todoContinuationService = makeRealTodoContinuationService();
      todoContinuationService.lastTodoSnapshot = [
        { id: 'orig', content: 'original task', status: 'in_progress' },
      ];

      const { orchestrator } = buildHarness({
        todoContinuationService,
        streams: [
          [
            todoWriteRequest('abandoned-todo', [
              { id: 'abandoned', content: 'abandoned task', status: 'pending' },
            ]),
            retryEvent(),
            // End without another task-list call so the restored snapshot can
            // be observed without further mutation.
            finishedEvent(VISIBLE()),
          ],
        ],
      });

      await drain(orchestrator);

      expect(
        todoContinuationService.lastTodoSnapshot.some(
          (task) => task.id === 'abandoned',
        ),
      ).toBe(false);
    });

    /**
     * @requirement REQ-3048-007
     * @scenario reminder behavior is unaffected by the rollback: the restored
     *   lastTodoToolTurn keeps escalation logic tied to the prior value.
     */
    it('keeps reminder escalation behavior tied to the restored lastTodoToolTurn', async () => {
      const todoContinuationService = makeRealTodoContinuationService();
      todoContinuationService.consecutiveComplexTurns = 3;
      todoContinuationService.setLastTodoToolTurn(3);

      const snapshot = todoContinuationService.checkpoint();

      // Simulate an abandoned attempt mutating state.
      todoContinuationService.setLastTodoToolTurn(99);
      todoContinuationService.consecutiveComplexTurns = 1;

      todoContinuationService.restore(snapshot);

      // Three turns and three consecutive complex results satisfy the
      // escalation policy after state restoration.
      expect(todoContinuationService.shouldEscalateReminder(6)).toBe(true);
    });
  });

  // ----- Direct checkpoint/restore API contracts -----

  describe('LoopDetectionService checkpoint/restore (direct contract)', () => {
    it('snapshots and restores attempt-mutable tool-call state', () => {
      const loopDetector = makeRealLoopDetector(2);
      const toolA = {
        type: AgentEventType.ToolCallRequest,
        value: { callId: 'a', name: 'read_file', args: { file_path: '/x' } },
      };
      // Checkpoint at entry (before any event), matching the orchestrator.
      const checkpoint = loopDetector.checkpoint();
      // First identical tool call -> count 1 (no loop).
      expect(loopDetector.addAndCheck(toolA)).toBe(false);
      // Second identical -> count 2 -> loop.
      expect(loopDetector.addAndCheck(toolA)).toBe(true);
      // Restore undoes both abandoned calls back to entry state.
      loopDetector.restore(checkpoint);
      // The replacement first call is again count 1 -> no loop.
      expect(loopDetector.addAndCheck(toolA)).toBe(false);
    });

    it('preserves prompt turn counts across checkpoint/restore (maxTurnsPerPrompt=3)', async () => {
      const loopDetector = makeRealLoopDetector(50, 3);
      loopDetector.reset('prompt-X');
      // Two turns accumulate turnsInCurrentPrompt=2 (< 3 threshold).
      await loopDetector.turnStarted(new AbortController().signal);
      await loopDetector.turnStarted(new AbortController().signal);
      const checkpoint = loopDetector.checkpoint();
      // Abandoned attempt mutates attempt-scoped detector state only.
      loopDetector.addAndCheck({
        type: AgentEventType.Content,
        value: 'some content',
      });
      // Restore undoes attempt-scoped mutations but must NOT reset
      // turnsInCurrentPrompt (prompt-scoped, excluded from the snapshot). If
      // restore had cleared it to 0, the next turn would be turn 1 and return
      // false; with correct restore it is turn 3, hitting the threshold.
      loopDetector.restore(checkpoint);
      expect(await loopDetector.turnStarted(new AbortController().signal)).toBe(
        true,
      );
    });

    it('deep-copies content stats so restore removes abandoned content', () => {
      const loopDetector = makeRealLoopDetector(50);
      const unique = 'Unique distinctive paragraph number one. ';
      // Feed enough distinct content to populate the content detector.
      loopDetector.addAndCheck({
        type: AgentEventType.Content,
        value: unique.repeat(2),
      });
      const checkpoint = loopDetector.checkpoint();
      // Abandoned attempt adds different content.
      loopDetector.addAndCheck({
        type: AgentEventType.Content,
        value: 'Completely different abandoned filler content here. ',
      });
      // Restore must wipe the abandoned content so the detector only sees the
      // pre-attempt history going forward.
      loopDetector.restore(checkpoint);
      // Re-feeding the original content does not falsely amplify counts.
      const result = loopDetector.addAndCheck({
        type: AgentEventType.Content,
        value: unique,
      });
      expect(result).toBe(false);
    });
  });

  describe('TodoContinuationService checkpoint/restore (direct contract)', () => {
    it('snapshots and restores all five attempt-local fields', () => {
      const service = makeRealTodoContinuationService();
      service.consecutiveComplexTurns = 3;
      service.setLastTodoToolTurn(4);
      service.lastTodoSnapshot = [
        { id: 'orig', content: 'task', status: 'in_progress' },
      ];
      // recordModelActivity mutates these mid-attempt, so they must survive a
      // transport Retry rollback (MessageStreamOrchestrator records model
      // activity before the Retry signal clears abandoned state).
      service.toolActivityCount = 4;
      service.toolCallReminderLevel = 'base';

      const snapshot = service.checkpoint();

      // Simulate an abandoned attempt mutating every attempt-local field.
      service.consecutiveComplexTurns = 9;
      service.setLastTodoToolTurn(40);
      service.lastTodoSnapshot = [
        { id: 'gone', content: 'x', status: 'pending' },
      ];
      service.toolActivityCount = 99;
      service.toolCallReminderLevel = 'escalated';

      service.restore(snapshot);

      expect(service.consecutiveComplexTurns).toBe(3);
      expect(service.toolActivityCount).toBe(4);
      expect(service.toolCallReminderLevel).toBe('base');
      // Restored cadence and complexity counters satisfy the escalation policy.
      expect(service.shouldEscalateReminder(7)).toBe(true);
      expect(service.lastTodoSnapshot[0]?.id).toBe('orig');
    });

    it('clones the todo snapshot so restore does not alias live state', () => {
      const service = makeRealTodoContinuationService();
      service.lastTodoSnapshot = [
        { id: 'orig', content: 'task', status: 'pending' },
      ];
      const snapshot = service.checkpoint();
      service.lastTodoSnapshot = [
        { id: 'mutated', content: 'other', status: 'pending' },
      ];

      service.restore(snapshot);
      const firstRestore = service.lastTodoSnapshot;
      firstRestore[0] = {
        id: 'tampered',
        content: 'changed',
        status: 'pending',
      };
      service.restore(snapshot);

      expect(service.lastTodoSnapshot[0]?.id).toBe('orig');
    });
  });
});
