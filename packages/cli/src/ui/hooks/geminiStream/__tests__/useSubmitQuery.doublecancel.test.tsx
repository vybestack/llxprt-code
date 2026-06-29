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
import { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import {
  type Config,
  type AgentClientContract,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';

// ─── Module mocks ───────────────────────────────────────────────────────────
// useSubmitQuery internally calls useStreamEventHandlers and useSessionStats.
// We stub them so the test can isolate the turn-lifecycle / finally logic.

vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: vi.fn(),
    prepareQueryForGemini: vi
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

vi.mock('../useGeminiStream.js', () => ({
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

function createMockConfig(): Config {
  return {
    getSessionId: () => 'test-session',
    getModel: () => 'test-model',
    getMcpClientManager: () => undefined,
    getMcpServers: () => ({}),
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    setupAsyncTaskAutoTrigger: () => () => {},
  } as unknown as Config;
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
  runLoopRef: React.MutableRefObject<
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
    runLoopRef: options?.runLoopRef ?? ({ current: null } as never),
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
  },
) {
  return renderHook(() =>
    useSubmitQuery({
      config: createMockConfig(),
      agentClient: createMockAgentClient(),
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
      queuedSubmissionsRef: { current: [] },
      setPendingHistoryItem: deps.setPendingHistoryItem,
      setIsResponding: deps.setIsResponding,
      setInitError: vi.fn(),
      setThought: vi.fn(),
      setLastGeminiActivityTime: vi.fn(),
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
      runLoopRef: deps.runLoopRef,
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
  it("does not call setIsResponding(false) from a superseded turn's finally", async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, true]),
    );

    // Turn 1 settles — finally must NOT clobber Turn 2.
    await act(async () => {
      turn1Deferred.resolve();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, true]),
    );

    // Turn 2 settles — finally correctly resets.
    await act(async () => {
      turn2Deferred.resolve();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, true, false]),
    );

    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('does not call flushPendingHistoryItem or setPendingHistoryItem from a superseded turn', async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });
    // Make Turn 1 appear to have a pending history item so the post-runLoop
    // flush path is reached if the guard is missing.
    deps.pendingHistoryItemRef.current = { type: 'info', text: 'pending' };

    const { result } = renderUseSubmitQuery(deps);

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });

    await act(async () => {
      turn1Deferred.resolve();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, true]),
    );

    // Turn 1 was superseded: flushPendingHistoryItem must NOT have been called
    // for its timestamp. Turn 2 hasn't settled yet so no flush for it either.
    expect(deps.flushPendingHistoryItem).not.toHaveBeenCalled();
    expect(deps.setPendingHistoryItem).not.toHaveBeenCalledWith(null);

    await act(async () => {
      turn2Deferred.resolve();
    });
    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('clears stale loopDetectedRef on supersession without firing handleLoopDetectedEvent', async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });

    // Simulate the loop-detected flag being set during Turn 1's run.
    deps.loopDetectedRef.current = true;

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });

    await act(async () => {
      turn1Deferred.resolve();
    });

    // The stale flag must be cleared silently so it does not leak into Turn 2,
    // but handleLoopDetectedEvent must NOT fire for the superseded turn.
    await waitFor(() => {
      expect(deps.loopDetectedRef.current).toBe(false);
    });
    expect(deps.handleLoopDetectedEvent).not.toHaveBeenCalled();

    await act(async () => {
      turn2Deferred.resolve();
    });
    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('does not call handleSubmissionError from a superseded turn', async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });

    // Reject Turn 1's runLoop — this simulates an error (e.g. AbortError)
    // from a cancelled turn. The catch guard must suppress it.
    handleSubmissionErrorMock.mockClear();
    const turn1Error = new Error('Turn 1 aborted');
    await act(async () => {
      turn1Deferred.reject(turn1Error);
    });

    // Turn 1 was superseded: the catch guard must prevent
    // handleSubmissionError from being called, so the error does not surface
    // as a user-facing message.
    expect(handleSubmissionErrorMock).not.toHaveBeenCalled();
    expect(deps.setIsRespondingCalls).toStrictEqual([true, true]);

    await act(async () => {
      turn2Deferred.resolve();
    });
    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('does not call recordingIntegration.flushAtTurnBoundary from a superseded turn', async () => {
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });

    await act(async () => {
      turn1Deferred.resolve();
    });

    // Turn 1 was superseded: its finally must not flush the recording boundary.
    expect(deps.flushAtTurnBoundarySpy).not.toHaveBeenCalled();

    await act(async () => {
      turn2Deferred.resolve();
    });

    // Turn 2 IS current: its finally should flush.
    await waitFor(() =>
      expect(deps.flushAtTurnBoundarySpy).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('simulates ESC cancel then new prompt: superseded turn does not clobber the new turn', async () => {
    // This test mirrors the real user flow from issue #2259:
    // 1. Start Turn 1 (runLoop blocks)
    // 2. User hits ESC → cancelOngoingRequest aborts Turn 1's controller
    //    and calls setIsResponding(false)
    // 3. User submits Turn 2 → initTurn creates a fresh controller
    // 4. Turn 1's runLoop settles (async cleanup finishes)
    // 5. Turn 1's finally must NOT call setIsResponding(false)
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const deps = createDeps({
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    // ── Step 1: Turn 1 starts ──────────────────────────────────────────────
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    const turn1Controller = deps.abortControllerRef.current;
    expect(turn1Controller).not.toBeNull();

    // ── Step 2: User hits ESC ──────────────────────────────────────────────
    // cancelOngoingRequest (in useGeminiStreamLifecycle) would:
    //   - abort the controller
    //   - setIsResponding(false)
    //   - set turnCancelledRef.current = true
    await act(async () => {
      turn1Controller!.abort();
      deps.setIsResponding(false);
    });
    expect(deps.setIsRespondingCalls).toStrictEqual([true, false]);

    // ── Step 3: User submits Turn 2 ────────────────────────────────────────
    // initTurn creates a NEW AbortController and resets turnCancelledRef.
    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false, true]),
    );

    // The current AbortController is now Turn 2's, not Turn 1's.
    expect(deps.abortControllerRef.current).not.toBe(turn1Controller);

    // ── Step 4: Turn 1's async cleanup settles ─────────────────────────────
    await act(async () => {
      turn1Deferred.resolve();
    });

    // Turn 1's finally must NOT call setIsResponding(false) — that would
    // cancel the new turn (issue #2259).
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false, true]),
    );

    // ── Step 5: Turn 2 finishes ────────────────────────────────────────────
    await act(async () => {
      turn2Deferred.resolve();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([
        true,
        false,
        true,
        false,
      ]),
    );

    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
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
      runLoopRef: {
        current: vi
          .fn()
          .mockReturnValueOnce(turn1Deferred.promise)
          .mockReturnValueOnce(turn2Deferred.promise),
      } as never,
    });

    const queuedSubmissionsRef = {
      current: [] as Array<{
        query: string;
        options?: { isContinuation: boolean };
        promptId?: string;
      }>,
    };

    const { result, rerender } = renderHook(
      ({ streamingState }: { streamingState: StreamingState }) =>
        useSubmitQuery({
          config: createMockConfig(),
          agentClient: createMockAgentClient(),
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
          setPendingHistoryItem: deps.setPendingHistoryItem,
          setIsResponding: deps.setIsResponding,
          setInitError: vi.fn(),
          setThought: vi.fn(),
          setLastGeminiActivityTime: vi.fn(),
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
          runLoopRef: deps.runLoopRef,
          submitQueryRef: { current: null },
          isResponding: false,
          streamingState,
          recordingIntegration: {
            flushAtTurnBoundary: deps.flushAtTurnBoundarySpy,
          } as unknown as RecordingIntegration,
        }),
      { initialProps: { streamingState: StreamingState.Idle } },
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
      turn1Controller!.abort();
    });
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
      runLoopRef: {
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
});
