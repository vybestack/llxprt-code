/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
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

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import {
  useSubmitQuery,
  type SubmissionExecutor,
  type UseSubmitQueryDeps,
} from '../useSubmitQuery.js';
import { useCancellation } from '../useAgentStreamLifecycle.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import {
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type {
  StreamRuntime,
  UiMcpClientManager,
} from '../../../cliUiRuntime.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import { createFakeAgentFromMockClient } from '../../useAgentStream-test-helpers.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
// ─── Module mocks ───────────────────────────────────────────────────────────
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred } from './createDeferred.js';
import {
  createLoadedSettings,
  createMockOverrides,
  createQueueOperations,
} from './submitQueryTestFixtures.js';
// useSubmitQuery internally calls useStreamEventHandlers and useSessionStats.
// We stub them so the test can isolate the turn-lifecycle / finally logic.
const prepareQueryForAgentMock = vi
  .fn()
  .mockResolvedValue({ queryToSend: 'test-query', shouldProceed: true });
void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    displayUserMessage: vi.fn(),
    prepareQueryForAgent: prepareQueryForAgentMock,
    handleLoopDetectedEvent: vi.fn(),
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

// Mock streamUtils so we can assert whether handleSubmissionError is called.
const handleSubmissionErrorMock = vi.fn();
void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: handleSubmissionErrorMock,
  processSlashCommandResult: vi.fn(),
}));

function createMockAgent() {
  return createFakeAgentFromMockClient({
    getCurrentSequenceModel: () => 'test-model',
  });
}

function createMockSetState(
  calls: boolean[],
): Dispatch<SetStateAction<boolean>> {
  return (value) => {
    if (typeof value === 'boolean') calls.push(value);
  };
}

function KeypressTestWrapper({ children }: React.PropsWithChildren) {
  return <KeypressProvider>{children}</KeypressProvider>;
}

interface DoubleCancelDeps {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: UseSubmitQueryDeps['runStreamRef'];
  loopDetectedRef: React.MutableRefObject<boolean>;
  handleLoopDetectedEvent: ReturnType<typeof vi.fn>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  flushPendingHistoryItem: ReturnType<typeof vi.fn>;
  setPendingHistoryItem: ReturnType<typeof vi.fn>;
}

function createDeps(options: Partial<DoubleCancelDeps> = {}): DoubleCancelDeps {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding:
      options.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef: options.abortControllerRef ?? { current: null },
    runStreamRef: options.runStreamRef ?? { current: null },
    loopDetectedRef: options.loopDetectedRef ?? { current: false },
    handleLoopDetectedEvent: options.handleLoopDetectedEvent ?? vi.fn(),
    pendingHistoryItemRef: options.pendingHistoryItemRef ?? { current: null },
    flushPendingHistoryItem: options.flushPendingHistoryItem ?? vi.fn(),
    setPendingHistoryItem: options.setPendingHistoryItem ?? vi.fn(),
  };
}

interface SubmitQueryOverrides {
  runtime?: StreamRuntime;
  queuedSubmissionsRef?: React.MutableRefObject<QueuedSubmission[]>;
  queueOperations?: ReturnType<typeof createQueueOperations>;
  tryReserveDrain?: () => boolean;
  releaseDrain?: () => void;
  submitQueryRef?: React.MutableRefObject<SubmissionExecutor | null>;
  addItem?: UseSubmitQueryDeps['addItem'];
  turnCancelledRef?: React.MutableRefObject<boolean>;
  drainSuppressedRef?: React.MutableRefObject<boolean>;
  recordingIntegration?: UseSubmitQueryDeps['recordingIntegration'];
}

interface RenderSubmitQueryOptions {
  initialStreamingState?: StreamingState;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

function createUseSubmitQueryDeps(
  deps: DoubleCancelDeps,
  overrides: SubmitQueryOverrides = {},
): (streamingState: StreamingState) => UseSubmitQueryDeps {
  const queuedSubmissionsRef = overrides.queuedSubmissionsRef ?? {
    current: [],
  };
  const queueOperations =
    overrides.queueOperations ?? createQueueOperations(queuedSubmissionsRef);
  const stableDeps = {
    runtime:
      overrides.runtime ??
      createStreamRuntimeForTest({}, createMockOverrides()),
    agent: createMockAgent(),
    addItem: overrides.addItem ?? vi.fn().mockReturnValue(1),
    settings: createLoadedSettings(),
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    onAuthError: vi.fn(),
    recordingIntegration: overrides.recordingIntegration,
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: deps.flushPendingHistoryItem,
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: deps.pendingHistoryItemRef,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: overrides.turnCancelledRef ?? { current: false },
    setTurnCancelled: vi.fn(),
    queuedSubmissionsRef,
    ...queueOperations,
    drainSuppressedRef: overrides.drainSuppressedRef ?? { current: false },
    tryReserveDrain: overrides.tryReserveDrain ?? vi.fn().mockReturnValue(true),
    releaseDrain: overrides.releaseDrain ?? vi.fn(),
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
    submitQueryRef: overrides.submitQueryRef ?? { current: null },
    isResponding: false,
  };
  return (streamingState) => ({ ...stableDeps, streamingState });
}

function renderUseSubmitQuery(
  deps: DoubleCancelDeps,
  overrides: SubmitQueryOverrides = {},
  options: RenderSubmitQueryOptions = {},
) {
  const getDeps = createUseSubmitQueryDeps(deps, overrides);
  return renderHook(
    ({ streamingState }: { streamingState: StreamingState }) =>
      useSubmitQuery(getDeps(streamingState)),
    {
      initialProps: {
        streamingState: options.initialStreamingState ?? StreamingState.Idle,
      },
      wrapper: options.wrapper,
    },
  );
}

function renderUseSubmitQueryWithCancellation(
  deps: DoubleCancelDeps,
  overrides: SubmitQueryOverrides,
  options: RenderSubmitQueryOptions,
) {
  const turnCancelledRef = overrides.turnCancelledRef ?? { current: false };
  const drainSuppressedRef = overrides.drainSuppressedRef ?? { current: false };
  const getDeps = createUseSubmitQueryDeps(deps, {
    ...overrides,
    turnCancelledRef,
    drainSuppressedRef,
  });
  return renderHook(
    ({ streamingState }: { streamingState: StreamingState }) => {
      const submission = useSubmitQuery(getDeps(streamingState));
      const cancellation = useCancellation(
        streamingState,
        turnCancelledRef,
        (v: boolean) => void (turnCancelledRef.current = v),
        deps.abortControllerRef,
        vi.fn(),
        deps.pendingHistoryItemRef,
        deps.flushPendingHistoryItem,
        vi.fn().mockReturnValue(1),
        deps.setPendingHistoryItem,
        vi.fn(),
        deps.setIsResponding,
        vi.fn(),
        drainSuppressedRef,
      );
      return { ...submission, ...cancellation };
    },
    {
      initialProps: {
        streamingState: options.initialStreamingState ?? StreamingState.Idle,
      },
      wrapper: options.wrapper,
    },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — double-cancel guard (issue #2259)', () => {
  it('suppresses stale cleanup after the cancellation path supersedes a turn', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: { current: vi.fn(() => turnDeferred.promise) },
    });
    const recordingIntegration = new RecordingIntegration(
      new SessionRecordingService({
        sessionId: 'stale-turn-test',
        projectHash: 'test-project',
        workspaceDirs: ['/tmp'],
        provider: 'test-provider',
        model: 'test-model',
        chatsDir: '/tmp/llxprt-stale-turn-test',
      }),
    );
    const flushAtTurnBoundary = vi
      .spyOn(recordingIntegration, 'flushAtTurnBoundary')
      .mockResolvedValue(undefined);
    const turnCancelledRef = { current: false };
    const { result, rerender } = renderUseSubmitQueryWithCancellation(
      deps,
      {
        turnCancelledRef,
        recordingIntegration,
      },
      { wrapper: KeypressTestWrapper },
    );

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    rerender({ streamingState: StreamingState.Responding });
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(turnCancelledRef.current).toBe(true);
    expect(deps.setIsRespondingCalls).toStrictEqual([true, false]);

    const turn1Signal = deps.abortControllerRef.current?.signal;
    expect(turn1Signal?.aborted).toBe(true);

    deps.flushPendingHistoryItem.mockClear();
    deps.setPendingHistoryItem.mockClear();
    deps.pendingHistoryItemRef.current = { type: 'gemini', text: 'stale' };
    deps.loopDetectedRef.current = true;
    const newerController = new AbortController();
    deps.abortControllerRef.current = newerController;

    await act(async () => {
      turnDeferred.resolve();
      await turnPromise;
    });

    expect(deps.setIsRespondingCalls).toStrictEqual([true, false]);
    expect(deps.flushPendingHistoryItem).not.toHaveBeenCalled();
    expect(deps.setPendingHistoryItem).not.toHaveBeenCalled();
    expect(deps.abortControllerRef.current).toBe(newerController);
    expect(newerController.signal).not.toBe(turn1Signal);
    expect(deps.handleLoopDetectedEvent).not.toHaveBeenCalled();
    expect(flushAtTurnBoundary).not.toHaveBeenCalled();
  });

  it('suppresses stale submission errors after cancellation supersedes a turn', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: { current: vi.fn(() => turnDeferred.promise) },
    });
    const { result, rerender } = renderUseSubmitQueryWithCancellation(
      deps,
      { turnCancelledRef: { current: false } },
      { wrapper: KeypressTestWrapper },
    );

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('turn-1');
    });
    rerender({ streamingState: StreamingState.Responding });
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    // Simulate the new AbortController that initTurn would create when the
    // next submitQuery runs. We assign directly rather than calling
    // submitQuery again to keep the test focused on the isCurrentTurn guard
    // without starting a real second turn's streaming pipeline.
    deps.abortControllerRef.current = new AbortController();
    handleSubmissionErrorMock.mockClear();

    await act(async () => {
      turnDeferred.reject(new Error('stale failure'));
      await turnPromise;
    });

    expect(handleSubmissionErrorMock).not.toHaveBeenCalled();
  });

  it('keeps submission callbacks and event subscriptions stable across rerenders', () => {
    const unsubscribeMcp = vi.fn();
    const onMcpClientUpdate = vi.fn(() => unsubscribeMcp);
    const setupAsyncTaskAutoTrigger = vi.fn(() => vi.fn());
    const runtime = createStreamRuntimeForTest(
      {},
      {
        events: { onMcpClientUpdate },
        asyncTasks: { setupAsyncTaskAutoTrigger },
      },
    );
    const deps = createDeps();
    const { result, rerender, unmount } = renderUseSubmitQuery(deps, {
      runtime,
    });
    const initialSubmitQuery = result.current.submitQuery;
    const initialSchedule = result.current.scheduleNextQueuedSubmission;

    rerender({ streamingState: StreamingState.Idle });

    expect(result.current.submitQuery).toBe(initialSubmitQuery);
    expect(result.current.scheduleNextQueuedSubmission).toBe(initialSchedule);
    expect(onMcpClientUpdate).toHaveBeenCalledTimes(1);
    expect(setupAsyncTaskAutoTrigger).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeMcp).toHaveBeenCalledTimes(1);
  });

  it('retries an unavailable queued submitter after a delay without stalling', async () => {
    vi.useFakeTimers();
    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const submitQueryRef: React.MutableRefObject<SubmissionExecutor | null> = {
      current: null,
    };
    const rendered = renderUseSubmitQuery(
      createDeps(),
      {
        queuedSubmissionsRef,
        queueOperations,
        submitQueryRef,
      },
      { initialStreamingState: StreamingState.Idle },
    );

    try {
      submitQueryRef.current = null;
      queueOperations.enqueueSubmission({ query: 'retry me' });
      act(() => {
        rendered.result.current.scheduleNextQueuedSubmission();
      });
      await act(async () => {
        await advanceTimersByTimeAsync(1);
      });
      expect(queuedSubmissionsRef.current).toHaveLength(1);

      submitQueryRef.current = async () => 'consumed';
      await act(async () => {
        await advanceTimersByTimeAsync(999);
      });
      expect(queuedSubmissionsRef.current).toHaveLength(1);

      await act(async () => {
        await advanceTimersByTimeAsync(1);
      });
      expect(queuedSubmissionsRef.current).toHaveLength(0);
    } finally {
      rendered.unmount();
      vi.useRealTimers();
    }
  });

  it('drops a permanently failing queued submission and continues draining', async () => {
    vi.useFakeTimers();
    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const submitQueryRef: React.MutableRefObject<SubmissionExecutor | null> = {
      current: null,
    };
    const processedQueries: string[] = [];
    const rendered = renderUseSubmitQuery(
      createDeps(),
      {
        queuedSubmissionsRef,
        queueOperations,
        submitQueryRef,
      },
      { initialStreamingState: StreamingState.Idle },
    );

    try {
      submitQueryRef.current = async (query) => {
        if (query === 'permanent failure') {
          throw new Error('permanent failure');
        }
        if (typeof query === 'string') {
          processedQueries.push(query);
        }
        return 'consumed';
      };
      queueOperations.enqueueSubmission({ query: 'permanent failure' });
      queueOperations.enqueueSubmission({ query: 'next submission' });

      act(() => {
        rendered.result.current.scheduleNextQueuedSubmission();
      });
      await act(async () => {
        await advanceTimersByTimeAsync(1);
      });
      for (let retry = 0; retry < 3; retry += 1) {
        await act(async () => {
          await advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
          await advanceTimersByTimeAsync(1);
        });
      }
      await act(async () => {
        await advanceTimersByTimeAsync(1);
      });

      expect(queuedSubmissionsRef.current).toStrictEqual([]);
      expect(processedQueries).toStrictEqual(['next submission']);
    } finally {
      rendered.unmount();
      vi.useRealTimers();
    }
  });

  it('rejects the public submission when query preparation fails', async () => {
    const preparationError = new Error('query preparation failed');
    prepareQueryForAgentMock.mockRejectedValueOnce(preparationError);
    const { result, unmount } = renderUseSubmitQuery(createDeps());

    try {
      await act(async () => {
        await result.current.submitQuery('prepare me').then(
          () => {
            throw new Error('Expected query preparation to reject');
          },
          (error: unknown) => expect(error).toBe(preparationError),
        );
      });
    } finally {
      unmount();
    }
  });

  it('processes a non-string submission immediately even when MCP discovery is in progress (issue #2516)', async () => {
    const discoveryState = MCPDiscoveryState.IN_PROGRESS;
    const mcpManager: UiMcpClientManager = {
      getDiscoveryState: () => discoveryState,
      getMcpServerCount: () => 1,
      restartServer: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createStreamRuntimeForTest(
      {},
      {
        mcp: {
          getMcpClientManager: () => mcpManager,
          getMcpServers: () => ({ server: { command: 'unused' } }),
        },
      },
    );
    const runStream = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({ runStreamRef: { current: runStream } });
    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
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

    const nonStringQuery: QueuedSubmission['query'] = [
      { type: 'text', text: 'wait for mcp' },
    ];
    await act(async () => {
      await result.current.submitQuery(nonStringQuery);
    });
    // With the MCP discovery gate removed, the query proceeds immediately
    // to runStream — it is NOT queued or dropped.
    expect(queuedSubmissionsRef.current).toHaveLength(0);
    expect(runStream).toHaveBeenCalledTimes(1);
    for (const call of addItem.mock.calls) {
      const item = call[0] as { type?: string; text?: string };
      expect(item.text).not.toMatch(/Waiting for MCP servers/i);
    }

    unmount();
  });

  it('requeues an in-flight drained submission exactly once when unmounted', async () => {
    const runDeferred = createDeferred<void>();
    const runStream = vi.fn(() => runDeferred.promise);
    const deps = createDeps({ runStreamRef: { current: runStream } });
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
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toStrictEqual([queuedSubmission]);
      expect(releases).toBe(1);
    });
  });
  it('queues the second prompt when streamingState is Responding, suppresses drain after cancel', async () => {
    // When streamingState is Responding, submitQuery queues the query.
    // After cancel, drain is suppressed so the message stays (issue #2882).
    const turn1Deferred = createDeferred<void>();

    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turn1Deferred.promise),
      },
    });

    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const tryReserveDrain = vi.fn().mockReturnValue(true);
    const releaseDrain = vi.fn();
    const turnCancelledRef = { current: false };

    const { result, rerender } = renderUseSubmitQueryWithCancellation(
      deps,
      {
        queuedSubmissionsRef,
        queueOperations,
        tryReserveDrain,
        releaseDrain,
        turnCancelledRef,
      },
      { wrapper: KeypressTestWrapper },
    );

    // Turn 1 starts
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // Turn 2 is queued while Responding
    await act(async () => {
      await result.current.submitQuery('turn-2');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(1);

    // Cancel Turn 1
    const turn1Controller = deps.abortControllerRef.current;
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(turn1Controller?.signal.aborted).toBe(true);
    await act(async () => {
      turn1Deferred.resolve();
    });

    // streamingState → Idle: drain is SUPPRESSED (schedule checks
    // drainSuppressedRef synchronously, so no setTimeout(0) is queued)
    rerender({ streamingState: StreamingState.Idle });
    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(deps.runStreamRef.current).toHaveBeenCalledTimes(1);

    await act(async () => void turn1Promise.catch(() => {}));
  });

  it('calls setIsResponding(false) from the finally when the turn is still current', async () => {
    const runDeferred = createDeferred<void>();

    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(runDeferred.promise),
      },
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
  it('preserves queued submissions across Ctrl+C cancel without auto-draining', async () => {
    // Regression for issue #2882: queued messages survive cancel, drain is
    // suppressed, and submitting a new message resumes normal drain.
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();
    const turn3Deferred = createDeferred<void>();
    const turn4Deferred = createDeferred<void>();

    const runStreamFn = vi
      .fn()
      .mockReturnValueOnce(turn1Deferred.promise)
      .mockReturnValueOnce(turn4Deferred.promise)
      .mockReturnValueOnce(turn2Deferred.promise)
      .mockReturnValueOnce(turn3Deferred.promise);

    const deps = createDeps({
      runStreamRef: { current: runStreamFn },
    });

    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
    };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const tryReserveDrain = vi.fn().mockReturnValue(true);
    const releaseDrain = vi.fn();
    const turnCancelledRef = { current: false };

    const { result, rerender } = renderUseSubmitQueryWithCancellation(
      deps,
      {
        queuedSubmissionsRef,
        queueOperations,
        tryReserveDrain,
        releaseDrain,
        turnCancelledRef,
      },
      { wrapper: KeypressTestWrapper },
    );

    // Turn 1 starts
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    expect(runStreamFn).toHaveBeenCalledTimes(1);
    rerender({ streamingState: StreamingState.Responding });

    // Turn 2 and Turn 3 are queued while Turn 1 is Responding
    await act(async () => {
      await result.current.submitQuery('turn-2');
      await result.current.submitQuery('turn-3');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(2);
    expect(runStreamFn).toHaveBeenCalledTimes(1);

    // Ctrl+C cancels Turn 1
    const turn1Controller = deps.abortControllerRef.current;
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(turn1Controller?.signal.aborted).toBe(true);
    await act(async () => {
      turn1Deferred.resolve();
    });

    // streamingState → Idle: drain is SUPPRESSED (schedule checks
    // drainSuppressedRef synchronously, so no setTimeout(0) is queued)
    rerender({ streamingState: StreamingState.Idle });
    expect(queuedSubmissionsRef.current).toHaveLength(2);
    expect(runStreamFn).toHaveBeenCalledTimes(1);

    // Submitting a new message clears suppression
    let turn4Promise!: Promise<void>;
    await act(async () => {
      turn4Promise = result.current.submitQuery('turn-4');
    });
    await waitFor(() => expect(runStreamFn).toHaveBeenCalledTimes(2));
    rerender({ streamingState: StreamingState.Responding });

    // Turn 4 settles → suppression cleared → queue drains (FIFO)
    await act(async () => {
      turn4Deferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(1);
      expect(runStreamFn).toHaveBeenCalledTimes(3);
    });
    rerender({ streamingState: StreamingState.Responding });

    // Turn 2 settles → turn-3 drains
    await act(async () => {
      turn2Deferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });
    await waitFor(() => {
      expect(queuedSubmissionsRef.current).toHaveLength(0);
      expect(runStreamFn).toHaveBeenCalledTimes(4);
    });

    // Cleanup
    await act(async () => {
      turn3Deferred.resolve();
      await turn1Promise.catch(() => {});
      await turn4Promise.catch(() => {});
    });
  });

  it('prevents double-drain when idle-effect and finally fire concurrently', async () => {
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
      runStreamRef: { current: runStreamFn },
    });

    const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
      current: [],
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
    const queueOperations = createQueueOperations(queuedSubmissionsRef);

    const { result, rerender } = renderUseSubmitQuery(deps, {
      queuedSubmissionsRef,
      queueOperations,
      tryReserveDrain,
      releaseDrain,
    });

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
    // The current-turn finally scheduler races the Idle effect after the
    // responding-state transition. The drain reservation admits one owner.
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
