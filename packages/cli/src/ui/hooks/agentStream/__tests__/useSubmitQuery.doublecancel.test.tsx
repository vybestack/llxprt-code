/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2259: "double cancellation still an issue."
 *
 * When a user cancels a turn (ESC) and then submits a new prompt, the
 * cancelled turn's stale `runSubmitQueryCore` finally block must NOT call
 * `setIsResponding(false)` — that would clobber the new turn's
 * `isResponding(true)` state, making the new turn appear cancelled.
 *
 * The fix: `runSubmitQueryCore`'s finally, catch, recordingIntegration, and
 * `executeStream`'s post-runLoop logic all compare the turn's AbortSignal
 * against the current `abortControllerRef.current?.signal`. If they differ,
 * a newer turn has superseded this one and the stale turn must not mutate
 * shared React state.
 */

import { describe, it, expect, vi } from 'vitest';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { useCancellation } from '../useAgentStreamLifecycle.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import {
  Config,
  type AgentClientContract,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import {
  buildUiRuntimeFromSource,
  type StreamRuntime,
} from '../../../cliUiRuntime.js';
import { AppEvent, appEvents } from '../../../../utils/events.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

// ─── Module mocks ───────────────────────────────────────────────────────────
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
// useSubmitQuery internally calls useStreamEventHandlers and useSessionStats.
// We stub them so the test can isolate the turn-lifecycle / finally logic.

vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    displayUserMessage: vi.fn(),
    prepareQueryForAgent: vi
      .fn()
      .mockResolvedValue({ queryToSend: 'test-query', shouldProceed: true }),
    handleLoopDetectedEvent: vi.fn(),
  }),
}));

vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

// Mock streamUtils so we can assert whether handleSubmissionError is called.
const handleSubmissionErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: handleSubmissionErrorMock,
  processSlashCommandResult: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createQueueOperations(ref: { current: QueuedSubmission[] }) {
  return {
    enqueueSubmission: (submission: QueuedSubmission) => {
      ref.current = [...ref.current, submission];
    },
    requeueSubmission: (submission: QueuedSubmission) => {
      ref.current = [submission, ...ref.current];
    },
    dequeueSubmission: (): QueuedSubmission | undefined => {
      const [first, ...rest] = ref.current;
      ref.current = rest;
      return first;
    },
    clearSubmissions: () => {
      ref.current = [];
    },
  };
}

function createMockOverrides() {
  return {
    session: { getSessionId: () => 'test-session' },
    model: {
      getModel: () => 'test-model',
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
    },
    mcp: {
      getMcpClientManager: () => undefined,
      getMcpServers: () => ({}),
    },
    asyncTasks: {
      setupAsyncTaskAutoTrigger: () => () => {},
    },
  };
}

function createMockAgentClient(): AgentClientContract {
  return {
    getCurrentSequenceModel: () => 'test-model',
    getChat: () =>
      ({
        recordCompletedToolCalls: vi.fn(),
      }) as never,
  } as unknown as AgentClientContract;
}

function createMockSetState(
  calls: boolean[],
): Dispatch<SetStateAction<boolean>> {
  return vi.fn((value: SetStateAction<boolean>) => {
    if (typeof value === 'boolean') calls.push(value);
  }) as unknown as Dispatch<SetStateAction<boolean>>;
}

interface DoubleCancelDeps {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: React.MutableRefObject<
    | ((
        message: unknown,
        signal: AbortSignal,
        promptId: string,
      ) => Promise<void>)
    | null
  >;
  loopDetectedRef: React.MutableRefObject<boolean>;
  handleLoopDetectedEvent: ReturnType<typeof vi.fn>;
  flushAtTurnBoundarySpy: ReturnType<typeof vi.fn>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  flushPendingHistoryItem: ReturnType<typeof vi.fn>;
  setPendingHistoryItem: ReturnType<typeof vi.fn>;
}

function createDeps(
  options?: Partial<
    DoubleCancelDeps & { recordingIntegration: RecordingIntegration }
  >,
): DoubleCancelDeps {
  const setIsRespondingCalls: boolean[] = [];
  const deps: DoubleCancelDeps = {
    setIsRespondingCalls,
    setIsResponding:
      options?.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef:
      options?.abortControllerRef ??
      ({ current: null as AbortController | null } as never),
    runStreamRef: options?.runStreamRef ?? ({ current: null } as never),
    loopDetectedRef: options?.loopDetectedRef ?? ({ current: false } as never),
    handleLoopDetectedEvent: options?.handleLoopDetectedEvent ?? vi.fn(),
    flushAtTurnBoundarySpy: vi.fn(),
    pendingHistoryItemRef:
      options?.pendingHistoryItemRef ??
      ({
        current: null,
      } as React.MutableRefObject<HistoryItemWithoutId | null>),
    flushPendingHistoryItem: options?.flushPendingHistoryItem ?? vi.fn(),
    setPendingHistoryItem: options?.setPendingHistoryItem ?? vi.fn(),
  };
  return deps;
}

/**
 * Renders `useSubmitQuery` with stubbed deps. All shared mutable state (refs,
 * setIsResponding spy) is returned so individual tests can drive the lifecycle.
 */
function renderUseSubmitQuery(
  deps: DoubleCancelDeps,
  overrides?: {
    streamingState?: StreamingState;
    recordingIntegration?: RecordingIntegration;
    runtime?: StreamRuntime;
    queuedSubmissionsRef?: React.MutableRefObject<QueuedSubmission[]>;
    queueOperations?: ReturnType<typeof createQueueOperations>;
    tryReserveDrain?: () => boolean;
    releaseDrain?: () => void;
    addItem?: UseSubmitQueryDeps['addItem'];
  },
) {
  const addItem = overrides?.addItem ?? vi.fn().mockReturnValue(1);
  return renderHook(() =>
    useSubmitQuery({
      runtime:
        overrides?.runtime ??
        createStreamRuntimeForTest({}, createMockOverrides()),
      agent: createMockAgentClient() as unknown as Agent,
      addItem,
      settings: {} as never,
      onDebugMessage: vi.fn(),
      onCancelSubmit: vi.fn(),
      onAuthError: vi.fn(),
      sanitizeContent: (text: string) => ({ text, blocked: false }),
      flushPendingHistoryItem: deps.flushPendingHistoryItem,
      pendingHistoryItemRef: deps.pendingHistoryItemRef,
      thinkingBlocksRef: { current: [] },
      turnCancelledRef: { current: false },
      queuedSubmissionsRef: overrides?.queuedSubmissionsRef ?? { current: [] },
      enqueueSubmission:
        overrides?.queueOperations?.enqueueSubmission ?? vi.fn(),
      requeueSubmission:
        overrides?.queueOperations?.requeueSubmission ?? vi.fn(),
      dequeueSubmission:
        overrides?.queueOperations?.dequeueSubmission ?? vi.fn(),
      clearSubmissions: overrides?.queueOperations?.clearSubmissions ?? vi.fn(),
      tryReserveDrain:
        overrides?.tryReserveDrain ?? vi.fn().mockReturnValue(true),
      releaseDrain: overrides?.releaseDrain ?? vi.fn(),
      setPendingHistoryItem: deps.setPendingHistoryItem,
      setIsResponding: deps.setIsResponding,
      setInitError: vi.fn(),
      setThought: vi.fn(),
      setLastAgentActivityTime: vi.fn(),
      scheduleToolCalls: vi.fn(),
      abortActiveStream: vi.fn(),
      handleShellCommand: vi.fn().mockReturnValue(false),
      handleSlashCommand: vi.fn().mockResolvedValue(false),
      logger: null,
      shellModeActive: false,
      loopDetectedRef: deps.loopDetectedRef,
      lastProfileNameRef: { current: undefined },
      lastModelInfoRef: { current: null },
      lastModelIdentityRef: { current: null },
      abortControllerRef: deps.abortControllerRef,
      runStreamRef: deps.runStreamRef,
      submitQueryRef: { current: null },
      isResponding: false,
      streamingState: overrides?.streamingState ?? StreamingState.Idle,
      recordingIntegration:
        overrides?.recordingIntegration ??
        ({
          flushAtTurnBoundary: deps.flushAtTurnBoundarySpy,
        } as unknown as RecordingIntegration),
    }),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — double-cancel guard (issue #2259)', () => {
  it('keeps direct turn ownership while cancelled work settles and serializes the next direct submission', async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();
    const runStreamFn = vi
      .fn()
      .mockReturnValueOnce(turn1Deferred.promise)
      .mockReturnValueOnce(turn2Deferred.promise);
    const deps = createDeps({
      runStreamRef: { current: runStreamFn } as never,
    });
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queue = createQueueOperations(queuedSubmissionsRef);
    const turnCancelledRef = { current: false };
    let drainReserved = false;

    const { result, rerender } = renderHook(
      ({ streamingState }: { streamingState: StreamingState }) =>
        useSubmitQuery({
          runtime: createStreamRuntimeForTest({}, createMockOverrides()),
          agent: createMockAgentClient() as unknown as Agent,
          addItem: vi.fn().mockReturnValue(1),
          settings: {} as never,
          onDebugMessage: vi.fn(),
          onCancelSubmit: vi.fn(),
          onAuthError: vi.fn(),
          sanitizeContent: (text: string) => ({ text, blocked: false }),
          flushPendingHistoryItem: deps.flushPendingHistoryItem,
          pendingHistoryItemRef: deps.pendingHistoryItemRef,
          thinkingBlocksRef: { current: [] },
          turnCancelledRef,
          queuedSubmissionsRef,
          ...queue,
          tryReserveDrain: () => {
            if (drainReserved) return false;
            drainReserved = true;
            return true;
          },
          releaseDrain: () => {
            drainReserved = false;
          },
          setPendingHistoryItem: deps.setPendingHistoryItem,
          setIsResponding: deps.setIsResponding,
          setInitError: vi.fn(),
          setThought: vi.fn(),
          setLastAgentActivityTime: vi.fn(),
          scheduleToolCalls: vi.fn(),
          abortActiveStream: vi.fn(),
          handleShellCommand: vi.fn().mockReturnValue(false),
          handleSlashCommand: vi.fn().mockResolvedValue(false),
          logger: null,
          shellModeActive: false,
          loopDetectedRef: deps.loopDetectedRef,
          lastProfileNameRef: { current: undefined },
          lastModelInfoRef: { current: null },
          lastModelIdentityRef: { current: null },
          abortControllerRef: deps.abortControllerRef,
          runStreamRef: deps.runStreamRef,
          submitQueryRef: { current: null },
          isResponding: false,
          streamingState,
        }),
      { initialProps: { streamingState: StreamingState.Idle } },
    );

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() => expect(runStreamFn).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.submitQuery('turn-2');
    });
    expect(
      queuedSubmissionsRef.current.map((item) => item.query),
    ).toStrictEqual(['turn-2']);

    deps.abortControllerRef.current?.abort();
    rerender({ streamingState: StreamingState.Idle });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runStreamFn).toHaveBeenCalledTimes(1);
    expect(queuedSubmissionsRef.current).toHaveLength(1);

    await act(async () => {
      turn1Deferred.resolve();
      await turn1Promise;
    });
    expect(queuedSubmissionsRef.current).toHaveLength(0);

    await act(async () => {
      turn2Deferred.resolve();
    });
  });

  it('retries a non-string MCP-blocked submission from the Config app emitter', async () => {
    let discoveryState = MCPDiscoveryState.IN_PROGRESS;
    const config = new Config({
      sessionId: 'mcp-event-test',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
      mcpServers: { server: { command: 'unused' } },
      eventEmitter: appEvents,
    });
    vi.spyOn(config, 'getMcpClientManager').mockReturnValue({
      getDiscoveryState: () => discoveryState,
      getMcpServerCount: () => 1,
      restartServer: vi.fn(),
    } as never);
    const runtime = buildUiRuntimeFromSource(config);
    const runStream = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ runStreamRef: { current: runStream } as never });
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const addItem = vi.fn().mockReturnValue(1);
    let drainReserved = false;
    const { result, unmount } = renderUseSubmitQuery(deps, {
      runtime,
      queuedSubmissionsRef,
      queueOperations,
      addItem,
      tryReserveDrain: () => {
        if (drainReserved) return false;
        drainReserved = true;
        return true;
      },
      releaseDrain: () => {
        drainReserved = false;
      },
    });

    const nonStringQuery = [{ type: 'text' as const, text: 'wait for mcp' }];
    await act(async () => {
      await result.current.submitQuery(nonStringQuery);
    });
    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(queuedSubmissionsRef.current[0].query).toStrictEqual(nonStringQuery);
    expect(runStream).not.toHaveBeenCalled();
    expect(addItem).toHaveBeenCalledTimes(1);

    act(() => {
      appEvents.emit(AppEvent.McpClientUpdate, new Map());
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(runStream).not.toHaveBeenCalled();
    expect(addItem).toHaveBeenCalledTimes(1);

    discoveryState = MCPDiscoveryState.COMPLETED;
    act(() => {
      appEvents.emit(AppEvent.McpClientUpdate, new Map());
    });

    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(1));
    unmount();
  });

  it('requeues an in-flight drained submission exactly once when unmounted', async () => {
    const runDeferred = createDeferred<void>();
    const runStream = vi.fn(() => runDeferred.promise);
    const deps = createDeps({ runStreamRef: { current: runStream } as never });
    const queuedSubmission: QueuedSubmission = { query: 'survive unmount' };
    const queuedSubmissionsRef = { current: [queuedSubmission] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    let drainReserved = false;
    let releases = 0;
    const { unmount } = renderUseSubmitQuery(deps, {
      queuedSubmissionsRef,
      queueOperations,
      tryReserveDrain: () => {
        if (drainReserved) return false;
        drainReserved = true;
        return true;
      },
      releaseDrain: () => {
        releases += 1;
        drainReserved = false;
      },
    });

    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(1));
    unmount();
    expect(queuedSubmissionsRef.current).toStrictEqual([queuedSubmission]);
    expect(releases).toBe(1);

    runDeferred.resolve();
    await runDeferred.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queuedSubmissionsRef.current).toStrictEqual([queuedSubmission]);
    expect(releases).toBe(1);
  });
  it('queues the second prompt when streamingState is Responding, then drains after cancel', async () => {
    // This test exercises the production isQueueable gate:
    // When streamingState is Responding, submitQuery pushes the query to
    // queuedSubmissionsRef instead of starting immediately. After the first
    // turn settles and streamingState returns to Idle, the idle-queue-drain
    // effect fires the queued submission.
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runStreamRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const queuedSubmissionsRef = {
      current: [] as QueuedSubmission[],
    };

    // Provide real enqueue/dequeue/clear implementations backed by the ref
    // so the test can observe queue state through the new immutable API.
    const {
      enqueueSubmission,
      requeueSubmission,
      dequeueSubmission,
      clearSubmissions,
    } = createQueueOperations(queuedSubmissionsRef);
    const tryReserveDrain = vi.fn().mockReturnValue(true);
    const releaseDrain = vi.fn();
    const turnCancelledRef = { current: false };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KeypressProvider>{children}</KeypressProvider>
    );

    const { result, rerender } = renderHook(
      ({ streamingState }: { streamingState: StreamingState }) => {
        const submission = useSubmitQuery({
          runtime: createStreamRuntimeForTest({}, createMockOverrides()),
          agent: createMockAgentClient() as unknown as Agent,
          addItem: vi.fn().mockReturnValue(1),
          settings: {} as never,
          onDebugMessage: vi.fn(),
          onCancelSubmit: vi.fn(),
          onAuthError: vi.fn(),
          sanitizeContent: (text: string) => ({ text, blocked: false }),
          flushPendingHistoryItem: deps.flushPendingHistoryItem,
          pendingHistoryItemRef: deps.pendingHistoryItemRef,
          thinkingBlocksRef: { current: [] },
          turnCancelledRef,
          queuedSubmissionsRef,
          enqueueSubmission,
          requeueSubmission,
          dequeueSubmission,
          clearSubmissions,
          tryReserveDrain,
          releaseDrain,
          setPendingHistoryItem: deps.setPendingHistoryItem,
          setIsResponding: deps.setIsResponding,
          setInitError: vi.fn(),
          setThought: vi.fn(),
          setLastAgentActivityTime: vi.fn(),
          scheduleToolCalls: vi.fn(),
          abortActiveStream: vi.fn(),
          handleShellCommand: vi.fn().mockReturnValue(false),
          handleSlashCommand: vi.fn().mockResolvedValue(false),
          logger: null,
          shellModeActive: false,
          loopDetectedRef: deps.loopDetectedRef,
          lastProfileNameRef: { current: undefined },
          lastModelInfoRef: { current: null },
          lastModelIdentityRef: { current: null },
          abortControllerRef: deps.abortControllerRef,
          runStreamRef: deps.runStreamRef,
          submitQueryRef: { current: null },
          isResponding: false,
          streamingState,
          recordingIntegration: {
            flushAtTurnBoundary: deps.flushAtTurnBoundarySpy,
          } as unknown as RecordingIntegration,
        });
        const cancellation = useCancellation(
          streamingState,
          turnCancelledRef,
          deps.abortControllerRef,
          vi.fn(),
          deps.pendingHistoryItemRef,
          deps.flushPendingHistoryItem,
          vi.fn().mockReturnValue(1),
          deps.setPendingHistoryItem,
          vi.fn(),
          deps.setIsResponding,
          vi.fn(),
        );
        return { ...submission, ...cancellation };
      },
      {
        initialProps: { streamingState: StreamingState.Idle },
        wrapper,
      },
    );

    // ── Turn 1 starts (streamingState transitions to Responding) ───────────
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    // Simulate streamingState becoming Responding (as it would when the
    // turn starts). The submitQueryRef is now populated.
    rerender({ streamingState: StreamingState.Responding });

    // ── Turn 2 is submitted while Responding → queued ──────────────────────
    await act(async () => {
      await result.current.submitQuery('turn-2');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(queuedSubmissionsRef.current[0].query).toBe('turn-2');

    // ── Turn 1 is cancelled and settles ────────────────────────────────────
    const turn1Controller = deps.abortControllerRef.current;
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(turn1Controller?.signal.aborted).toBe(true);
    await act(async () => {
      turn1Deferred.resolve();
    });

    // Simulate streamingState returning to Idle (cancel → setIsResponding(false)).
    rerender({ streamingState: StreamingState.Idle });

    // The idle-queue-drain effect fires, shifting and calling submitQuery
    // for Turn 2. Turn 2 starts with a fresh AbortController.
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(0);
    });

    // Turn 2's controller is different from Turn 1's (initTurn replaces it).
    await waitFor(() => {
      expect(deps.abortControllerRef.current).not.toBe(turn1Controller);
    });

    // ── Turn 2 finishes ────────────────────────────────────────────────────
    await act(async () => {
      turn2Deferred.resolve();
    });

    await act(async () => {
      await turn1Promise.catch(() => {});
    });
  });

  it('calls setIsResponding(false) from the finally when the turn is still current', async () => {
    const runDeferred = createDeferred<void>();

    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(runDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('single-turn');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    await act(async () => {
      runDeferred.resolve();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false]),
    );

    await act(async () => {
      await turnPromise.catch(() => {});
    });
  });
  it('preserves queued submissions across Ctrl+C cancel then drains them (issue #2296 integration)', async () => {
    // Integration regression for issue #2296: queued messages must survive
    // Ctrl+C cancel. The old code cleared queuedSubmissionsRef inside
    // cancelOngoingRequest; the fix removed that so queued messages persist
    // and drain after the cancelled turn settles.
    //
    // This test uses THREE deferred streams (one per turn) and verifies:
    // 1. FIFO order is exact (turn-2 before turn-3)
    // 2. Non-overlap: turns never run concurrently (only one active at a time)
    // 3. Queue survives cancel and drains completely
    // 4. Exactly-once: each submission is processed exactly once
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();
    const turn3Deferred = createDeferred<void>();

    const runStreamFn = vi
      .fn()
      .mockReturnValueOnce(turn1Deferred.promise)
      .mockReturnValueOnce(turn2Deferred.promise)
      .mockReturnValueOnce(turn3Deferred.promise);

    const deps = createDeps({
      runStreamRef: { current: runStreamFn } as never,
    });

    const queuedSubmissionsRef = {
      current: [] as QueuedSubmission[],
    };

    const {
      enqueueSubmission,
      requeueSubmission,
      dequeueSubmission,
      clearSubmissions,
    } = createQueueOperations(queuedSubmissionsRef);
    const tryReserveDrain = vi.fn().mockReturnValue(true);
    const releaseDrain = vi.fn();
    const turnCancelledRef = { current: false };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KeypressProvider>{children}</KeypressProvider>
    );

    const { result, rerender } = renderHook(
      ({ streamingState }: { streamingState: StreamingState }) => {
        const submission = useSubmitQuery({
          runtime: createStreamRuntimeForTest({}, createMockOverrides()),
          agent: createMockAgentClient() as unknown as Agent,
          addItem: vi.fn().mockReturnValue(1),
          settings: {} as never,
          onDebugMessage: vi.fn(),
          onCancelSubmit: vi.fn(),
          onAuthError: vi.fn(),
          sanitizeContent: (text: string) => ({ text, blocked: false }),
          flushPendingHistoryItem: deps.flushPendingHistoryItem,
          pendingHistoryItemRef: deps.pendingHistoryItemRef,
          thinkingBlocksRef: { current: [] },
          turnCancelledRef,
          queuedSubmissionsRef,
          enqueueSubmission,
          requeueSubmission,
          dequeueSubmission,
          clearSubmissions,
          tryReserveDrain,
          releaseDrain,
          setPendingHistoryItem: deps.setPendingHistoryItem,
          setIsResponding: deps.setIsResponding,
          setInitError: vi.fn(),
          setThought: vi.fn(),
          setLastAgentActivityTime: vi.fn(),
          scheduleToolCalls: vi.fn(),
          abortActiveStream: vi.fn(),
          handleShellCommand: vi.fn().mockReturnValue(false),
          handleSlashCommand: vi.fn().mockResolvedValue(false),
          logger: null,
          shellModeActive: false,
          loopDetectedRef: deps.loopDetectedRef,
          lastProfileNameRef: { current: undefined },
          lastModelInfoRef: { current: null },
          lastModelIdentityRef: { current: null },
          abortControllerRef: deps.abortControllerRef,
          runStreamRef: deps.runStreamRef,
          submitQueryRef: { current: null },
          isResponding: false,
          streamingState,
          recordingIntegration: {
            flushAtTurnBoundary: deps.flushAtTurnBoundarySpy,
          } as unknown as RecordingIntegration,
        });
        const cancellation = useCancellation(
          streamingState,
          turnCancelledRef,
          deps.abortControllerRef,
          vi.fn(),
          deps.pendingHistoryItemRef,
          deps.flushPendingHistoryItem,
          vi.fn().mockReturnValue(1),
          deps.setPendingHistoryItem,
          vi.fn(),
          deps.setIsResponding,
          vi.fn(),
        );
        return { ...submission, ...cancellation };
      },
      {
        initialProps: { streamingState: StreamingState.Idle },
        wrapper,
      },
    );

    // ── Turn 1 starts ──────────────────────────────────────────────────────
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    expect(runStreamFn).toHaveBeenCalledTimes(1);
    rerender({ streamingState: StreamingState.Responding });

    // ── Turn 2 and Turn 3 are queued while Turn 1 is Responding ────────────
    await act(async () => {
      await result.current.submitQuery('turn-2');
      await result.current.submitQuery('turn-3');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(2);
    // FIFO: turn-2 is first in queue, turn-3 is second
    expect(queuedSubmissionsRef.current[0].query).toBe('turn-2');
    expect(queuedSubmissionsRef.current[1].query).toBe('turn-3');
    // No additional runStream calls — turns are queued, not started
    expect(runStreamFn).toHaveBeenCalledTimes(1);

    // ── Ctrl+C cancels Turn 1 ──────────────────────────────────────────────
    // cancelOngoingRequest aborts the controller and setIsResponding(false).
    // Crucially, the queue is NOT cleared — both queued submissions survive.
    const turn1Controller = deps.abortControllerRef.current;
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(turn1Controller?.signal.aborted).toBe(true);
    await act(async () => {
      turn1Deferred.resolve();
    });

    // Queue must still have both submissions — cancel did not clear them.
    expect(queuedSubmissionsRef.current).toHaveLength(2);

    // ── streamingState returns to Idle → drain begins ──────────────────────
    rerender({ streamingState: StreamingState.Idle });

    // The first queued submission (turn-2) drains and starts immediately.
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(1);
    });
    // turn-2 is now running (runStream called a second time)
    await waitFor(() => expect(runStreamFn).toHaveBeenCalledTimes(2));
    // Simulate the turn starting: streamingState → Responding
    rerender({ streamingState: StreamingState.Responding });

    // ── Turn 2 settles → streamingState returns to Idle → turn-3 drains ───
    await act(async () => {
      turn2Deferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });

    // turn-3 drains after turn-2 settles
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(0);
    });
    // turn-3 is now running (runStream called a third time)
    await waitFor(() => expect(runStreamFn).toHaveBeenCalledTimes(3));

    // ── Turn 3 settles ─────────────────────────────────────────────────────
    await act(async () => {
      turn3Deferred.resolve();
    });

    // FIFO proven: queue drained [turn-2, turn-3] — turn-2 dequeued first
    // (length 2→1 after Idle), then turn-3 dequeued second (length 1→0 after
    // the second Idle transition). runStreamFn was called exactly 3 times
    // (once per turn), proving exactly-once processing.
    expect(runStreamFn).toHaveBeenCalledTimes(3);
    // Non-overlap proven: runStream was called sequentially — each call only
    // happened after the previous turn's deferred resolved and streamingState
    // returned to Idle. At no point did two runStream calls execute
    // concurrently (each was gated by a separate deferred).

    await act(async () => {
      await turn1Promise.catch(() => {});
    });
  });

  it('prevents double-drain when idle-effect and finally fire concurrently (issue #2296 race)', async () => {
    // This test proves the serialized drain owner prevents the double-drain
    // race: when a turn settles, BOTH the finally block (via setIsResponding)
    // and the idle-effect trigger scheduleNextQueuedSubmission. Without the
    // drain reservation, both would dequeue a separate item, starting two
    // concurrent turns. The tryReserveDrain/releaseDrain mechanism ensures
    // only one succeeds.
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const runStreamFn = vi
      .fn()
      .mockReturnValueOnce(turn1Deferred.promise)
      .mockReturnValueOnce(turn2Deferred.promise);

    const deps = createDeps({
      runStreamRef: { current: runStreamFn } as never,
    });

    const queuedSubmissionsRef = {
      current: [] as QueuedSubmission[],
    };

    // Real drain reservation implementation (mirrors useQueuedSubmissions)
    let drainReserved = false;
    const tryReserveDrain = vi.fn(() => {
      if (drainReserved) return false;
      drainReserved = true;
      return true;
    });
    const releaseDrain = vi.fn(() => {
      drainReserved = false;
    });

    const {
      enqueueSubmission,
      requeueSubmission,
      dequeueSubmission,
      clearSubmissions,
    } = createQueueOperations(queuedSubmissionsRef);

    const { result, rerender } = renderHook(
      ({ streamingState }: { streamingState: StreamingState }) =>
        useSubmitQuery({
          runtime: createStreamRuntimeForTest({}, createMockOverrides()),
          agent: createMockAgentClient() as unknown as Agent,
          addItem: vi.fn().mockReturnValue(1),
          settings: {} as never,
          onDebugMessage: vi.fn(),
          onCancelSubmit: vi.fn(),
          onAuthError: vi.fn(),
          sanitizeContent: (text: string) => ({ text, blocked: false }),
          flushPendingHistoryItem: deps.flushPendingHistoryItem,
          pendingHistoryItemRef: deps.pendingHistoryItemRef,
          thinkingBlocksRef: { current: [] },
          turnCancelledRef: { current: false },
          queuedSubmissionsRef,
          enqueueSubmission,
          requeueSubmission,
          dequeueSubmission,
          clearSubmissions,
          tryReserveDrain,
          releaseDrain,
          setPendingHistoryItem: deps.setPendingHistoryItem,
          setIsResponding: deps.setIsResponding,
          setInitError: vi.fn(),
          setThought: vi.fn(),
          setLastAgentActivityTime: vi.fn(),
          scheduleToolCalls: vi.fn(),
          abortActiveStream: vi.fn(),
          handleShellCommand: vi.fn().mockReturnValue(false),
          handleSlashCommand: vi.fn().mockResolvedValue(false),
          logger: null,
          shellModeActive: false,
          loopDetectedRef: deps.loopDetectedRef,
          lastProfileNameRef: { current: undefined },
          lastModelInfoRef: { current: null },
          lastModelIdentityRef: { current: null },
          abortControllerRef: deps.abortControllerRef,
          runStreamRef: deps.runStreamRef,
          submitQueryRef: { current: null },
          isResponding: false,
          streamingState,
          recordingIntegration: {
            flushAtTurnBoundary: deps.flushAtTurnBoundarySpy,
          } as unknown as RecordingIntegration,
        }),
      { initialProps: { streamingState: StreamingState.Idle } },
    );

    // ── Turn 1 starts ──────────────────────────────────────────────────────
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // ── Turn 2 queued while Turn 1 is Responding ───────────────────────────
    await act(async () => {
      await result.current.submitQuery('turn-2');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(1);

    // ── Turn 1 settles ─────────────────────────────────────────────────────
    // The finally block calls setIsResponding(false). In production this
    // transitions streamingState to Idle, firing the idle-effect. The finally
    // no longer calls scheduleNextQueuedSubmission directly (removed to fix
    // the race), so the idle-effect is the sole drain owner.
    await act(async () => {
      turn1Deferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });

    // Only one drain attempt should succeed — exactly one item dequeued
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(0);
    });

    // Exactly one additional runStream call (turn-2 started, not two)
    await waitFor(() => expect(runStreamFn).toHaveBeenCalledTimes(2));
    expect(releaseDrain).not.toHaveBeenCalled();

    await act(async () => {
      turn2Deferred.resolve();
    });
    await waitFor(() => expect(releaseDrain).toHaveBeenCalledTimes(1));

    await act(async () => {
      await turn1Promise.catch(() => {});
    });
  });
});
