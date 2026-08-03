/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import React, { act, useState } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import {
  useSubmitQuery,
  type SubmissionExecutor,
  type UseSubmitQueryDeps,
} from '../useSubmitQuery.js';
import {
  useAgentEventStream,
  type AgentEventRouter,
} from '../useAgentEventStream.js';
import {
  StreamingState,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../../types.js';
import type { QueuedSubmission } from '../types.js';
import type {
  AgentEvent,
  Agent,
  AgentInput,
} from '@vybestack/llxprt-code-agents';
import type { StructuredError } from '@vybestack/llxprt-code-core';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred, type Deferred } from './createDeferred.js';
import { createFakeAgentFromMockClient } from '../../useAgentStream-test-helpers.js';
import type { StreamRuntime } from '../../../cliUiRuntime.js';
import { useStreamingState } from '../useAgentStreamLifecycle.js';
import {
  createLoadedSettings,
  createMockOverrides,
  createQueueOperations,
} from './submitQueryTestFixtures.js';

vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

const SAMPLE_ERROR: StructuredError = {
  message: 'stream failed',
  status: 500,
};

const TERMINAL_EVENTS: readonly AgentEvent[] = [
  { type: 'error', error: SAMPLE_ERROR },
  { type: 'idle-timeout', error: SAMPLE_ERROR },
];

function createControlledAgent(
  eventsForCall: (callIndex: number) => AgentEvent[],
  beforeEventsForCall?: (callIndex: number) => Promise<void> | undefined,
): {
  agent: Agent;
  streamCallCount: () => number;
  streamInputs: () => AgentInput[];
  getDeferred: (callIndex: number) => Deferred<void> | undefined;
} {
  let callCount = 0;
  const inputs: AgentInput[] = [];
  const deferreds: Array<Deferred<void>> = [];
  const base = createFakeAgentFromMockClient({
    getCurrentSequenceModel: () => 'test-model',
  });
  const agent: Agent = {
    ...base,
    async *stream(
      input: AgentInput,
      _opts?: { readonly signal?: AbortSignal; readonly promptId?: string },
    ): AsyncGenerator<AgentEvent> {
      const myIndex = callCount;
      callCount += 1;
      inputs.push(input);
      const settle = createDeferred<void>();
      deferreds[myIndex] = settle;
      await beforeEventsForCall?.(myIndex);
      for (const e of eventsForCall(myIndex)) {
        yield e;
      }
      await settle.promise;
    },
  };
  return {
    agent,
    streamCallCount: () => callCount,
    streamInputs: () => inputs,
    getDeferred: (i: number) => deferreds[i],
  };
}

interface OrchState {
  setIsRespondingCalls: boolean[];
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  loopDetectedRef: React.MutableRefObject<boolean>;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  processAgentEventRef: React.MutableRefObject<AgentEventRouter | null>;
  runStreamRef: UseSubmitQueryDeps['runStreamRef'];
  submitQueryRef: React.MutableRefObject<SubmissionExecutor | null>;
  queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]>;
}

function makeOrchState(): OrchState {
  return {
    setIsRespondingCalls: [],
    abortControllerRef: { current: null },
    loopDetectedRef: { current: false },
    pendingHistoryItemRef: { current: null },
    processAgentEventRef: { current: null },
    runStreamRef: { current: null },
    submitQueryRef: { current: null },
    queuedSubmissionsRef: { current: [] },
  };
}

function useOrchestration(
  state: OrchState,
  agent: Agent,
): {
  submitQuery: (q: string) => Promise<void>;
  processAgentEvent: AgentEventRouter;
  scheduleNextQueuedSubmission: () => void;
  submitterReady: boolean;
  activeTurn: boolean;
  commandEffect: string[];
  streamingState: StreamingState;
} {
  const [isResponding, setIsRespondingState] = useState(false);
  const streamingState = useStreamingState(isResponding, []);
  const queueOperations = React.useMemo(
    () => createQueueOperations(state.queuedSubmissionsRef),
    [state.queuedSubmissionsRef],
  );
  const submitQueryRef = React.useRef<SubmissionExecutor | null>(null);
  state.submitQueryRef = submitQueryRef;
  const drainReservedRef = React.useRef(false);
  const tryReserveDrain = React.useCallback(() => {
    if (drainReservedRef.current) return false;
    drainReservedRef.current = true;
    return true;
  }, []);
  const releaseDrain = React.useCallback(() => {
    drainReservedRef.current = false;
  }, []);
  const runtime = React.useMemo<StreamRuntime>(
    () => createStreamRuntimeForTest({}, createMockOverrides()),
    [],
  );
  const addItem = React.useMemo(() => vi.fn().mockReturnValue(1), []);
  const commandEffect = React.useMemo<string[]>(() => [], []);
  const handleSlashCommand = React.useMemo(
    () =>
      vi.fn(async (cmd: unknown): Promise<SlashCommandProcessorResult> => {
        commandEffect.push(`executed:${typeof cmd === 'string' ? cmd : ''}`);
        return { type: 'handled' };
      }),
    [commandEffect],
  );

  const submitDeps: UseSubmitQueryDeps = {
    runtime,
    agent,
    addItem,
    settings: createLoadedSettings(),
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    onAuthError: vi.fn(),
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: state.pendingHistoryItemRef,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    setTurnCancelled: vi.fn(),
    drainSuppressedRef: { current: false },
    queuedSubmissionsRef: state.queuedSubmissionsRef,
    ...queueOperations,
    tryReserveDrain,
    releaseDrain,
    setPendingHistoryItem: vi.fn(),
    setIsResponding: (value: boolean | ((prev: boolean) => boolean)) => {
      act(() => {
        setIsRespondingState((previous) => {
          const next = typeof value === 'function' ? value(previous) : value;
          state.setIsRespondingCalls.push(next);
          return next;
        });
      });
    },
    setInitError: vi.fn(),
    setThought: vi.fn(),
    setLastAgentActivityTime: vi.fn(),
    scheduleToolCalls: vi.fn(),
    abortActiveStream: vi.fn(),
    handleShellCommand: vi.fn().mockReturnValue(false),
    handleSlashCommand,
    logger: null,
    shellModeActive: false,
    loopDetectedRef: state.loopDetectedRef,
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    abortControllerRef: state.abortControllerRef,
    runStreamRef: state.runStreamRef,
    submitQueryRef,
    isResponding,
    streamingState,
    subagentManager: undefined,
    recordingIntegration: undefined,
  };

  const submitResult = useSubmitQuery(submitDeps);
  state.processAgentEventRef.current = submitResult.processAgentEvent;

  const eventStream = useAgentEventStream({
    agent,
    addItem,
    processAgentEventRef: state.processAgentEventRef,
    flushPendingHistoryItem: vi.fn(),
    clearPendingHistoryItem: vi.fn(),
    performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
  });
  state.runStreamRef.current = eventStream.runStream;

  return {
    submitQuery: submitResult.submitQuery,
    processAgentEvent: submitResult.processAgentEvent,
    scheduleNextQueuedSubmission: submitResult.scheduleNextQueuedSubmission,
    submitterReady: submitQueryRef.current !== null,
    activeTurn: state.abortControllerRef.current !== null && isResponding,
    commandEffect,
    streamingState,
  };
}

function renderOrchestration(state: OrchState, agent: Agent) {
  return renderHook(() => useOrchestration(state, agent));
}

async function settleReactWork(): Promise<void> {
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function startTurnAndWaitForTerminalEvent(
  result: { current: ReturnType<typeof useOrchestration> },
  state: OrchState,
): Promise<AbortSignal> {
  await act(async () => {
    void result.current.submitQuery('turn-1');
    await settleReactWork();
  });

  await waitFor(() =>
    expect(result.current.streamingState).toBe(StreamingState.Idle),
  );
  expect(state.setIsRespondingCalls).toContain(false);

  return state.abortControllerRef.current!.signal;
}

describe('useAgentStreamOrchestration — terminal event bridge (issue #2954)', () => {
  it.each(TERMINAL_EVENTS)(
    'accepts a slash command after $type without queuing or model streaming',
    async (event) => {
      const { agent, streamCallCount } = createControlledAgent(() => [event]);

      const state = makeOrchState();
      const { result } = renderOrchestration(state, agent);

      await startTurnAndWaitForTerminalEvent(result, state);

      await act(async () => {
        await result.current.submitQuery('/help');
      });

      expect(result.current.commandEffect).toContain('executed:/help');
      expect(state.queuedSubmissionsRef.current).toHaveLength(0);
      expect(streamCallCount()).toBe(1);
    },
  );

  it.each(TERMINAL_EVENTS)(
    'accepts an ordinary prompt after $type; second stream waits for first to settle',
    async (event) => {
      const { agent, streamCallCount, getDeferred } = createControlledAgent(
        () => [event],
      );

      const state = makeOrchState();
      const { result } = renderOrchestration(state, agent);

      await startTurnAndWaitForTerminalEvent(result, state);

      let turn2Promise!: Promise<void>;
      await act(async () => {
        turn2Promise = result.current.submitQuery('follow-up');
        await settleReactWork();
      });

      expect(state.queuedSubmissionsRef.current).toHaveLength(0);
      expect(streamCallCount()).toBe(1);

      const firstDeferred = getDeferred(0);
      expect(firstDeferred).toBeDefined();
      await act(async () => {
        firstDeferred!.resolve();
        await settleReactWork();
      });
      await waitFor(() => expect(streamCallCount()).toBe(2));

      const secondDeferred = getDeferred(1);
      await act(async () => {
        secondDeferred?.resolve();
        await turn2Promise.catch(() => {});
      });
    },
  );

  it('drains an idle-timeout queue in FIFO order without stale cleanup duplicating work', async () => {
    const eventGate = createDeferred<void>();
    const { agent, streamCallCount, streamInputs, getDeferred } =
      createControlledAgent(
        (callIndex) =>
          callIndex === 0
            ? [{ type: 'idle-timeout', error: SAMPLE_ERROR }]
            : [],
        (callIndex) => (callIndex === 0 ? eventGate.promise : undefined),
      );

    const state = makeOrchState();
    const { result } = renderOrchestration(state, agent);

    await act(async () => {
      void result.current.submitQuery('turn-1');
      await settleReactWork();
    });
    await waitFor(() =>
      expect(result.current.streamingState).toBe(StreamingState.Responding),
    );
    state.queuedSubmissionsRef.current = [
      { query: 'pre-queued-1' },
      { query: 'pre-queued-2' },
    ];

    await act(async () => {
      eventGate.resolve();
      await settleReactWork();
    });
    await waitFor(() =>
      expect(result.current.streamingState).toBe(StreamingState.Idle),
    );
    expect(state.setIsRespondingCalls).toContain(false);
    expect(result.current.submitterReady).toBe(true);
    expect(result.current.activeTurn).toBe(false);
    expect(state.queuedSubmissionsRef.current).toStrictEqual([
      { query: 'pre-queued-2' },
    ]);
    expect(streamCallCount()).toBe(1);
    expect(streamInputs()).toStrictEqual(['turn-1']);

    await act(async () => {
      getDeferred(0)?.resolve();
      await settleReactWork();
    });
    await waitFor(() => expect(streamCallCount()).toBe(2));
    expect(streamInputs()).toStrictEqual(['turn-1', 'pre-queued-1']);
    expect(state.queuedSubmissionsRef.current).toStrictEqual([
      { query: 'pre-queued-2' },
    ]);

    await act(async () => {
      getDeferred(1)?.resolve();
      await settleReactWork();
    });
    await waitFor(() => expect(streamCallCount()).toBe(3));

    expect(streamInputs()).toStrictEqual([
      'turn-1',
      'pre-queued-1',
      'pre-queued-2',
    ]);
    expect(state.queuedSubmissionsRef.current).toHaveLength(0);

    await act(async () => {
      getDeferred(2)?.resolve();
      await settleReactWork();
    });
    await waitFor(() =>
      expect(result.current.streamingState).toBe(StreamingState.Idle),
    );
  });

  it('stale old-turn events and cleanup cannot mutate or release a newer active turn', async () => {
    const { agent, getDeferred } = createControlledAgent((callIndex) => {
      if (callIndex === 0) return [{ type: 'error', error: SAMPLE_ERROR }];
      return [];
    });

    const state = makeOrchState();
    const { result } = renderOrchestration(state, agent);

    const firstSignal = await startTurnAndWaitForTerminalEvent(result, state);

    let turn2Promise!: Promise<void>;
    await act(async () => {
      turn2Promise = result.current.submitQuery('turn-2');
      await settleReactWork();
    });
    await waitFor(() =>
      expect(result.current.streamingState).toBe(StreamingState.Responding),
    );

    const secondSignal = state.abortControllerRef.current!.signal;
    expect(secondSignal).not.toBe(firstSignal);

    const setIsRespondingBefore = [...state.setIsRespondingCalls];

    await act(async () => {
      result.current.processAgentEvent(
        { type: 'idle-timeout', error: SAMPLE_ERROR },
        Date.now(),
        firstSignal,
      );
    });

    expect(state.abortControllerRef.current?.signal).toBe(secondSignal);
    expect(state.setIsRespondingCalls).toStrictEqual(setIsRespondingBefore);

    const firstDeferred = getDeferred(0);
    await act(async () => {
      firstDeferred?.resolve();
      await settleReactWork();
    });
    await waitFor(() =>
      expect(state.abortControllerRef.current?.signal).toBe(secondSignal),
    );

    await act(async () => {
      await result.current.submitQuery('turn-3-should-queue');
    });
    expect(state.queuedSubmissionsRef.current).toHaveLength(1);
    expect(state.queuedSubmissionsRef.current[0]?.query).toBe(
      'turn-3-should-queue',
    );
    expect(state.setIsRespondingCalls).toStrictEqual(setIsRespondingBefore);

    const secondDeferred = getDeferred(1);
    await act(async () => {
      secondDeferred?.resolve();
      await turn2Promise.catch(() => {});
    });
    await waitFor(() => expect(getDeferred(2)).toBeDefined());
    await act(async () => {
      getDeferred(2)?.resolve();
      await settleReactWork();
    });
    await waitFor(() =>
      expect(result.current.streamingState).toBe(StreamingState.Idle),
    );
  });
});
