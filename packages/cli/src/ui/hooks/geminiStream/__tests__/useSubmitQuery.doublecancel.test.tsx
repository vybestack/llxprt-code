/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test for issue #2259: "double cancellation still an issue."
 *
 * When a user cancels a turn (ESC) and then submits a new prompt, the
 * cancelled turn's stale `runSubmitQueryCore` finally block must NOT call
 * `setIsResponding(false)` — that would clobber the new turn's
 * `isResponding(true)` state, making the new turn appear cancelled.
 *
 * The fix: `runSubmitQueryCore`'s finally and `executeStream`'s post-runLoop
 * logic compare the turn's AbortSignal against the current
 * `abortControllerRef.current?.signal`. If they differ, a newer turn has
 * superseded this one and the stale turn must not mutate shared React state.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery } from '../useSubmitQuery.js';
import { StreamingState } from '../../../types.js';
import {
  type Config,
  type AgentClientContract,
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — double-cancel guard (issue #2259)', () => {
  it("does not call setIsResponding(false) from a superseded turn's finally", async () => {
    // Two deferred runLoop promises so we control exactly when each turn's
    // executeStream settles.
    const turn1Deferred = createDeferred<void>();
    const turn2Deferred = createDeferred<void>();

    const setIsRespondingCalls: boolean[] = [];
    const setIsResponding = createMockSetState(setIsRespondingCalls);

    const abortControllerRef = {
      current: null as AbortController | null,
    };

    // The mock runLoop returns turn1's deferred on the first call and turn2's
    // deferred on the second, matching the two submitQuery calls below.
    const runLoopRef = {
      current: vi
        .fn()
        .mockReturnValueOnce(turn1Deferred.promise)
        .mockReturnValueOnce(turn2Deferred.promise),
    };

    const { result } = renderHook(() =>
      useSubmitQuery({
        config: createMockConfig(),
        agentClient: createMockAgentClient(),
        addItem: vi.fn().mockReturnValue(1),
        settings: {} as never,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        onAuthError: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef: { current: null },
        thinkingBlocksRef: { current: [] },
        turnCancelledRef: { current: false },
        queuedSubmissionsRef: { current: [] },
        setPendingHistoryItem: vi.fn(),
        setIsResponding,
        setInitError: vi.fn(),
        setThought: vi.fn(),
        setLastGeminiActivityTime: vi.fn(),
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
        abortControllerRef,
        runLoopRef,
        submitQueryRef: { current: null },
        isResponding: false,
        streamingState: StreamingState.Idle,
        recordingIntegration: undefined,
      }),
    );

    // ── Turn 1: starts, setIsResponding(true) ──────────────────────────────
    let turn1Promise!: Promise<void>;
    await act(async () => {
      turn1Promise = result.current.submitQuery('turn-1');
    });

    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true]);
    });

    // ── Turn 2: starts while Turn 1's runLoop is still pending ─────────────
    // initTurn replaces abortControllerRef.current with a NEW AbortController,
    // so Turn 1's signal no longer matches the current one.
    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });

    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true, true]);
    });

    // ── Turn 1's runLoop settles ───────────────────────────────────────────
    // Turn 1's finally must NOT call setIsResponding(false) because Turn 2
    // has superseded it (different AbortController).
    await act(async () => {
      turn1Deferred.resolve();
    });

    // With the fix: no extra false call. Without the fix: [true, true, false].
    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true, true]);
    });

    // ── Turn 2's runLoop settles ───────────────────────────────────────────
    // Turn 2 IS the current turn, so its finally correctly calls
    // setIsResponding(false).
    await act(async () => {
      turn2Deferred.resolve();
    });

    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true, true, false]);
    });

    // Clean up: ensure both promises resolve without unhandled rejections.
    await act(async () => {
      await turn1Promise.catch(() => {});
      await turn2Promise.catch(() => {});
    });
  });

  it('calls setIsResponding(false) from the finally when the turn is still current', async () => {
    // Single turn that runs to completion: setIsResponding should go
    // true → false normally. This proves the guard does not break the
    // normal (non-superseded) path.
    const runDeferred = createDeferred<void>();

    const setIsRespondingCalls: boolean[] = [];
    const setIsResponding = createMockSetState(setIsRespondingCalls);

    const abortControllerRef = {
      current: null as AbortController | null,
    };

    const runLoopRef = {
      current: vi.fn().mockReturnValueOnce(runDeferred.promise),
    };

    const { result } = renderHook(() =>
      useSubmitQuery({
        config: createMockConfig(),
        agentClient: createMockAgentClient(),
        addItem: vi.fn().mockReturnValue(1),
        settings: {} as never,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        onAuthError: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef: { current: null },
        thinkingBlocksRef: { current: [] },
        turnCancelledRef: { current: false },
        queuedSubmissionsRef: { current: [] },
        setPendingHistoryItem: vi.fn(),
        setIsResponding,
        setInitError: vi.fn(),
        setThought: vi.fn(),
        setLastGeminiActivityTime: vi.fn(),
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
        abortControllerRef,
        runLoopRef,
        submitQueryRef: { current: null },
        isResponding: false,
        streamingState: StreamingState.Idle,
        recordingIntegration: undefined,
      }),
    );

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('single-turn');
    });

    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true]);
    });

    await act(async () => {
      runDeferred.resolve();
    });

    await waitFor(() => {
      expect(setIsRespondingCalls).toStrictEqual([true, false]);
    });

    await act(async () => {
      await turnPromise.catch(() => {});
    });
  });
});
