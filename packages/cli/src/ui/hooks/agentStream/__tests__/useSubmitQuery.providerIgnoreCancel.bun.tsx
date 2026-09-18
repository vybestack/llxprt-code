/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end CLI regression for issue #3236 — "Cancelled turn whose provider
 * read never settles blocks follow-up prompts."
 *
 * Composition under test (REAL engine adopted via the public agents root, one
 * controlled seam at the true provider transport boundary):
 *
 *   REAL useSubmitQuery + REAL useQueuedSubmissions + REAL useCancellation
 *     → REAL useAgentEventStream.runStream
 *       → REAL Agent facade (fromConfig adoption — public toConfigParameters
 *         + core Config, per the #3222 boundary doctrine)
 *         → REAL AgenticLoop + REAL AgentClient + REAL
 *           MessageStreamOrchestrator + REAL TodoContinuationService over a
 *           seeded on-disk task store in the isolated test data dir (the
 *           reported repro context) → REAL Turn/TurnProcessor
 *             → controlled transport seam: a provider whose turn-A call
 *               streams one content chunk, then its next read NEVER settles —
 *               and ignores the abort signal the engine hands it via
 *               options.metadata.abortSignal / options.invocation.signal.
 *               B/C turns answer cleanly.
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
import type { QueuedSubmission } from '../types.js';
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
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import { LocalTodoStore } from '@vybestack/llxprt-code-tools';
import type { Todo } from '@vybestack/llxprt-code-tools';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import type {
  GenerateChatOptions,
  IModel,
  IProvider,
  ProviderToolset,
} from '@vybestack/llxprt-code-providers';
// The agents package is consumed ONLY through its public root (#3222): the
// engine below is assembled by fromConfig adoption, never by reaching into
// package internals.
import {
  fromConfig,
  toConfigParameters,
  type Agent,
  type AgentEvent,
  type AgentInput,
} from '@vybestack/llxprt-code-agents';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// ─── Controlled transport seam (the ONLY controlled engine boundary) ────────

const PROMPT_A_CONTENT = 'A partial answer before the transport hang';
const SESSION_ID = 'issue3236-cli-session';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// LLXPRT_FAKE_RESPONSES keeps fromConfig's default provider composition
// FakeProvider-only (no real network providers, active mirror stays 'fake').
// The fixture itself is never replayed: the controlled provider below owns
// the 'fake' name before that composition runs, so its instance is never
// called. The file must merely exist and parse.
const FAKE_RESPONSES_FIXTURE = join(
  TEST_DIR,
  'fixtures',
  'providerIgnoreCancel.fake.jsonl',
);

function aiTextContent(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

/**
 * Records one prompt per agent.stream() call — the SAME observability point
 * the pre-#3222 version of this test had (its hand-written stream() wrapper
 * pushed the prompt before driving the loop). The real engine may issue
 * additional provider calls INSIDE a stream (e.g. the TodoContinuationService
 * follow-up round for the seeded in_progress item); those are engine-internal
 * and must not surface as extra prompts.
 */
function recordStreamPrompts(agent: Agent, started: string[]): Agent {
  return new Proxy(agent, {
    get(target, prop) {
      if (prop === 'stream') {
        return (
          input: AgentInput,
          ...rest: unknown[]
        ): AsyncIterable<AgentEvent> => {
          started.push(promptTextOf(input));
          return target.stream(
            input,
            ...(rest as [options?: Parameters<Agent['stream']>[1]]),
          );
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function'
        ? (value as (...fnArgs: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

function transportAbortSignal(
  options: GenerateChatOptions,
): AbortSignal | undefined {
  const fromMetadata = options.metadata?.['abortSignal'];
  if (fromMetadata instanceof AbortSignal) return fromMetadata;
  const fromInvocation = options.invocation?.signal;
  return fromInvocation instanceof AbortSignal ? fromInvocation : undefined;
}

class ControlledTransportProvider implements IProvider {
  readonly name = 'fake';
  readonly isDefault = true;
  // Satisfies ProviderManager.normalizeRuntimeInputs (baseURL-required check).
  readonly baseProviderConfig = { baseURL: 'http://fake-provider.local' };

  mode: 'turnA' | 'clean' = 'turnA';
  cleanRequests = 0;
  /** Resolves when the parked second read has registered its abort listener. */
  readonly parkedReadA = createDeferred<void>();

  private abortObserved = false;
  private readSettled = false;
  private active = 0;
  private peak = 0;

  maxConcurrent(): number {
    return this.peak;
  }

  abortObservedByProvider(): boolean {
    return this.abortObserved;
  }

  providerReadSettled(): boolean {
    return this.readSettled;
  }

  async getAuthToken(): Promise<string> {
    return 'fake-auth-token';
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: 'fake-model',
        name: 'fake-model',
        provider: 'fake',
        supportedToolFormats: ['auto'],
      },
    ];
  }

  getDefaultModel(): string {
    return 'fake-model';
  }

  getCurrentModel(): string {
    return 'fake-model';
  }

  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: ProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: GenerateChatOptions | IContent[],
    _tools?: ProviderToolset,
    _signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    const options: GenerateChatOptions = Array.isArray(optionsOrContent)
      ? { contents: optionsOrContent }
      : optionsOrContent;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        this.active -= 1;
      }
    };
    this.active += 1;
    if (this.active > this.peak) this.peak = this.active;

    if (this.mode === 'turnA') {
      try {
        yield aiTextContent(PROMPT_A_CONTENT);
        // Second read: parked forever. Observe (but ignore) the engine's own
        // abort signal — the #3236 provider-ignores-abort transport model.
        const signal = transportAbortSignal(options);
        signal?.addEventListener('abort', () => {
          this.abortObserved = true;
          // The engine abandoned this call (the turn is over for it), so the
          // transport slot is free even though the read itself never settles.
          release();
        });
        const parked = new Promise<never>(() => {});
        void parked.then(
          () => void (this.readSettled = true),
          () => void (this.readSettled = true),
        );
        this.parkedReadA.resolve();
        await parked;
      } finally {
        // Only reachable if the engine ever managed to close this read.
        this.readSettled = true;
        release();
      }
    }

    this.cleanRequests += 1;
    try {
      yield aiTextContent('clean answer');
      return;
    } finally {
      release();
    }
  }
}

// ─── Real engine construction (fromConfig adoption, public root API) ────────

interface EngineEnv {
  readonly agent: Agent;
  readonly transport: ControlledTransportProvider;
  readonly sessionId: string;
  startedPrompts(): readonly string[];
  maxConcurrent(): number;
  readonly routedEvents: AgentEvent[];
  dispose(): Promise<void>;
}

async function createEngineEnv(): Promise<EngineEnv> {
  const transport = new ControlledTransportProvider();
  const prevFakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = FAKE_RESPONSES_FIXTURE;

  const restoreEnv = (): void => {
    if (prevFakeResponses === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prevFakeResponses;
    }
  };

  let config: Config | undefined;
  let handle: IsolatedRuntimeContextHandle | undefined;
  let agent: Agent | undefined;
  try {
    const params = {
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        workingDir: TEST_DIR,
        sessionId: SESSION_ID,
      }),
    };
    config = new Config(params);
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    handle = createIsolatedRuntimeContext({
      runtimeId: SESSION_ID,
      config,
      messageBus,
      prepare: (ctx) => {
        ctx.providerManager.registerProvider(transport);
        void ctx.providerManager.setActiveProvider(transport.name);
      },
    });
    await handle.activate();
    // No explicit config.initialize() here: fromConfig installs the default
    // agent runtime factories (agentClientFactory et al.) and runs
    // ensureInitialized during adoption — the factory-less Config idiom.
    agent = await fromConfig({
      config,
      sessionId: SESSION_ID,
      messageBus,
      activation: { provider: 'fake', model: 'fake-model' },
    });

    const builtConfig = config;
    const builtHandle = handle;
    const builtAgent = agent;
    const startedPrompts: string[] = [];
    const recordingAgent = recordStreamPrompts(builtAgent, startedPrompts);
    return {
      agent: recordingAgent,
      transport,
      sessionId: builtConfig.getSessionId(),
      startedPrompts: () => startedPrompts,
      maxConcurrent: () => transport.maxConcurrent(),
      routedEvents: [],
      dispose: async (): Promise<void> => {
        await builtAgent.dispose().catch(() => undefined);
        await Promise.resolve(builtHandle.cleanup()).catch(() => undefined);
        await builtConfig.dispose().catch(() => undefined);
        restoreEnv();
      },
    };
  } catch (error) {
    await agent?.dispose().catch(() => undefined);
    if (handle !== undefined) {
      await Promise.resolve(handle.cleanup()).catch(() => undefined);
    }
    await config?.dispose().catch(() => undefined);
    restoreEnv();
    throw error;
  }
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

interface FlushGateState {
  entered: boolean;
  mode: 'turnA' | 'immediate';
}

async function flushAtTurnBoundary(
  state: FlushGateState,
  gate: Promise<void>,
): Promise<void> {
  state.entered = true;
  if (state.mode === 'turnA') await gate;
}

function capturePromptAContent(
  text: string,
  buffer: string,
  latch: { readonly resolve: () => void },
): string {
  if (text === PROMPT_A_CONTENT) latch.resolve();
  return buffer + text;
}

async function settleTurn(turnPromise: Promise<void> | null): Promise<void> {
  if (turnPromise === null) return;
  await act(async () => {
    await turnPromise;
  });
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
    const env = await createEngineEnv();
    try {
      // Reported repro context: a real active task list on disk, seeded into
      // the SAME store the real engine's TodoContinuationService reads
      // (isolated test storage roots — no user data dir is touched).
      const todoStore = new LocalTodoStore(
        env.sessionId,
        { dataDirResolver: () => Storage.getGlobalDataDir() },
        DEFAULT_AGENT_ID,
      );
      const seededTodo: Todo = {
        id: 'todo-3236-1',
        content: 'Diagnose the #3236 cancel deadlock',
        status: 'in_progress',
      };
      await todoStore.writeTodos([seededTodo]);

      const handles = createTestHandles();

      // Real CLI dep boundary: A's turn-boundary recording flush is deferred
      // so the post-done/pre-release ownership window is deterministic. The
      // latch proves A's runStream settled while the provider read is parked.
      const flushGateA = createDeferred<void>();
      const flushState: FlushGateState = {
        entered: false,
        mode: 'turnA',
      };
      const recordingIntegration = {
        flushAtTurnBoundary: async (): Promise<void> =>
          flushAtTurnBoundary(flushState, flushGateA.promise),
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
        (text: string, buffer: string) =>
          capturePromptAContent(text, buffer, contentEventALatch),
      );
      await contentEventALatch.promise;
      // ESC must land AFTER the second read parks: the transport's abort
      // listener (and thus the "provider observed abort" observation under
      // test) is registered by the parked read itself. Cancelling before the
      // park exercises the already-aborted fast path instead of the #3236
      // read-ignores-abort path.
      await env.transport.parkedReadA.promise;
      expect(handleContentEventMock).toHaveBeenCalledWith(
        PROMPT_A_CONTENT,
        '',
        expect.any(Number),
      );
      expect(env.startedPrompts()).toStrictEqual(['A']);
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
      await waitFor(() => expect(flushState.entered).toBe(true), {
        timeout: 5000,
      });
      expect(env.transport.abortObservedByProvider()).toBe(true);
      expect(env.transport.providerReadSettled()).toBe(false);
      // A's CLI lifecycle is still inside its deferred turn-boundary flush,
      // so ownership is retained: the queue must not drain.
      expect(env.startedPrompts()).toStrictEqual(['A']);

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
      expect(env.startedPrompts()).toStrictEqual(['A']);

      // 6. A's CLI lifecycle completes (flush released) → B drains exactly
      //    once. The queue may then drain C immediately after B, so mid-state
      //    snapshots are not asserted here; order, exactly-once, and
      //    serialization are proven from the final state below.
      env.transport.mode = 'clean';
      flushState.mode = 'immediate';
      await act(async () => {
        flushGateA.resolve();
      });
      await waitFor(() => expect(env.startedPrompts()).toContain('B'), {
        timeout: 5000,
      });
      expect(handles.abortControllerRef.current?.signal).not.toBe(turnASignal);
      expect(result.current.turnCancelledRef.current).toBe(false);

      // 7-8. C drains automatically after B, in order, exactly once. Final
      //      state: Idle, empty queue, never concurrent, and the provider
      //      read never settled — the CLI recovered without it.
      await waitFor(() => expect(env.startedPrompts()).toContain('C'), {
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
      expect(env.startedPrompts()).toStrictEqual(['A', 'B', 'C']);
      expect(env.maxConcurrent()).toBe(1);
      expect(env.transport.cleanRequests).toBeGreaterThanOrEqual(2);
      expect(env.transport.providerReadSettled()).toBe(false);

      await settleTurn(turnAPromiseRef.current);
      await act(async () => {
        unmount();
      });
    } finally {
      await env.dispose();
    }
  });
});
