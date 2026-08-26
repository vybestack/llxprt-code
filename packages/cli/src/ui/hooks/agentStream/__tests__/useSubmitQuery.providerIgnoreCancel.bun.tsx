/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end CLI regression for issue #3236 — "Cancelled turn whose provider
 * read never settles blocks follow-up prompts."
 *
 * Composition under test (real engine, one controlled seam):
 *
 *   REAL useSubmitQuery + REAL useQueuedSubmissions + REAL useCancellation
 *     → REAL useAgentEventStream.runStream
 *       → REAL createAgenticLoop + mapLoopStream (inside agent.stream)
 *         → REAL MessageStreamOrchestrator (with a REAL TodoContinuationService
 *           over a seeded on-disk task store — the reported repro context)
 *           → REAL Turn
 *             → controlled chat seam: turn A streams one content chunk, then
 *               its next provider read NEVER settles — and ignores the abort
 *               signal. B/C turns answer cleanly.
 *
 * The only deferred CLI-side boundary is `recordingIntegration
 * .flushAtTurnBoundary()` for turn A (ancillary persistence, a real injected
 * dep) so the test can deterministically observe the post-`done` window in
 * which turn A has settled but still owns `activeTurnRef`.
 *
 * Pinned behavior:
 *  - Escape cancels turn A; the REAL engine chain still terminates (the
 *    generator emits done{reason:'aborted'}; the CLI router then drops that
 *    final event via its break-on-abort in iterateAgentStream) even though
 *    A's provider read stays parked forever. The CLI-observable proof is A's
 *    turn-boundary recording flush running, NOT a routed aborted-done event;
 *  - while A still owns the turn, fresh prompt B front-enqueues via the #3169
 *    resume branch (suppression cleared, nothing starts) and C appends;
 *  - once A's CLI lifecycle finishes, B and C drain automatically, exactly
 *    once each, in order, with no concurrent turns; final state is Idle with
 *    an empty queue — and the provider read never settled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import React, { act, useRef, type Dispatch, type SetStateAction } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
// Act-aware waitFor: the plain poll in test-utils/render.js lets React state
// updates land outside act(), which floods CI output with act() warnings for
// this test's long post-release drain sequence.
import { waitFor } from '../../../../test-utils/async.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import {
  useAgentEventStream,
  type AgentEventRouter,
} from '../useAgentEventStream.js';
import { useCancellation } from '../useAgentStreamLifecycle.js';
import { useQueuedSubmissions } from '../useQueuedSubmissions.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred } from './createDeferred.js';
import {
  createLoadedSettings,
  createMockOverrides,
} from './submitQueryTestFixtures.js';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { StreamEventType } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { QueuedSubmission } from '../types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import { LocalTodoStore } from '@vybestack/llxprt-code-tools';
import type { Todo, ToolRegistry } from '@vybestack/llxprt-code-tools';
import { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import {
  ApprovalMode,
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
  clearAllSchedulers,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import type {
  Config,
  Config as AgentsConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgenticLoop,
  createToolScheduler,
  mapLoopStream,
  type Agent,
  type AgentInput,
  type AgentClientContract,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
// Engine internals come through the sanctioned low-level subpath barrel
// (@vybestack/llxprt-code-agents/internals.js), never raw cross-package
// relative paths — see the precedent in src/integration-tests/test-utils.ts.
import {
  MessageStreamOrchestrator,
  TodoContinuationService,
  type ChatSession,
  type StreamEvent,
} from '@vybestack/llxprt-code-agents/internals.js';

// ─── Module mocks (UI-side only; the engine below is real) ──────────────────

const prepareQueryForAgentMock = vi
  .fn()
  .mockImplementation(async (query: AgentRequestInput) => ({
    queryToSend: query,
    shouldProceed: true,
  }));

const handleContentEventMock = vi
  .fn()
  .mockImplementation((text: string, buffer: string) => buffer + text);

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    displayUserMessage: vi.fn(),
    prepareQueryForAgent: prepareQueryForAgentMock,
    handleLoopDetectedEvent: vi.fn(),
    handleContentEvent: handleContentEventMock,
    handleFinishedNotice: vi.fn(),
  }),
}));

void vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

void vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
  processSlashCommandResult: vi.fn(),
}));

// ─── Controlled chat seam (the ONLY controlled engine boundary) ─────────────

const PROMPT_A_CONTENT = 'A partial answer before the transport hang';
type ChunkStreamEvent = Extract<
  StreamEvent,
  { type: typeof StreamEventType.CHUNK }
>;

function chunkEvent(
  text: string,
  finishReason?: string,
): { type: typeof StreamEventType.CHUNK; value: unknown } {
  return {
    type: StreamEventType.CHUNK,
    value: {
      content: { speaker: 'ai', blocks: [{ type: 'text', text }] },
      ...(finishReason !== undefined
        ? { finishReason, rawStopReason: finishReason }
        : {}),
    },
  };
}

class ControlledChatSeam {
  mode: 'turnA' | 'clean' = 'turnA';
  private aReadCount = 0;
  private abortObserved = false;
  private readSettled = false;
  /** Resolves when the parked second read has registered its abort listener. */
  readonly parkedReadA = createDeferred<void>();
  /** The abort signal Turn hands the provider via config.abortSignal. */
  private turnAbortSignal: AbortSignal | undefined;
  cleanRequests = 0;

  abortObservedByProvider(): boolean {
    return this.abortObserved;
  }

  providerReadSettled(): boolean {
    return this.readSettled;
  }

  /** Turn shape used by Turn.openResponseStreamIterator. */
  asChatSession(config: AgentsConfig): ChatSession {
    // ChatSession is a class with private state, so it is nominally typed —
    // a structural double cannot satisfy it without this cast. Drift risk is
    // accepted here deliberately: the double feeds the REAL Turn, whose
    // runtime consumption of these three members is the contract under test.
    return {
      sendMessageStream: async (req: unknown) => {
        const reqConfig = (req as { config?: { abortSignal?: AbortSignal } })
          .config;
        this.turnAbortSignal = reqConfig?.abortSignal;
        if (this.mode === 'turnA') {
          return { [Symbol.asyncIterator]: () => this.turnAIterator() };
        }
        return { [Symbol.asyncIterator]: () => this.cleanIterator() };
      },
      getHistory: () => [],
      getConfig: () => config,
      addHistory: () => {},
    } as unknown as ChatSession;
  }

  /** #3236 transport: one chunk, then a read that parks forever and ignores abort. */
  private turnAIterator(): AsyncIterator<
    ChunkStreamEvent | { type: typeof StreamEventType.CHUNK; value: unknown }
  > {
    return {
      next: () => {
        this.aReadCount += 1;
        if (this.aReadCount === 1) {
          return Promise.resolve({
            done: false,
            value: chunkEvent(PROMPT_A_CONTENT),
          } as IteratorResult<never>);
        }
        // Second read: parked forever. Observe (but ignore) the turn's own
        // abort signal — the #3236 provider-ignores-abort transport model.
        this.turnAbortSignal?.addEventListener('abort', () => {
          this.abortObserved = true;
        });
        const parked = new Promise<IteratorResult<never>>(() => {});
        void parked.then(
          () => void (this.readSettled = true),
          () => void (this.readSettled = true),
        );
        this.parkedReadA.resolve();
        return parked;
      },
      // Cleanup is intentionally uncooperative too; closeIteratorBounded's
      // internal bound is what caps this.
      return: () => new Promise<IteratorResult<never>>(() => {}),
    };
  }

  private cleanIterator(): AsyncIterator<{
    type: typeof StreamEventType.CHUNK;
    value: unknown;
  }> {
    this.cleanRequests += 1;
    let served = false;
    return {
      next: async () => {
        if (served) return { done: true, value: undefined };
        served = true;
        return { done: false, value: chunkEvent('clean answer', 'stop') };
      },
      return: async () => ({ done: true, value: undefined }),
    };
  }
}

// ─── Real engine construction ───────────────────────────────────────────────

interface EngineEnv {
  agent: Agent;
  chat: ControlledChatSeam;
  startedPrompts: string[];
  maxConcurrent: () => number;
  routedEvents: AgentEvent[];
}

function createOrchestratorConfig(sessionId: string): AgentsConfig {
  return {
    getEphemeralSetting: () => undefined,
    getMaxSessionTurns: () => 100,
    getIdeMode: () => false,
    getContinueOnFailedApiCall: () => false,
    getSettingsService: () => ({
      getCurrentProfileName: () => null,
      get: () => undefined,
    }),
    getSessionId: () => sessionId,
  } as unknown as AgentsConfig;
}

function createEmptyToolRegistry(): ToolRegistry {
  return {
    getToolByName: () => null,
    getFunctionDeclarations: () => [],
    getTools: () => [],
    discoverTools: async () => {},
    getAllTools: () => [],
    getAllToolNames: () => [],
    getToolsByServer: () => [],
    registerTool: () => {},
    getToolByDisplayName: () => null,
    tools: new Map(),
    discovery: {},
  } as unknown as ToolRegistry;
}

function createLoopConfig(options: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
}): Config {
  const { messageBus, toolRegistry, policyEngine } = options;
  const fixture: Record<string, unknown> = {
    getSessionId: () => 'issue3236-loop',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getImagePayloadBudgetBytes: () => DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    getAllowedTools: () => [],
    getExcludeTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getModel: () => 'test-model',
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
    isInteractive: () => true,
    getNonInteractive: () => false,
    getToolSchedulerFactory: () => createToolScheduler,
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: Parameters<Config['getOrCreateScheduler']>[1],
      schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
      deps: Parameters<Config['getOrCreateScheduler']>[3],
    ) => {
      const schedulerMessageBus = deps?.messageBus;
      if (!schedulerMessageBus)
        throw new Error('Test config requires deps.messageBus');
      return getOrCreateScheduler(
        fixture as unknown as Config,
        sessionId,
        callbacks,
        schedulerOptions,
        {
          messageBus: schedulerMessageBus,
          toolRegistry: deps.toolRegistry ?? toolRegistry,
        },
      );
    },
    disposeScheduler: (sessionId: string) => disposeScheduler(sessionId),
  };
  return fixture as unknown as Config;
}

function createEngineEnv(options: {
  sessionId: string;
  todoDataDir: string;
}): EngineEnv {
  const chat = new ControlledChatSeam();
  const orchestratorConfig = createOrchestratorConfig(options.sessionId);
  const chatSession = chat.asChatSession(orchestratorConfig);

  const orchestrator = new MessageStreamOrchestrator({
    config: orchestratorConfig,
    getChat: () => chatSession,
    logger: new DebugLogger('issue3236:providerIgnoreCancel'),
    loopDetector: new LoopDetectionService(orchestratorConfig),
    todoContinuationService: new TodoContinuationService({
      config: orchestratorConfig,
      todoReminderService: new TodoReminderService(),
      complexitySuggestionCooldown: 300000,
      todoDataDirResolver: () => options.todoDataDir,
    }),
    ideContextTracker: {
      getContextParts: () => ({ contextParts: [], newIdeContext: undefined }),
      recordSentContext: () => {},
    } as never,
    agentHookManager: {
      cleanupOldHookState: () => {},
      fireBeforeAgentHookSafe: async () => undefined,
      fireAfterAgentHookSafe: async () => undefined,
    } as never,
    getEffectiveModelIdentity: () => ({
      providerName: 'test',
      model: 'test-model',
    }),
    getHistory: async () => [],
    getSessionTurnCount: () => 1,
    incrementSessionTurnCount: () => {},
    lazyInitialize: async () => {},
    startChat: async () => {
      throw new Error('startChat must not run');
    },
    getPreviousHistory: () => undefined,
    setChat: () => {},
    hasChat: () => true,
    complexityAnalyzer: new ComplexityAnalyzer(),
    getLastPromptId: () => undefined,
    setLastPromptId: () => {},
    resetCurrentSequenceModel: () => {},
    updateTelemetryTokenCount: () => {},
    async *sendMessageStream(): AsyncGenerator<never> {},
  });

  const agentClient = {
    async initialize() {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chatSession,
    async getHistory() {
      return [];
    },
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    storeHistoryForLaterUse: () => {},
    addHistory: async () => {},
    async *sendMessageStream(
      req: AgentRequestInput,
      signal: AbortSignal,
      promptId: string,
    ): AsyncGenerator<unknown> {
      yield* orchestrator.execute(req, signal, promptId, 25, false);
    },
  } as unknown as AgentClientContract;

  const policyEngine = new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
  const messageBus = new MessageBus(policyEngine, false);
  const loopConfig = createLoopConfig({
    messageBus,
    toolRegistry: createEmptyToolRegistry(),
    policyEngine,
  });

  const startedPrompts: string[] = [];
  let active = 0;
  let maxConcurrent = 0;
  const agent = {
    async chat() {
      return { text: '', toolCalls: [], finishReason: 'stop' };
    },
    async *stream(
      input: AgentInput,
      streamOpts?: {
        readonly signal?: AbortSignal;
        readonly promptId?: string;
      },
    ): AsyncIterable<AgentEvent> {
      const prompt = promptTextOf(input);
      startedPrompts.push(prompt);
      active += 1;
      if (active > maxConcurrent) maxConcurrent = active;
      try {
        const loop = createAgenticLoop({
          agentClient,
          config: loopConfig,
          messageBus,
          interactiveMode: true,
          displayCallbacks: {},
        });
        yield* mapLoopStream(
          loop.run(
            input as never,
            streamOpts?.signal ?? new AbortController().signal,
            streamOpts?.promptId ?? 'issue3236',
          ),
        );
      } finally {
        active -= 1;
      }
    },
    getProvider: () => 'test',
    async setProvider() {
      return {
        changed: false,
        previousProvider: 'test',
        nextProvider: 'test',
        infoMessages: [],
      };
    },
    getProviderStatus: () => ({
      provider: 'test',
      model: 'test-model',
      authStatus: 'authenticated',
    }),
    getModel: () => 'test-model',
    async setModel() {},
    getCurrentSequenceModel: () => null,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    setApprovalMode: () => {},
    getRuntimeId: () => 'issue3236-agent',
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getEphemeralSettings: () => ({}),
    getModelParams: () => ({}),
    setModelParam: () => {},
    clearModelParam: () => {},
    tools: {
      list: () => [],
      get: () => undefined,
      async setEnabled() {},
      onConfirmationRequest: () => () => {},
      respondToConfirmation: () => {},
      onToolUpdate: () => () => {},
      setEditorCallbacks: () => {},
      setDisplayCallbacks: () => {},
      recordCompletedToolCalls: () => {},
    },
    async getHistory() {
      return [];
    },
    async setHistory() {},
    async addHistory() {},
    async restoreHistory() {},
    async resetChat() {},
    async updateSystemInstruction() {},
    async addDirectoryContext() {},
    async compress() {
      return { status: 'skipped' };
    },
    getStats: () => ({
      promptTokens: 0,
      candidateTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
      turnCount: 0,
    }),
    onStats: () => () => {},
    async generate() {
      return '';
    },
    async generateJson() {
      return {};
    },
    async generateEmbedding() {
      return [];
    },
    listProviders: () => [],
    listTools: () => [],
    async dispose() {},
  } as unknown as Agent;

  return {
    agent,
    chat,
    startedPrompts,
    maxConcurrent: () => maxConcurrent,
    routedEvents: [],
  };
}

// ─── Render harness (REAL queue store + REAL event-stream runner) ───────────

function createMockSetState(
  calls: boolean[],
): Dispatch<SetStateAction<boolean>> {
  return (value) => {
    if (typeof value === 'boolean') calls.push(value);
  };
}

interface TestHandles {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  addItem: ReturnType<typeof vi.fn>;
  flushPendingHistoryItem: ReturnType<typeof vi.fn>;
  setPendingHistoryItem: ReturnType<typeof vi.fn>;
  setLastAgentActivityTime: ReturnType<typeof vi.fn>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
}

function createTestHandles(): TestHandles {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding: createMockSetState(setIsRespondingCalls),
    abortControllerRef: { current: null },
    addItem: vi.fn().mockReturnValue(1),
    flushPendingHistoryItem: vi.fn(),
    setPendingHistoryItem: vi.fn(),
    setLastAgentActivityTime: vi.fn(),
    pendingHistoryItemRef: { current: null },
  };
}

function renderHarness(options: {
  env: EngineEnv;
  handles: TestHandles;
  recordingIntegration: RecordingIntegration;
}) {
  const { env, handles } = options;
  const turnCancelledRef: React.MutableRefObject<boolean> = { current: false };
  const drainSuppressedRef: React.MutableRefObject<boolean> = {
    current: false,
  };

  const hook = renderHook(
    ({ streamingState }: { streamingState: StreamingState }) => {
      const queue = useQueuedSubmissions();
      const processAgentEventRef = useRef<AgentEventRouter | null>(null);
      const eventStream = useAgentEventStream({
        agent: env.agent,
        addItem: handles.addItem,
        processAgentEventRef,
        flushPendingHistoryItem: handles.flushPendingHistoryItem,
        clearPendingHistoryItem: vi.fn(),
        performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
        markToolsAsDisplayCleared: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        outputUpdateHandler: vi.fn(),
        getPreferredEditor: vi.fn(),
        onEditorOpen: vi.fn(),
        onEditorClose: vi.fn(),
      });
      const runStreamRef = useRef(eventStream.runStream);
      runStreamRef.current = eventStream.runStream;

      const submitDeps: UseSubmitQueryDeps = {
        runtime: createStreamRuntimeForTest({}, createMockOverrides()),
        agent: env.agent,
        addItem: handles.addItem,
        removeItems: vi.fn(),
        settings: createLoadedSettings(),
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        onAuthError: vi.fn(),
        recordingIntegration: options.recordingIntegration,
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: handles.flushPendingHistoryItem,
        pendingResponse: new PendingResponseBuffer(undefined),
        pendingHistoryItemRef: handles.pendingHistoryItemRef,
        thinkingBlocksRef: { current: [] },
        turnCancelledRef,
        setTurnCancelled: (v: boolean) => void (turnCancelledRef.current = v),
        drainSuppressedRef,
        queuedSubmissionsRef: queue.queuedSubmissionsRef,
        enqueueSubmission: queue.enqueueSubmission,
        enqueueSubmissionFirst: queue.enqueueSubmissionFirst,
        requeueSubmission: queue.requeueSubmission,
        dequeueSubmission: queue.dequeueSubmission,
        clearSubmissions: queue.clearSubmissions,
        tryReserveDrain: queue.tryReserveDrain,
        releaseDrain: queue.releaseDrain,
        setPendingHistoryItem: handles.setPendingHistoryItem,
        setIsResponding: handles.setIsResponding,
        setInitError: vi.fn(),
        setThought: vi.fn(),
        setLastAgentActivityTime: handles.setLastAgentActivityTime,
        scheduleToolCalls: vi.fn(),
        abortActiveStream: vi.fn(),
        handleShellCommand: vi.fn().mockReturnValue(false),
        handleSlashCommand: vi.fn().mockResolvedValue(false),
        logger: null,
        shellModeActive: false,
        loopDetectedRef: { current: false },
        lastProfileNameRef: { current: undefined },
        lastModelInfoRef: { current: null },
        lastModelIdentityRef: { current: null },
        abortControllerRef: handles.abortControllerRef,
        runStreamRef,
        submitQueryRef: { current: null },
        isResponding: false,
        streamingState,
      };

      const submission = useSubmitQuery(submitDeps);
      const cancellation = useCancellation(
        streamingState,
        turnCancelledRef,
        (v: boolean) => void (turnCancelledRef.current = v),
        handles.abortControllerRef,
        vi.fn(),
        handles.pendingHistoryItemRef,
        handles.flushPendingHistoryItem,
        handles.addItem,
        handles.setPendingHistoryItem,
        vi.fn(),
        handles.setIsResponding,
        vi.fn(),
        drainSuppressedRef,
      );
      processAgentEventRef.current = (event, timestamp, signal) => {
        env.routedEvents.push(event);
        submission.processAgentEvent(event, timestamp, signal);
      };
      return {
        ...submission,
        ...cancellation,
        queue,
        turnCancelledRef,
        drainSuppressedRef,
      };
    },
    {
      initialProps: { streamingState: StreamingState.Idle },
      wrapper: ({ children }: React.PropsWithChildren) => (
        <KeypressProvider>{children}</KeypressProvider>
      ),
    },
  );
  return { ...hook, turnCancelledRef, drainSuppressedRef };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function promptTextOf(input: AgentInput | QueuedSubmission['query']): string {
  if (typeof input === 'string') {
    return input;
  }
  if (Array.isArray(input)) {
    const first = input[0] as { text?: unknown } | undefined;
    if (first !== undefined && 'text' in first) {
      return String(first.text);
    }
  }
  return '';
}

function queueTexts(queue: ReturnType<typeof useQueuedSubmissions>): string[] {
  return queue.queuedSubmissionsRef.current.map((s) => promptTextOf(s.query));
}

function stopDoneCount(events: AgentEvent[]): number {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'done' }> =>
      e.type === 'done' && e.reason === 'stop',
  ).length;
}

// ─── Test ───────────────────────────────────────────────────────────────────

describe('useSubmitQuery — cancelled turn whose provider read never settles (issue #3236)', () => {
  beforeEach(() => {
    // Module-level mock call histories must not leak between tests, or a
    // second test's waitFor(...).toHaveBeenCalledWith gates would pass
    // vacuously on stale history (sibling useAgentEventStream.bun.tsx
    // convention).
    vi.clearAllMocks();
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('ends turn A via the abort race, then drains B and C exactly once, in order', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'issue3236-todos-'));
    const sessionId = 'issue3236-cli-session';
    try {
      // Reported repro context: a real active task list on disk.
      const todoStore = new LocalTodoStore(
        sessionId,
        { dataDirResolver: () => dataDir },
        DEFAULT_AGENT_ID,
      );
      const seededTodo: Todo = {
        id: 'todo-3236-1',
        content: 'Diagnose the #3236 cancel deadlock',
        status: 'in_progress',
      };
      await todoStore.writeTodos([seededTodo]);

      const env = createEngineEnv({ sessionId, todoDataDir: dataDir });
      const handles = createTestHandles();

      // Real CLI dep boundary: A's turn-boundary recording flush is deferred
      // so the post-done/pre-release ownership window is deterministic. The
      // latch proves A's runStream settled while the provider read is parked.
      const flushGateA = createDeferred<void>();
      let flushEntered = false;
      let flushMode: 'turnA' | 'immediate' = 'turnA';
      const recordingIntegration = {
        flushAtTurnBoundary: async (): Promise<void> => {
          flushEntered = true;
          if (flushMode === 'turnA') await flushGateA.promise;
        },
      } as unknown as RecordingIntegration;

      const { result, rerender, unmount } = renderHarness({
        env,
        handles,
        recordingIntegration,
      });

      // 1. Prompt A starts through the real submit path and real engine; its
      //    stream emits one content event, then the provider read parks.
      const turnAPromiseRef: { current: Promise<void> | null } = {
        current: null,
      };
      act(() => {
        turnAPromiseRef.current = result.current.submitQuery('A');
      });
      // Promise-based latch instead of a polling waitFor: resolves the
      // first time the real chain routes A's content event, so the wait is
      // driven by the event itself (no timer drift; a broken chain fails
      // fast at the test runner's per-test deadline instead).
      const contentEventALatch = createDeferred<void>();
      handleContentEventMock.mockImplementation(
        (text: string, buffer: string) => {
          if (text === PROMPT_A_CONTENT) contentEventALatch.resolve();
          return buffer + text;
        },
      );
      await contentEventALatch.promise;
      // ESC must land AFTER the second read parks: the seam's abort listener
      // (and thus the "provider observed abort" observation under test) is
      // registered by the parked read itself. Cancelling before the park
      // exercises the already-aborted fast path instead of the #3236
      // read-ignores-abort path.
      await env.chat.parkedReadA.promise;
      expect(handleContentEventMock).toHaveBeenCalledWith(
        PROMPT_A_CONTENT,
        '',
        expect.any(Number),
      );
      expect(env.startedPrompts).toStrictEqual(['A']);
      rerender({ streamingState: StreamingState.Responding });

      // 2. Escape through the real useCancellation path.
      const turnASignal = handles.abortControllerRef.current?.signal;
      await act(async () => {
        result.current.cancelOngoingRequest();
      });
      expect(result.current.turnCancelledRef.current).toBe(true);
      expect(result.current.drainSuppressedRef.current).toBe(true);
      expect(turnASignal?.aborted).toBe(true);

      // 3. THE #3236 invariant: the real chain terminates on abort even
      //    though the provider read stays parked and the provider observed
      //    (and ignored) the abort. iterateAgentStream drops the aborted
      //    turn's final done event (break-on-abort), so the CLI-observable
      //    proof is A's lifecycle reaching its real turn-boundary flush.
      await waitFor(() => expect(flushEntered).toBe(true), { timeout: 5000 });
      expect(env.chat.abortObservedByProvider()).toBe(true);
      expect(env.chat.providerReadSettled()).toBe(false);
      // A's CLI lifecycle is still inside its deferred turn-boundary flush,
      // so ownership is retained: the queue must not drain.
      expect(env.startedPrompts).toStrictEqual(['A']);

      // 4. Fresh prompt B while A still owns the turn: #3169 resume branch
      //    front-enqueues it and releases suppression; nothing starts.
      rerender({ streamingState: StreamingState.Idle });
      await act(async () => {
        await result.current.submitQuery('B');
      });
      expect(result.current.drainSuppressedRef.current).toBe(false);
      expect(queueTexts(result.current.queue)).toStrictEqual(['B']);

      // 5. Fresh prompt C appends behind B; still nothing starts.
      await act(async () => {
        await result.current.submitQuery('C');
      });
      expect(queueTexts(result.current.queue)).toStrictEqual(['B', 'C']);
      expect(env.startedPrompts).toStrictEqual(['A']);

      // 6. A's CLI lifecycle completes (flush released) → B drains exactly
      //    once. The queue may then drain C immediately after B, so mid-state
      //    snapshots are not asserted here; order, exactly-once, and
      //    serialization are proven from the final state below.
      env.chat.mode = 'clean';
      flushMode = 'immediate';
      await act(async () => {
        flushGateA.resolve();
      });
      await waitFor(() => expect(env.startedPrompts).toContain('B'), {
        timeout: 5000,
      });
      expect(handles.abortControllerRef.current?.signal).not.toBe(turnASignal);
      expect(result.current.turnCancelledRef.current).toBe(false);

      // 7-8. C drains automatically after B, in order, exactly once. Final
      //      state: Idle, empty queue, never concurrent, and the provider
      //      read never settled — the CLI recovered without it.
      await waitFor(() => expect(env.startedPrompts).toContain('C'), {
        timeout: 5000,
      });
      await waitFor(
        () => expect(stopDoneCount(env.routedEvents)).toBeGreaterThanOrEqual(2),
        { timeout: 5000 },
      );
      await waitFor(
        () => expect(queueTexts(result.current.queue)).toStrictEqual([]),
        { timeout: 5000 },
      );
      // "Final state is Idle": the real lifecycle's last responding
      // transition must have settled back to false after the C drain.
      const respondingTransitions = handles.setIsRespondingCalls;
      expect(respondingTransitions[respondingTransitions.length - 1]).toBe(
        false,
      );
      expect(env.startedPrompts).toStrictEqual(['A', 'B', 'C']);
      expect(env.maxConcurrent()).toBe(1);
      expect(env.chat.cleanRequests).toBeGreaterThanOrEqual(2);
      expect(env.chat.providerReadSettled()).toBe(false);

      const turnAPromise = turnAPromiseRef.current;
      if (turnAPromise !== null) {
        await act(async () => {
          await turnAPromise;
        });
      }
      await act(async () => {
        unmount();
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
