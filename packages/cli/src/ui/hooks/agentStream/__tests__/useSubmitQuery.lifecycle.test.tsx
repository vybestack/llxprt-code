/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Integration tests proving the OperationLifecycleRegistry is wired into the
 * real useSubmitQuery turn path (AC-3, AC-4). Uses a real registry + real
 * PerfSink/PerfRetention writing to temp files, and reads the records back
 * through the real tolerant reader. Mocks are limited to external boundaries
 * (runStream, prepareQueryForAgent, event handlers) — the lifecycle, sink, and
 * retention are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import { type RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createDeferred } from './createDeferred.js';
import {
  createLifecycleDeps,
  createMockAgentClient,
  createLifecyclePerfHarness,
  buildLifecycleHookDeps,
  type LifecycleDeps,
} from './lifecyclePerfFixtures.js';

// ─── Module mocks ───────────────────────────────────────────────────────────

// Controllable prepareQueryForAgent result so individual tests can exercise
// the pre-send-abort path without re-mocking the module.
let shouldProceedValue = true;
let queryToSendValue: string | null = 'test-query';
// When non-null, prepareQueryForAgent rejects with this error (P06 prep gap).
let prepareQueryReject: unknown | null = null;
// When non-null, prepareTurnForQuery rejects with this error (P06 prep gap).
let prepareTurnReject: unknown | null = null;
// When non-null, displayUserMessage throws this error (D8 display-error gap).
let displayUserMessageThrowValue: unknown | null = null;

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: vi.fn().mockImplementation((_q: string, _t: number) => {
      if (displayUserMessageThrowValue !== null) {
        throw displayUserMessageThrowValue;
      }
    }),
    prepareQueryForAgent: vi.fn().mockImplementation(() => {
      if (prepareQueryReject !== null) {
        return Promise.reject(prepareQueryReject);
      }
      return Promise.resolve({
        queryToSend: queryToSendValue,
        shouldProceed: shouldProceedValue,
      });
    }),
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
  prepareTurnForQuery: vi.fn().mockImplementation(() => {
    if (prepareTurnReject !== null) {
      return Promise.reject(prepareTurnReject);
    }
    return Promise.resolve(undefined);
  }),
}));

void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
  processSlashCommandResult: vi.fn(),
}));

// dispatchAgentEvent is called inside processAgentEvent; mock it so terminal
// events release the turn gate without requiring full event-handler wiring.
void vi.mock('../agentEventDispatcher.js', () => ({
  dispatchAgentEvent: vi.fn(() => ({ agentMessageBuffer: '' })),
}));

// ─── Lifecycle perf harness ─────────────────────────────────────────────────

const harness = createLifecyclePerfHarness();

function renderUseSubmitQuery(deps: LifecycleDeps) {
  return renderHook(() =>
    useSubmitQuery(buildLifecycleHookDeps(deps, harness.registry)),
  );
}

function drainAndRead() {
  return harness.drainAndRead();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — operation lifecycle integration (AC-3, AC-4)', () => {
  beforeEach(async () => {
    await harness.setup();
    // Reset preparation rejection controls between tests.
    prepareQueryReject = null;
    prepareTurnReject = null;
    shouldProceedValue = true;
    queryToSendValue = 'test-query';
    displayUserMessageThrowValue = null;
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('writes one record with status "completed" when a turn succeeds', async () => {
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await result.current.submitQuery(
        'hello world',
        undefined,
        'sess-1#agentic-loop#uuid-a',
      );
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('completed');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-a');
    expect(records[0].session_operation_index).toBe(0);
  });

  it('writes one record with status "error" when runStream rejects', async () => {
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockRejectedValue(new Error('stream failed')),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await result.current.submitQuery(
        'hello world',
        undefined,
        'sess-1#agentic-loop#uuid-err',
      );
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-err');
  });

  it('writes one record with status "cancelled_before_send" when the turn does not proceed', async () => {
    shouldProceedValue = false;
    queryToSendValue = null;

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await result.current.submitQuery(
        'hello world',
        undefined,
        'sess-1#agentic-loop#uuid-pre',
      );
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_before_send');
  });

  it('finalises a displaced turn as "superseded" exactly once when a newer turn begins', async () => {
    // Turn 1: blocks on a deferred runStream so it stays "active".
    const turn1Deferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turn1Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    // Start turn 1.
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery(
        'turn one',
        undefined,
        'sess-1#agentic-loop#uuid-1',
      );
    });

    // Wait until turn 1's AbortController is installed and isResponding is set.
    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    const turn1Signal = deps.abortControllerRef.current!.signal;

    // Release the interactive turn gate via a terminal event for turn 1.
    // This sets activeTurnRef.current = false while runStream is still pending.
    act(() => {
      result.current.processAgentEvent(
        { type: 'error', message: 'displaced' } as never,
        Date.now(),
        turn1Signal,
      );
    });

    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false]),
    );

    // Turn 2: a new submitQuery call. Because activeTurnRef.current is false
    // and streamingState is Idle, it proceeds immediately. Its begin() sweeps
    // turn 1 as superseded.
    await act(async () => {
      await result.current.submitQuery(
        'turn two',
        undefined,
        'sess-1#agentic-loop#uuid-2',
      );
    });

    // Settle turn 1's deferred (the stale turn's runStream finally settles,
    // but isCurrentTurn is false so its guarded finally does nothing).
    await act(async () => {
      turn1Deferred.resolve();
      await turn1Promise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(2);
    const statuses = records.map((r) => r.status).sort();
    expect(statuses).toStrictEqual(['completed', 'superseded']);
    const superseded = records.find((r) => r.status === 'superseded');
    expect(superseded?.operation_id).toBe('sess-1#agentic-loop#uuid-1');
    const completed = records.find((r) => r.status === 'completed');
    expect(completed?.operation_id).toBe('sess-1#agentic-loop#uuid-2');
  });

  it('writes exactly one record per turn (exactly-once through real control flow)', async () => {
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await result.current.submitQuery(
        'once only',
        undefined,
        'sess-1#agentic-loop#uuid-once',
      );
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('completed');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-once');
  });

  it('produces no perf records when operationLifecycle is absent (perf disabled)', async () => {
    // Create deps without a registry (simulating perf disabled).
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const hookDeps: UseSubmitQueryDeps = {
      runtime: createStreamRuntimeForTest(),
      agent: createMockAgentClient() as unknown as Agent,
      addItem: vi.fn().mockReturnValue(1),
      settings: {} as never,
      onDebugMessage: vi.fn(),
      onCancelSubmit: vi.fn(),
      setTurnCancelled: vi.fn(),
      onAuthError: vi.fn(),
      sanitizeContent: (text: string) => ({ text, blocked: false }),
      flushPendingHistoryItem: vi.fn(),
      pendingResponse: new PendingResponseBuffer(undefined),
      pendingHistoryItemRef: {
        current: null,
      } as React.MutableRefObject<HistoryItemWithoutId | null>,
      thinkingBlocksRef: { current: [] },
      turnCancelledRef: { current: false },
      queuedSubmissionsRef: { current: [] },
      drainSuppressedRef: { current: false },
      enqueueSubmission: vi.fn(),
      enqueueSubmissionFirst: vi.fn(),
      requeueSubmission: vi.fn(),
      dequeueSubmission: vi.fn(),
      clearSubmissions: vi.fn(),
      tryReserveDrain: vi.fn().mockReturnValue(true),
      releaseDrain: vi.fn(),
      setPendingHistoryItem: vi.fn(),
      setIsResponding: vi.fn(),
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
      abortControllerRef: deps.abortControllerRef,
      runStreamRef: deps.runStreamRef,
      submitQueryRef: { current: null },
      isResponding: false,
      streamingState: StreamingState.Idle,
      recordingIntegration: {
        flushAtTurnBoundary: vi.fn(),
      } as unknown as RecordingIntegration,
      // operationLifecycle intentionally omitted — perf disabled.
    };

    const { result } = renderHook(() => useSubmitQuery(hookDeps));

    await act(async () => {
      await result.current.submitQuery(
        'disabled',
        undefined,
        'sess-1#agentic-loop#uuid-dis',
      );
    });

    // drainAndRead disposes the harness sink; the disabled turn wrote no
    // records because operationLifecycle was omitted.
    const records = await drainAndRead();
    expect(records).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // P06: preparation rejections must finalise as 'error' exactly once
  // (AC-4). The original rejection is preserved to the caller/UI.
  // -------------------------------------------------------------------------

  it('finalises as "error" when prepareQueryForAgent rejects (preserves rejection)', async () => {
    const prepError = new Error('query preparation failed');
    prepareQueryReject = prepError;

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    // The original rejection must propagate to the caller (not swallowed or
    // replaced by an instrumentation error).
    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-prep-rej',
        ),
      ).rejects.toThrow('query preparation failed');
    });

    // The op must be finalised exactly once as 'error'.
    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-prep-rej');
  });

  it('finalises as "error" when prepareTurnForQuery rejects (preserves rejection)', async () => {
    const turnError = new Error('turn preparation failed');
    prepareTurnReject = turnError;

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-turn-rej',
        ),
      ).rejects.toThrow('turn preparation failed');
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-turn-rej');
  });

  it('finalises as "error" exactly once when displayUserMessage throws (working sink)', async () => {
    displayUserMessageThrowValue = new Error('display failed');

    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-display-throw',
        ),
      ).rejects.toThrow('display failed');
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].operation_id).toBe(
      'sess-1#agentic-loop#uuid-display-throw',
    );
  });

  it('finalises once and clears responding state when post-begin setup throws', async () => {
    const setupError = new Error('committed-segment setup failed');
    const runStream = vi.fn().mockResolvedValue(undefined);
    const deps = createLifecycleDeps({
      runStreamRef: { current: runStream } as never,
    });
    vi.spyOn(deps.pendingResponse, 'beginCommittedSegments').mockImplementation(
      () => {
        throw setupError;
      },
    );

    const { result } = renderUseSubmitQuery(deps);

    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-post-begin',
        ),
      ).rejects.toBe(setupError);
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-post-begin');
    expect(deps.setIsRespondingCalls).toEqual([true, false]);
    expect(runStream).not.toHaveBeenCalled();
  });
});
