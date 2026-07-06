/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2379: "Bun nightly glm profile hangs before
 * provider request and shows fallback Gemini model."
 *
 * Acceptance criterion covered here: "If provider activation/auth fails before
 * the request is opened, the UI must reset out of Responding and show the
 * error" and "pre-request activation failures cannot leave isResponding stuck."
 *
 * When the engine-owned loop (runLoop) rejects for the CURRENT turn — e.g. a
 * load-balancer sub-profile's auth/activation throws before any provider socket
 * opens — `runSubmitQueryCore` must:
 *   1. surface the error via `handleSubmissionError` (so the user sees it), and
 *   2. clear `isResponding` in its `finally` (so the UI is not stuck spinning).
 *
 * These tests exercise the real `useSubmitQuery` turn lifecycle with a stubbed
 * runLoop, so they prove the isResponding/error-surfacing guarantee without
 * live provider networking.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import {
  type AgentClientContract,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
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

// Mock streamUtils so we can assert whether handleSubmissionError is called
// (i.e. the activation error is surfaced to the user).
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

interface ActivationFailureDeps {
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
  onAuthError: ReturnType<typeof vi.fn>;
  addItem: ReturnType<typeof vi.fn>;
}

function createDeps(
  options?: Partial<ActivationFailureDeps>,
): ActivationFailureDeps {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding:
      options?.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef:
      options?.abortControllerRef ??
      ({ current: null as AbortController | null } as never),
    runStreamRef: options?.runStreamRef ?? ({ current: null } as never),
    loopDetectedRef: options?.loopDetectedRef ?? ({ current: false } as never),
    onAuthError: options?.onAuthError ?? vi.fn(),
    addItem: options?.addItem ?? vi.fn().mockReturnValue(1),
  };
}

function renderUseSubmitQuery(deps: ActivationFailureDeps) {
  // Assemble the hook deps as an explicitly-typed UseSubmitQueryDeps constant
  // rather than an inline call-site object literal. This keeps the props type
  // anchored to the imported interface and avoids fresh-object-literal
  // excess-property checks that can misfire under incremental typecheck caches.
  const hookDeps: UseSubmitQueryDeps = {
    runtime: createStreamRuntimeForTest(),
    agent: createMockAgentClient() as unknown as Agent,
    addItem: deps.addItem,
    settings: {} as never,
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    onAuthError: deps.onAuthError,
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    queuedSubmissionsRef: { current: [] },
    setPendingHistoryItem: vi.fn(),
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
    streamingState: StreamingState.Idle,
    recordingIntegration: {
      flushAtTurnBoundary: vi.fn(),
    } as unknown as RecordingIntegration,
  };
  return renderHook(() => useSubmitQuery(hookDeps));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — pre-request activation failure (issue #2379)', () => {
  it('clears isResponding when the current turn runLoop rejects before any provider request', async () => {
    const runDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(runDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('activate-glm');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    // Simulate a load-balancer sub-profile activation/auth failure that throws
    // before any provider socket is opened.
    await act(async () => {
      runDeferred.reject(new Error('provider activation failed: no auth'));
    });

    // isResponding must be reset to false — the UI must not stay stuck spinning.
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false]),
    );

    await act(async () => {
      await turnPromise.catch(() => {});
    });
  });

  it('surfaces the activation error via handleSubmissionError for the current turn', async () => {
    handleSubmissionErrorMock.mockClear();
    const runDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(runDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('activate-glm');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    const activationError = new Error('provider activation failed: no auth');
    await act(async () => {
      runDeferred.reject(activationError);
    });

    // The error must be surfaced (not swallowed) so the user sees it instead
    // of an indefinite Responding spinner.
    await waitFor(() =>
      expect(handleSubmissionErrorMock).toHaveBeenCalledTimes(1),
    );
    expect(handleSubmissionErrorMock).toHaveBeenCalledWith(
      activationError,
      expect.any(Function),
      expect.any(Object), // config must be a real object, not undefined/null
      expect.any(Function),
      expect.any(Number),
    );
    // A generic (non-auth) activation error must NOT trigger the auth-error
    // re-login flow directly from runSubmitQueryCore.
    expect(deps.onAuthError).not.toHaveBeenCalled();
    // And isResponding is still reset.
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false]),
    );

    await act(async () => {
      await turnPromise.catch(() => {});
    });
  });

  it('wires onAuthError into handleSubmissionError so an auth activation failure can trigger re-login', async () => {
    // The issue calls out "a load-balancer sub-profile's auth/activation
    // throws". handleSubmissionError owns the auth-classification (verified in
    // streamUtils.test.ts); here we prove runSubmitQueryCore forwards the real
    // onAuthError callback so an auth failure actually reaches the re-login
    // flow. The mock stands in for the auth branch by invoking the callback it
    // receives, exercising the end-to-end wiring rather than the mock itself.
    handleSubmissionErrorMock.mockClear();
    handleSubmissionErrorMock.mockImplementation(
      (
        _error: unknown,
        _addItem: unknown,
        _config: unknown,
        onAuthError: () => void,
      ) => {
        onAuthError();
        return true;
      },
    );

    const runDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(runDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('activate-glm');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    await act(async () => {
      runDeferred.reject(new Error('Unauthorized: token expired'));
    });

    // The forwarded onAuthError callback must have been invoked, and the UI
    // must still reset out of Responding.
    await waitFor(() => expect(deps.onAuthError).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true, false]),
    );

    await act(async () => {
      await turnPromise.catch(() => {});
    });

    handleSubmissionErrorMock.mockReset();
  });
});
