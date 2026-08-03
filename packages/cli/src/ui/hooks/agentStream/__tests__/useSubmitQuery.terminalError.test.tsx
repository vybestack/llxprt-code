/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for issue #2954: "Prompts queue after a terminal stream
 * error."
 *
 * When the public Agent stream emits a terminal `error` or `idle-timeout`
 * event, the event is routed synchronously through `processAgentEvent` while
 * the underlying `runStream()` promise (and thus the outer submission
 * `finally`) may remain unsettled. Until that `finally` runs,
 * `activeTurnRef.current` stays `true`, so `useSubmitQueryCallback` queues
 * any follow-up submission instead of executing it.
 *
 * The fix: at the terminal `error`/`idle-timeout` event boundary, synchronously
 * release interactive active-turn ownership and leave the responding state.
 * The outer `finally` must additionally guard cleanup with current-turn
 * ownership so stale cleanup cannot clobber a newer turn.
 *
 * These tests exercise the REAL `useSubmitQuery` event-routing/submission
 * lifecycle (real `useStreamEventHandlers`, real `dispatchAgentEvent`). Only
 * leaf infrastructure (`turnPreparation`, `SessionContext`) is stubbed.
 */

import { describe, it, expect, vi } from 'vitest';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import {
  useSubmitQuery,
  type SubmissionExecutor,
  type UseSubmitQueryDeps,
} from '../useSubmitQuery.js';
import {
  StreamingState,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type { StructuredError } from '@vybestack/llxprt-code-core';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { LoadedSettings } from '../../../../config/settings.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred } from './createDeferred.js';
import { createFakeAgentFromMockClient } from '../../useAgentStream-test-helpers.js';
import type { StreamRuntime } from '../../../cliUiRuntime.js';

vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

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
    clearSubmissions: () => void (ref.current = []),
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

function createLoadedSettings(): LoadedSettings {
  return new LoadedSettings(
    { path: '/system/settings.json', settings: {} },
    { path: '/system/defaults.json', settings: {} },
    { path: '/user/settings.json', settings: {} },
    { path: '/workspace/settings.json', settings: {} },
    true,
  );
}

const SAMPLE_ERROR: StructuredError = {
  message: 'First-response timeout.',
  status: 503,
};

function terminalEvents(): Array<{
  label: string;
  event: AgentEvent;
  clearQueue: boolean;
}> {
  return [
    {
      label: 'error',
      event: { type: 'error', error: SAMPLE_ERROR },
      clearQueue: true,
    },
    {
      label: 'idle-timeout',
      event: { type: 'idle-timeout', error: SAMPLE_ERROR },
      clearQueue: false,
    },
  ];
}

interface TerminalErrorDeps {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: UseSubmitQueryDeps['runStreamRef'];
  loopDetectedRef: React.MutableRefObject<boolean>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  flushPendingHistoryItem: ReturnType<typeof vi.fn>;
  setPendingHistoryItem: ReturnType<typeof vi.fn>;
}

function createDeps(
  options: Partial<TerminalErrorDeps> = {},
): TerminalErrorDeps {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding:
      options.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef: options.abortControllerRef ?? { current: null },
    runStreamRef: options.runStreamRef ?? { current: null },
    loopDetectedRef: options.loopDetectedRef ?? { current: false },
    pendingHistoryItemRef: options.pendingHistoryItemRef ?? { current: null },
    flushPendingHistoryItem: options.flushPendingHistoryItem ?? vi.fn(),
    setPendingHistoryItem: options.setPendingHistoryItem ?? vi.fn(),
  };
}

interface SubmitQueryOverrides {
  queuedSubmissionsRef?: React.MutableRefObject<QueuedSubmission[]>;
  queueOperations?: ReturnType<typeof createQueueOperations>;
  tryReserveDrain?: () => boolean;
  releaseDrain?: () => void;
  submitQueryRef?: React.MutableRefObject<SubmissionExecutor | null>;
  addItem?: UseSubmitQueryDeps['addItem'];
  turnCancelledRef?: React.MutableRefObject<boolean>;
  drainSuppressedRef?: React.MutableRefObject<boolean>;
  handleSlashCommand?: UseSubmitQueryDeps['handleSlashCommand'];
  runtime?: StreamRuntime;
}

interface RenderOptions {
  initialStreamingState?: StreamingState;
}

function createUseSubmitQueryDeps(
  deps: TerminalErrorDeps,
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
    recordingIntegration: undefined,
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
    handleSlashCommand:
      overrides.handleSlashCommand ?? vi.fn().mockResolvedValue(false),
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
  deps: TerminalErrorDeps,
  overrides: SubmitQueryOverrides = {},
  options: RenderOptions = {},
) {
  const getDeps = createUseSubmitQueryDeps(deps, overrides);
  return renderHook(
    ({ streamingState }: { streamingState: StreamingState }) =>
      useSubmitQuery(getDeps(streamingState)),
    {
      initialProps: {
        streamingState: options.initialStreamingState ?? StreamingState.Idle,
      },
    },
  );
}

async function startTurnAndRouteTerminalEvent(
  result: { current: ReturnType<typeof useSubmitQuery> },
  rerender: (props: { streamingState: StreamingState }) => void,
  deps: TerminalErrorDeps,
  event: AgentEvent,
): Promise<AbortSignal> {
  await act(async () => {
    void result.current.submitQuery('turn-1');
  });
  await waitFor(() => expect(deps.setIsRespondingCalls).toStrictEqual([true]));

  rerender({ streamingState: StreamingState.Responding });

  const activeSignal = deps.abortControllerRef.current!.signal;

  await act(async () => {
    result.current.processAgentEvent(event, Date.now(), activeSignal);
  });

  rerender({ streamingState: StreamingState.Idle });

  return activeSignal;
}

describe('useSubmitQuery — terminal error release (issue #2954)', () => {
  describe.each(terminalEvents())(
    'terminal $label event',
    ({ event, clearQueue }) => {
      it('synchronously releases responding state at the terminal boundary (AC1)', async () => {
        const turnDeferred = createDeferred<void>();
        const deps = createDeps({
          runStreamRef: {
            current: vi.fn(() => turnDeferred.promise),
          },
        });
        const { result, rerender } = renderUseSubmitQuery(deps);

        await startTurnAndRouteTerminalEvent(result, rerender, deps, event);

        expect(deps.setIsRespondingCalls).toContain(false);

        await act(async () => {
          turnDeferred.resolve();
        });
      });

      it('allows a slash command to execute immediately rather than queuing (AC2)', async () => {
        const turnDeferred = createDeferred<void>();
        const commandEffect: string[] = [];
        const extractText = (cmd: unknown): string => {
          if (typeof cmd === 'string') return cmd;
          if (Array.isArray(cmd)) {
            return cmd
              .map((p) => {
                if (
                  typeof p === 'object' &&
                  p !== null &&
                  'text' in p &&
                  typeof (p as { text: unknown }).text === 'string'
                ) {
                  return (p as { text: string }).text;
                }
                return '';
              })
              .join('');
          }
          return '';
        };
        const handleSlashCommand = vi.fn(
          async (cmd: unknown): Promise<SlashCommandProcessorResult> => {
            commandEffect.push(`executed:${extractText(cmd)}`);
            return { type: 'handled' };
          },
        );
        const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
        const queueOperations = createQueueOperations(queuedSubmissionsRef);
        const deps = createDeps({
          runStreamRef: {
            current: vi.fn(() => turnDeferred.promise),
          },
        });
        const { result, rerender } = renderUseSubmitQuery(deps, {
          handleSlashCommand,
          queuedSubmissionsRef,
          queueOperations,
        });

        await startTurnAndRouteTerminalEvent(result, rerender, deps, event);

        await act(async () => {
          await result.current.submitQuery('/profile load opus5');
        });

        expect(commandEffect).toContain('executed:/profile load opus5');
        expect(
          (deps.runStreamRef.current as ReturnType<typeof vi.fn>).mock.calls
            .length,
        ).toBe(1);
        expect(queuedSubmissionsRef.current).toHaveLength(0);

        await act(async () => {
          turnDeferred.resolve();
        });
      });

      it('accepts an ordinary prompt as a fresh submission rather than queuing (AC3)', async () => {
        const turnDeferred = createDeferred<void>();
        const secondTurnDeferred = createDeferred<void>();
        let runStreamCallCount = 0;
        const runStreamRef = {
          current: vi.fn(() => {
            runStreamCallCount += 1;
            return runStreamCallCount === 1
              ? turnDeferred.promise
              : secondTurnDeferred.promise;
          }),
        };
        const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
        const queueOperations = createQueueOperations(queuedSubmissionsRef);
        const deps = createDeps({ runStreamRef });
        const { result, rerender } = renderUseSubmitQuery(deps, {
          queuedSubmissionsRef,
          queueOperations,
        });

        await startTurnAndRouteTerminalEvent(result, rerender, deps, event);

        let followUpPromise!: Promise<void>;
        await act(async () => {
          followUpPromise = result.current.submitQuery('follow-up prompt');
          await Promise.resolve();
        });

        expect(runStreamCallCount).toBe(2);
        expect(queuedSubmissionsRef.current).toHaveLength(0);

        await act(async () => {
          turnDeferred.resolve();
          secondTurnDeferred.resolve();
          await followUpPromise;
        });
      });

      it(`${clearQueue ? 'clears' : 'preserves'} the queue per existing semantics (AC6)`, async () => {
        const turnDeferred = createDeferred<void>();
        const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
        const queueOperations = createQueueOperations(queuedSubmissionsRef);
        const deps = createDeps({
          runStreamRef: {
            current: vi.fn(() => turnDeferred.promise),
          },
        });
        const { result, rerender } = renderUseSubmitQuery(deps, {
          queuedSubmissionsRef,
          queueOperations,
        });

        let turn1Promise!: Promise<void>;
        await act(async () => {
          turn1Promise = result.current.submitQuery('turn-1');
          await Promise.resolve();
        });
        rerender({ streamingState: StreamingState.Responding });
        queuedSubmissionsRef.current = [
          { query: 'pre-queued-1' },
          { query: 'pre-queued-2' },
        ];
        const activeSignal = deps.abortControllerRef.current!.signal;

        await act(async () => {
          result.current.processAgentEvent(event, Date.now(), activeSignal);
        });

        const expectedLength = clearQueue ? 0 : 2;
        expect(queuedSubmissionsRef.current).toHaveLength(expectedLength);

        await act(async () => {
          turnDeferred.resolve();
          await turn1Promise;
        });
      });
    },
  );

  it('does not release ownership for a genuinely active turn before any terminal event (AC5)', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createDeps({
      runStreamRef: { current: vi.fn(() => turnDeferred.promise) },
    });
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const { result, rerender } = renderUseSubmitQuery(deps, {
      queuedSubmissionsRef,
      queueOperations,
    });

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('turn-1');
    });
    rerender({ streamingState: StreamingState.Responding });

    await act(async () => {
      await result.current.submitQuery('should-queue');
    });

    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(queuedSubmissionsRef.current[0]?.query).toBe('should-queue');

    await act(async () => {
      turnDeferred.resolve();
      await turnPromise;
    });
  });

  it('stale terminal events and cleanup cannot mutate a newer turn (AC4)', async () => {
    const firstTurnDeferred = createDeferred<void>();
    const secondTurnDeferred = createDeferred<void>();
    const addItem = vi.fn().mockReturnValue(1);
    let runStreamCallCount = 0;
    const runStreamRef = {
      current: vi.fn(() => {
        runStreamCallCount += 1;
        return runStreamCallCount === 1
          ? firstTurnDeferred.promise
          : secondTurnDeferred.promise;
      }),
    };
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const deps = createDeps({ runStreamRef });
    const { result, rerender } = renderUseSubmitQuery(deps, {
      queuedSubmissionsRef,
      queueOperations,
      addItem,
    });

    const firstSignal = await startTurnAndRouteTerminalEvent(
      result,
      rerender,
      deps,
      { type: 'error', error: SAMPLE_ERROR },
    );

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
    });
    rerender({ streamingState: StreamingState.Responding });

    const secondSignal = deps.abortControllerRef.current!.signal;
    expect(secondSignal).not.toBe(firstSignal);

    const setIsRespondingCallsBefore = [...deps.setIsRespondingCalls];
    const addItemCallsBefore = addItem.mock.calls.length;

    await act(async () => {
      result.current.processAgentEvent(
        { type: 'idle-timeout', error: SAMPLE_ERROR },
        Date.now(),
        firstSignal,
      );
    });
    expect(deps.abortControllerRef.current?.signal).toBe(secondSignal);
    expect(deps.setIsRespondingCalls).toStrictEqual(setIsRespondingCallsBefore);
    expect(addItem).toHaveBeenCalledTimes(addItemCallsBefore);

    await act(async () => {
      firstTurnDeferred.resolve();
    });

    expect(deps.abortControllerRef.current?.signal).toBe(secondSignal);

    await act(async () => {
      await result.current.submitQuery('turn-3-should-queue');
    });
    expect(queuedSubmissionsRef.current).toHaveLength(1);
    expect(queuedSubmissionsRef.current[0]?.query).toBe('turn-3-should-queue');

    expect(deps.setIsRespondingCalls).toStrictEqual(setIsRespondingCallsBefore);

    await act(async () => {
      secondTurnDeferred.resolve();
      await turn2Promise;
    });
  });

  it('releases the gate before fallible dispatch so a rendering throw cannot lock it (Finding 1)', async () => {
    const turnDeferred = createDeferred<void>();
    let dispatchThrowing = false;
    const throwingAddItem = vi.fn(() => {
      if (dispatchThrowing) {
        throw new Error('rendering explosion');
      }
      return 1;
    });
    const deps = createDeps({
      runStreamRef: { current: vi.fn(() => turnDeferred.promise) },
    });
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const { result, rerender } = renderUseSubmitQuery(deps, {
      queuedSubmissionsRef,
      queueOperations,
      addItem: throwingAddItem,
    });

    await act(async () => {
      void result.current.submitQuery('turn-1');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );
    rerender({ streamingState: StreamingState.Responding });
    queuedSubmissionsRef.current = [
      { query: 'pre-queued-1' },
      { query: 'pre-queued-2' },
    ];
    const activeSignal = deps.abortControllerRef.current!.signal;

    dispatchThrowing = true;
    await act(async () => {
      expect(() =>
        result.current.processAgentEvent(
          { type: 'error', error: SAMPLE_ERROR },
          Date.now(),
          activeSignal,
        ),
      ).toThrow('rendering explosion');
    });

    expect(deps.setIsRespondingCalls).toContain(false);
    expect(queuedSubmissionsRef.current).toHaveLength(0);
    rerender({ streamingState: StreamingState.Idle });
    dispatchThrowing = false;
    let followUpPromise!: Promise<void>;
    await act(async () => {
      followUpPromise = result.current.submitQuery('follow-up');
      await Promise.resolve();
    });
    expect(queuedSubmissionsRef.current).toHaveLength(0);

    await act(async () => {
      turnDeferred.resolve();
      await followUpPromise;
    });
  });

  it('releases ownership when initialization throws after controller installation (Finding 2)', async () => {
    let getSessionIdCallCount = 0;
    const overrides = {
      ...createMockOverrides(),
      session: {
        getSessionId: () => {
          getSessionIdCallCount += 1;
          if (getSessionIdCallCount === 1) {
            throw new Error('session init explosion');
          }
          return 'test-session';
        },
      },
    };
    const explodingRuntime = createStreamRuntimeForTest({}, overrides);
    const secondTurnDeferred = createDeferred<void>();
    let runStreamCallCount = 0;
    const runStreamRef = {
      current: vi.fn(() => {
        runStreamCallCount += 1;
        return secondTurnDeferred.promise;
      }),
    };
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const queueOperations = createQueueOperations(queuedSubmissionsRef);
    const deps = createDeps({ runStreamRef });
    const { result } = renderUseSubmitQuery(
      deps,
      {
        queuedSubmissionsRef,
        queueOperations,
        runtime: explodingRuntime,
      },
      { initialStreamingState: StreamingState.Idle },
    );

    await act(async () => {
      await expect(result.current.submitQuery('turn-1')).rejects.toThrow(
        'session init explosion',
      );
    });

    let secondPromise!: Promise<void>;
    await act(async () => {
      secondPromise = result.current.submitQuery('turn-2');
      await Promise.resolve();
    });
    expect(queuedSubmissionsRef.current).toHaveLength(0);
    expect(runStreamCallCount).toBe(1);

    await act(async () => {
      secondTurnDeferred.resolve();
      await secondPromise;
    });
  });
});
