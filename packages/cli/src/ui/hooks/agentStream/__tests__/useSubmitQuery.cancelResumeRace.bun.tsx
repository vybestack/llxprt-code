/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3169 — "Fresh prompt can remain queued during
 * cancelled-turn teardown."
 *
 * After an acknowledged prompt cancellation (Escape → "Request cancelled."),
 * a NEW ordinary prompt submitted BEFORE the cancelled turn's aborted stream
 * finishes async teardown is accepted into the queued-message drawer and stays
 * there indefinitely because `drainSuppressedRef` is never cleared.
 *
 * These tests exercise the REAL `useSubmitQuery`, REAL `useCancellation`, and
 * the REAL `useQueuedSubmissions` store — including its ref/state
 * synchronisation and drain reservation — so queue ordering, suppression and
 * active-turn ownership are all genuinely under test rather than stubbed.
 *
 * The Agent/provider boundary is faked via a deferred `runStreamRef` so a test
 * can hold the aborted stream unresolved. `streamingState` is supplied as a
 * prop (it is a render value owned by the orchestrator in production), and the
 * event handlers, session stats, turn preparation and submission-error
 * reporting collaborators are mocked because they are not part of this
 * behavior.
 */

import { describe, it, expect, vi } from 'bun:test';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import {
  useSubmitQuery,
  type SubmissionExecutor,
  type UseSubmitQueryDeps,
} from '../useSubmitQuery.js';
import { useCancellation } from '../useAgentStreamLifecycle.js';
import { useQueuedSubmissions } from '../useQueuedSubmissions.js';
import {
  StreamingState,
  MessageType,
  type HistoryItemWithoutId,
} from '../../../types.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import { createFakeAgentFromMockClient } from '../../useAgentStream-test-helpers.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred } from './createDeferred.js';
import {
  createLoadedSettings,
  createMockOverrides,
} from './submitQueryTestFixtures.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core';

// ─── Module mocks ───────────────────────────────────────────────────────────

// prepareQueryForAgent must pass through the actual query so ordering tests
// can verify which prompt each runStream call received.
const prepareQueryForAgentMock = vi
  .fn()
  .mockImplementation(async (query: AgentRequestInput) => ({
    queryToSend: query,
    shouldProceed: true,
  }));

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

void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
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

// ─── Render helper (REAL queue store) ───────────────────────────────────────

interface RaceTestHandles {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: UseSubmitQueryDeps['runStreamRef'];
  addItem: ReturnType<typeof vi.fn>;
  flushPendingHistoryItem: ReturnType<typeof vi.fn>;
  setPendingHistoryItem: ReturnType<typeof vi.fn>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  submitQueryRef: React.MutableRefObject<SubmissionExecutor | null>;
}

function createTestHandles(
  runStream: ReturnType<typeof vi.fn>,
): RaceTestHandles {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding: createMockSetState(setIsRespondingCalls),
    abortControllerRef: { current: null },
    runStreamRef: { current: runStream },
    addItem: vi.fn().mockReturnValue(1),
    flushPendingHistoryItem: vi.fn(),
    setPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef: { current: null },
    submitQueryRef: { current: null },
  };
}

interface RenderOptions {
  initialStreamingState?: StreamingState;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

function renderWithRealQueue(
  handles: RaceTestHandles,
  options: RenderOptions = {},
) {
  const turnCancelledRef: React.MutableRefObject<boolean> = { current: false };
  const drainSuppressedRef: React.MutableRefObject<boolean> = {
    current: false,
  };

  return renderHook(
    ({ streamingState }: { streamingState: StreamingState }) => {
      // REAL queue store — not the createQueueOperations stub.
      const queue = useQueuedSubmissions();

      const submitDeps: UseSubmitQueryDeps = {
        runtime: createStreamRuntimeForTest({}, createMockOverrides()),
        agent: createMockAgent(),
        addItem: handles.addItem,
        removeItems: vi.fn(),
        settings: createLoadedSettings(),
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        onAuthError: vi.fn(),
        recordingIntegration: undefined,
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
        setLastAgentActivityTime: vi.fn(),
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
        runStreamRef: handles.runStreamRef,
        submitQueryRef: handles.submitQueryRef,
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
      return {
        ...submission,
        ...cancellation,
        queue,
        turnCancelledRef,
        drainSuppressedRef,
      };
    },
    {
      initialProps: {
        streamingState: options.initialStreamingState ?? StreamingState.Idle,
      },
      wrapper: options.wrapper ?? KeypressTestWrapper,
    },
  );
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function queryText(q: AgentRequestInput): string {
  if (typeof q === 'string') return q;
  if (!Array.isArray(q)) return '';
  const part = q[0];
  return 'text' in part ? String(part.text) : '';
}

function observedRunStreamOrder(runStream: ReturnType<typeof vi.fn>): string[] {
  return runStream.mock.calls.map((call) =>
    queryText(call[0] as AgentRequestInput),
  );
}

function assertCancelledInfoAdded(addItem: ReturnType<typeof vi.fn>): void {
  const cancelItem = addItem.mock.calls.find(
    (call) =>
      (call[0] as { type: string }).type === MessageType.INFO &&
      (call[0] as { text: string }).text === 'Request cancelled.',
  );
  expect(cancelItem).toBeDefined();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — cancel-resume race (issue #3169)', () => {
  it('T1: fresh prompt during cancelled-turn teardown auto-drains after teardown', async () => {
    const turnADeferred = createDeferred<void>();
    const turnBDeferred = createDeferred<void>();
    const runStream = vi
      .fn()
      .mockReturnValueOnce(turnADeferred.promise)
      .mockReturnValueOnce(turnBDeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // 1. Submit A
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    expect(runStream).toHaveBeenCalledTimes(1);
    rerender({ streamingState: StreamingState.Responding });

    // 2. Cancel A
    const turnASignal = handles.abortControllerRef.current?.signal;
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(handles.setIsRespondingCalls).toStrictEqual([true, false]);
    expect(turnASignal?.aborted).toBe(true);
    expect(result.current.turnCancelledRef.current).toBe(true);
    expect(result.current.drainSuppressedRef.current).toBe(true);
    assertCancelledInfoAdded(handles.addItem);
    rerender({ streamingState: StreamingState.Idle });

    // 3. Keep A's runStream UNRESOLVED. Submit B.
    await act(async () => {
      await result.current.submitQuery('B');
    });

    // 4. runStream STILL called once (no concurrent iterator). B is parked at
    //    the front of the queue and suppression has been released so the
    //    settle-time drain can run it without another Enter.
    expect(runStream).toHaveBeenCalledTimes(1);
    expect(result.current.drainSuppressedRef.current).toBe(false);
    expect(
      result.current.queue.queuedSubmissionsRef.current.map((s) =>
        queryText(s.query),
      ),
    ).toStrictEqual(['B']);

    // 5. Resolve A's deferred
    await act(async () => {
      turnADeferred.resolve();
    });

    // 6. runStream called twice, second with B, queue empty — no second Enter
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(2));
    expect(queryText(runStream.mock.calls[1][0] as AgentRequestInput)).toBe(
      'B',
    );
    await waitFor(() =>
      expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0),
    );

    // 7. Resolve B; queue empty, responding released
    rerender({ streamingState: StreamingState.Responding });
    await act(async () => {
      turnBDeferred.resolve();
    });
    // setIsResponding sequence: true(A), false(cancel), false(A finally),
    // true(B drain), false(B finally)
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([
        true,
        false,
        false,
        true,
        false,
      ]),
    );
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0);

    await act(async () => void turnAPromise.catch(() => {}));
  });

  it('T2: preserved pre-cancel entries drain AFTER the resume prompt (FIFO priority)', async () => {
    const deferreds = [
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
    ];
    let started = 0;
    // Fail fast rather than silently resolving: an extra turn would mean the
    // queue drained more times than the four expected prompts.
    const runStream = vi.fn((..._args: unknown[]) => {
      if (started >= deferreds.length) {
        throw new Error(`Unexpected turn ${started + 1} started`);
      }
      const deferred = deferreds[started];
      started += 1;
      return deferred.promise;
    });
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // 1. Submit A, rerender Responding
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    expect(runStream).toHaveBeenCalledTimes(1);
    rerender({ streamingState: StreamingState.Responding });

    // Submit Q1, Q2 (both queued)
    await act(async () => {
      await result.current.submitQuery('Q1');
      await result.current.submitQuery('Q2');
    });
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(2);

    // 2. Cancel A, hold unresolved, rerender Idle
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    rerender({ streamingState: StreamingState.Idle });

    // 3. Q1/Q2 still queued, runStream still once
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(2);
    expect(runStream).toHaveBeenCalledTimes(1);

    // 4. Submit B (resume intent) — front-inserted ahead of Q1/Q2, and
    //    cancellation's drain suppression is released.
    await act(async () => {
      await result.current.submitQuery('B');
    });
    expect(
      result.current.queue.queuedSubmissionsRef.current.map((s) =>
        queryText(s.query),
      ),
    ).toStrictEqual(['B', 'Q1', 'Q2']);
    expect(result.current.drainSuppressedRef.current).toBe(false);

    // 5. Resolve A, then each subsequent turn in order
    await act(async () => {
      deferreds[0].resolve();
    });
    // B should drain to the front and start
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(2));
    rerender({ streamingState: StreamingState.Responding });

    await act(async () => {
      deferreds[1].resolve();
    });
    rerender({ streamingState: StreamingState.Idle });
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(3));
    rerender({ streamingState: StreamingState.Responding });

    await act(async () => {
      deferreds[2].resolve();
    });
    rerender({ streamingState: StreamingState.Idle });
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(4));
    rerender({ streamingState: StreamingState.Responding });

    await act(async () => {
      deferreds[3].resolve();
    });
    rerender({ streamingState: StreamingState.Idle });

    // 6. Order is A, B, Q1, Q2 — each exactly once
    expect(observedRunStreamOrder(runStream)).toStrictEqual([
      'A',
      'B',
      'Q1',
      'Q2',
    ]);
    await waitFor(() =>
      expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0),
    );

    await act(async () => void turnAPromise.catch(() => {}));
  });

  it('T3: when teardown finishes BEFORE the fresh submission, B runs directly', async () => {
    const turnADeferred = createDeferred<void>();
    const turnBDeferred = createDeferred<void>();
    const runStream = vi
      .fn()
      .mockReturnValueOnce(turnADeferred.promise)
      .mockReturnValueOnce(turnBDeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // Submit A
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // Cancel A
    await act(async () => {
      result.current.cancelOngoingRequest();
    });

    // Resolve A BEFORE submitting B (teardown wins)
    await act(async () => {
      turnADeferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });

    // Submit B — should run directly via fresh path
    let turnBPromise!: Promise<void>;
    await act(async () => {
      turnBPromise = result.current.submitQuery('B');
    });
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(2));

    // Queue was never non-empty
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0);

    // Order is A, B
    expect(observedRunStreamOrder(runStream)).toStrictEqual(['A', 'B']);

    await act(async () => {
      turnBDeferred.resolve();
    });
    await act(async () => {
      void turnAPromise.catch(() => {});
      void turnBPromise.catch(() => {});
    });
  });

  it('T4: queue-originated retry (fromQueue=true) returns requeue and keeps suppression', async () => {
    const turnADeferred = createDeferred<void>();
    const runStream = vi.fn().mockReturnValueOnce(turnADeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // Submit A to occupy the active turn
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // Cancel to set drainSuppressedRef = true
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    rerender({ streamingState: StreamingState.Idle });
    expect(result.current.drainSuppressedRef.current).toBe(true);

    // Invoke the executor with fromQueue=true
    let disposition: string | undefined;
    await act(async () => {
      const executor = handles.submitQueryRef.current;
      expect(executor).not.toBeNull();
      if (executor) {
        disposition = await executor('retry-item', undefined, undefined, true);
      }
    });

    // A queue-originated attempt is requeued and must neither clear
    // cancellation suppression nor enter the queue as a new entry.
    expect(disposition).toBe('requeue');
    expect(result.current.drainSuppressedRef.current).toBe(true);
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0);
    expect(runStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      turnADeferred.resolve();
    });
    await act(async () => void turnAPromise.catch(() => {}));
  });

  it('T5: live-turn submission (Responding) appends to BACK and keeps suppression false', async () => {
    const turnADeferred = createDeferred<void>();
    const runStream = vi.fn().mockReturnValueOnce(turnADeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // Submit A to start the live turn
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // Submit Q1 then B while Responding
    await act(async () => {
      await result.current.submitQuery('Q1');
      await result.current.submitQuery('B');
    });

    // Both appended to the BACK in FIFO order
    const texts = result.current.queue.queuedSubmissionsRef.current.map((s) =>
      queryText(s.query),
    );
    expect(texts).toStrictEqual(['Q1', 'B']);

    // Suppression is untouched by a live-turn submission.
    expect(result.current.drainSuppressedRef.current).toBe(false);

    // runStream still called once (no premature drain during live turn)
    expect(runStream).toHaveBeenCalledTimes(1);

    // Settle A while still Responding so the queue is never drained here: this
    // test is only about where a live-turn submission lands.
    await act(async () => {
      turnADeferred.resolve();
      await turnAPromise.catch(() => {});
    });
    expect(runStream).toHaveBeenCalledTimes(1);
  });

  it('T6: cancellation alone preserves queued entries even after the stream settles', async () => {
    const turnADeferred = createDeferred<void>();
    const runStream = vi.fn().mockReturnValueOnce(turnADeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    // Submit A
    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });

    // Queue Q1 and Q2
    await act(async () => {
      await result.current.submitQuery('Q1');
      await result.current.submitQuery('Q2');
    });
    expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(2);

    // Cancel A
    await act(async () => {
      result.current.cancelOngoingRequest();
    });

    // Resolve A's stream and go Idle
    await act(async () => {
      turnADeferred.resolve();
    });
    rerender({ streamingState: StreamingState.Idle });

    // Queue is unchanged — cancellation alone does not drain
    await waitFor(() =>
      expect(
        result.current.queue.queuedSubmissionsRef.current.map((s) =>
          queryText(s.query),
        ),
      ).toStrictEqual(['Q1', 'Q2']),
    );
    // Suppression is still engaged: only an explicit resume releases it.
    expect(result.current.drainSuppressedRef.current).toBe(true);
    // runStream still called once — no extra turn
    expect(runStream).toHaveBeenCalledTimes(1);

    await act(async () => void turnAPromise.catch(() => {}));
  });

  it('T7: resumes even when the cancelled turn still renders WaitingForConfirmation', async () => {
    // streamingState is derived from tool calls flattened across EVERY
    // scheduler, while cancellation only cancels the main one. So an
    // awaiting_approval call owned by another scheduler keeps the public state
    // at WaitingForConfirmation after the cancellation is acknowledged. The
    // resume classification must not depend on that render value.
    const turnADeferred = createDeferred<void>();
    const turnBDeferred = createDeferred<void>();
    const runStream = vi
      .fn()
      .mockReturnValueOnce(turnADeferred.promise)
      .mockReturnValueOnce(turnBDeferred.promise);
    const handles = createTestHandles(runStream);
    const { result, rerender } = renderWithRealQueue(handles);

    let turnAPromise!: Promise<void>;
    await act(async () => {
      turnAPromise = result.current.submitQuery('A');
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([true]),
    );

    // Cancel from WaitingForConfirmation and keep that rendered state.
    rerender({ streamingState: StreamingState.WaitingForConfirmation });
    await act(async () => {
      result.current.cancelOngoingRequest();
    });
    expect(result.current.turnCancelledRef.current).toBe(true);
    expect(result.current.drainSuppressedRef.current).toBe(true);
    assertCancelledInfoAdded(handles.addItem);

    // Fresh prompt B while the state is still WaitingForConfirmation.
    await act(async () => {
      await result.current.submitQuery('B');
    });
    expect(
      result.current.queue.queuedSubmissionsRef.current.map((s) =>
        queryText(s.query),
      ),
    ).toStrictEqual(['B']);
    expect(result.current.drainSuppressedRef.current).toBe(false);
    expect(runStream).toHaveBeenCalledTimes(1);

    // Once the cancelled stream settles and the confirmation clears, B runs
    // automatically and exactly once.
    await act(async () => {
      turnADeferred.resolve();
      await turnAPromise.catch(() => {});
    });
    rerender({ streamingState: StreamingState.Idle });
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(2));
    expect(observedRunStreamOrder(runStream)).toStrictEqual(['A', 'B']);
    await waitFor(() =>
      expect(result.current.queue.queuedSubmissionsRef.current).toHaveLength(0),
    );

    // B's turn promise is owned by the internal drain, not returned by
    // submitQuery (which only enqueued it), so settle it by waiting for the
    // observable responding release rather than by awaiting a returned promise.
    await act(async () => {
      turnBDeferred.resolve();
    });
    await waitFor(() =>
      expect(handles.setIsRespondingCalls).toStrictEqual([
        true,
        false,
        false,
        true,
        false,
      ]),
    );
  });
});
