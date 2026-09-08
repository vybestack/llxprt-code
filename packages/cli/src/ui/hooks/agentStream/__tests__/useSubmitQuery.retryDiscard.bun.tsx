/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3048 — discard-and-restart in the interactive CLI.
 *
 * Drives the REAL `useSubmitQuery` event-routing lifecycle (real
 * `useStreamEventHandlers`, real `dispatchAgentEvent`, real
 * `PendingResponseBuffer`, real `CommittedSegmentLedger`). Only leaf
 * infrastructure (`turnPreparation`, `SessionContext`) is stubbed. React host
 * state (pending history item, thought) is captured by holders that mirror real
 * `setState` semantics so assertions read observable rendered values.
 *
 * @plan PLAN-20260806-ISSUE3048.P09 P11
 * @requirement REQ-3048-008 REQ-3048-009
 */

import { describe, it, expect, vi } from 'bun:test';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import type {
  ThinkingBlock,
  ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type { QueuedSubmission } from '../types.js';
import type { UseHistoryManagerReturn } from '../../useHistoryManager.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { createDeferred } from './createDeferred.js';
import { createFakeAgentFromMockClient } from '../../useAgentStream-test-helpers.js';
import type { StreamRuntime } from '../../../cliUiRuntime.js';
import {
  createLoadedSettings,
  createMockOverrides,
  createQueueOperations,
} from './submitQueryTestFixtures.js';

void vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

void vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

function createMockAgent() {
  return createFakeAgentFromMockClient({
    getCurrentSequenceModel: () => 'test-model',
  });
}

interface CoordinatedState {
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  setPendingHistoryItem: Dispatch<SetStateAction<HistoryItemWithoutId | null>>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  thoughtRef: React.MutableRefObject<ThoughtSummary | null>;
  setThought: Dispatch<SetStateAction<ThoughtSummary | null>>;
}

function createCoordinatedState(): CoordinatedState {
  let pending: HistoryItemWithoutId | null = null;
  const thoughtRef: React.MutableRefObject<ThoughtSummary | null> = {
    current: null,
  };
  const thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]> = {
    current: [],
  };
  return {
    pendingHistoryItemRef: {
      get current() {
        return pending;
      },
      set current(value: HistoryItemWithoutId | null) {
        pending = value;
      },
    },
    setPendingHistoryItem: (
      updater:
        | HistoryItemWithoutId
        | null
        | ((prev: HistoryItemWithoutId | null) => HistoryItemWithoutId | null),
    ) => {
      pending = typeof updater === 'function' ? updater(pending) : updater;
    },
    thinkingBlocksRef,
    thoughtRef,
    setThought: (
      updater:
        | ThoughtSummary
        | null
        | ((prev: ThoughtSummary | null) => ThoughtSummary | null),
    ) => {
      thoughtRef.current =
        typeof updater === 'function' ? updater(thoughtRef.current) : updater;
    },
  };
}

interface AddItemRecorder {
  calls: Array<{
    id: number;
    item: Parameters<UseHistoryManagerReturn['addItem']>[0];
    timestamp: number;
  }>;
  addItem: UseHistoryManagerReturn['addItem'];
}

function createRecordingAddItem(seedId = 1000): AddItemRecorder {
  const calls: AddItemRecorder['calls'] = [];
  let nextId = seedId;
  return {
    calls,
    addItem: (item, timestamp = Date.now()) => {
      const id = nextId;
      nextId += 1;
      calls.push({ id, item, timestamp });
      return id;
    },
  };
}

interface RemoveItemsRecorder {
  calls: Array<{ ids: readonly number[] }>;
  removeItems: (ids: readonly number[]) => void;
}

function createRecordingRemoveItems(): RemoveItemsRecorder {
  const calls: Array<{ ids: readonly number[] }> = [];
  return {
    calls,
    removeItems: (ids) => {
      calls.push({ ids: [...ids] });
    },
  };
}

interface RetryDiscardDeps {
  coordinated: CoordinatedState;
  addItemRecorder: AddItemRecorder;
  removeItemsRecorder: RemoveItemsRecorder;
  pendingResponse: PendingResponseBuffer;
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: UseSubmitQueryDeps['runStreamRef'];
  flushCalls: number[];
  queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]>;
}

function createRetryDiscardDeps(
  options: {
    pendingHistoryItemRef?: React.MutableRefObject<HistoryItemWithoutId | null>;
    setPendingHistoryItem?: Dispatch<
      SetStateAction<HistoryItemWithoutId | null>
    >;
  } = {},
): RetryDiscardDeps {
  const coordinated = createCoordinatedState();
  const setIsRespondingCalls: boolean[] = [];
  const addItemRecorder = createRecordingAddItem();
  const removeItemsRecorder = createRecordingRemoveItems();
  const flushCalls: number[] = [];
  const queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]> = {
    current: [],
  };
  return {
    coordinated: {
      ...coordinated,
      ...(options.pendingHistoryItemRef
        ? { pendingHistoryItemRef: options.pendingHistoryItemRef }
        : {}),
      ...(options.setPendingHistoryItem
        ? { setPendingHistoryItem: options.setPendingHistoryItem }
        : {}),
    },
    addItemRecorder,
    removeItemsRecorder,
    pendingResponse: new PendingResponseBuffer(undefined),
    setIsRespondingCalls,
    setIsResponding: createMockSetState(setIsRespondingCalls),
    abortControllerRef: { current: null },
    runStreamRef: { current: null },
    flushCalls,
    queuedSubmissionsRef,
  };
}

function createMockSetState(
  calls: boolean[],
): Dispatch<SetStateAction<boolean>> {
  return (value) => {
    if (typeof value === 'boolean') calls.push(value);
  };
}

function buildUseSubmitQueryDeps(
  deps: RetryDiscardDeps,
  overrides: {
    runtime?: StreamRuntime;
    /**
     * When the key is present (even as undefined) it replaces the history
     * retraction wiring, letting a test simulate an unwired hook.
     */
    removeItems?: (ids: readonly number[]) => void;
  } = {},
): (streamingState: StreamingState) => UseSubmitQueryDeps {
  const queueOperations = createQueueOperations(deps.queuedSubmissionsRef);
  const flushPendingHistoryItem = (timestamp: number) => {
    deps.flushCalls.push(timestamp);
  };
  const hasRemoveItemsOverride = 'removeItems' in overrides;
  const removeItems = hasRemoveItemsOverride
    ? overrides.removeItems
    : deps.removeItemsRecorder.removeItems;
  const stableDeps = {
    runtime:
      overrides.runtime ??
      createStreamRuntimeForTest({}, createMockOverrides()),
    agent: createMockAgent(),
    addItem: deps.addItemRecorder.addItem,
    removeItems,
    settings: createLoadedSettings(),
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    onAuthError: vi.fn(),
    recordingIntegration: undefined,
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem,
    pendingResponse: deps.pendingResponse,
    pendingHistoryItemRef: deps.coordinated.pendingHistoryItemRef,
    thinkingBlocksRef: deps.coordinated.thinkingBlocksRef,
    turnCancelledRef: { current: false },
    setTurnCancelled: vi.fn(),
    queuedSubmissionsRef: deps.queuedSubmissionsRef,
    ...queueOperations,
    drainSuppressedRef: { current: false },
    tryReserveDrain: vi.fn().mockReturnValue(true),
    releaseDrain: vi.fn(),
    setPendingHistoryItem: deps.coordinated.setPendingHistoryItem,
    setIsResponding: deps.setIsResponding,
    setInitError: vi.fn(),
    setThought: deps.coordinated.setThought,
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
  };
  return (streamingState) => ({ ...stableDeps, streamingState });
}

function renderUseSubmitQuery(
  deps: RetryDiscardDeps,
  overrides: {
    runtime?: StreamRuntime;
    initialStreamingState?: StreamingState;
    removeItems?: (ids: readonly number[]) => void;
  } = {},
) {
  const getDeps = buildUseSubmitQueryDeps(deps, overrides);
  return renderHook(
    ({ streamingState }: { streamingState: StreamingState }) =>
      useSubmitQuery(getDeps(streamingState)),
    {
      initialProps: {
        streamingState: overrides.initialStreamingState ?? StreamingState.Idle,
      },
    },
  );
}

async function startActiveTurn(
  result: { current: ReturnType<typeof useSubmitQuery> },
  rerender: (props: { streamingState: StreamingState }) => void,
  deps: RetryDiscardDeps,
): Promise<AbortSignal> {
  deps.runStreamRef.current = vi.fn(() => {
    const deferred = createDeferred<void>();
    return deferred.promise;
  });
  await act(async () => {
    void result.current.submitQuery('turn-1');
  });
  await waitFor(() => expect(deps.setIsRespondingCalls).toStrictEqual([true]));
  await act(async () => {
    rerender({ streamingState: StreamingState.Responding });
  });
  const controller = deps.abortControllerRef.current;
  if (!controller) throw new Error('AbortController not set after submit');
  return controller.signal;
}

async function route(
  result: { current: ReturnType<typeof useSubmitQuery> },
  event: AgentEvent,
  signal: AbortSignal,
): Promise<void> {
  await act(async () => {
    result.current.processAgentEvent(event, Date.now(), signal);
  });
}

/**
 * Type-safe accessor for the pending item's text. Uses a discriminated check
 * instead of a type assertion.
 */
function pendingText(item: HistoryItemWithoutId | null): string | undefined {
  if (item === null) return undefined;
  if ('text' in item) return item.text;
  return undefined;
}

function retractedIds(calls: RemoveItemsRecorder['calls']): readonly number[] {
  return calls[0]?.ids ?? [];
}

function isStableSegmentCall(call: AddItemRecorder['calls'][number]): boolean {
  return (
    typeof call.item.text === 'string' && call.item.text.includes('para one')
  );
}

function requireStableSegmentCall(
  calls: AddItemRecorder['calls'],
  errorMessage: string,
): AddItemRecorder['calls'][number] {
  const committedCall = calls.find(isStableSegmentCall);
  if (!committedCall) throw new Error(errorMessage);
  return committedCall;
}

function errorMessage(value: unknown): string {
  if (!(value instanceof Error)) {
    throw new Error(`Expected Error, received ${String(value)}`);
  }
  return value.message;
}

const THINKING_EVENT: AgentEvent = {
  type: 'thinking',
  thought: { subject: 'reasoning', description: 'about the answer' },
};

describe('useSubmitQuery — discard-and-restart (issue #3048, REQ-3048-008)', () => {
  it('renders only the successful attempt text after a retry', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'text', text: 'abandoned partial' }, signal);
    await route(result, { type: 'retry' }, signal);
    await route(result, { type: 'text', text: 'kept' }, signal);

    expect(pendingText(deps.coordinated.pendingHistoryItemRef.current)).toBe(
      'kept',
    );
  });

  const observeAbandonedPendingHistoryCommits = async (): Promise<{
    readonly abandonedCommits: ReadonlyArray<AddItemRecorder['calls'][number]>;
  }> => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'text', text: 'abandoned partial' }, signal);
    await route(result, { type: 'retry' }, signal);
    await route(result, { type: 'text', text: 'kept' }, signal);

    const abandonedCommits = deps.addItemRecorder.calls.filter(
      (call) =>
        typeof call.item.text === 'string' &&
        call.item.text.includes('abandoned partial'),
    );
    return { abandonedCommits };
  };

  it('does not commit the abandoned pending item to history', async () => {
    const { abandonedCommits } = await observeAbandonedPendingHistoryCommits();

    expect(abandonedCommits).toStrictEqual([]);
  });

  it('resets the pending response buffer', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'text', text: 'abandoned partial' }, signal);
    expect(deps.pendingResponse.stableText).toBe('abandoned partial');

    await route(result, { type: 'retry' }, signal);

    expect(deps.pendingResponse.stableText).toBe('');
    expect(deps.pendingResponse.displayText).toBe('');
  });

  it('clears thinking state produced by the abandoned attempt', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, THINKING_EVENT, signal);
    expect(deps.coordinated.thinkingBlocksRef.current).toHaveLength(1);
    expect(deps.coordinated.thoughtRef.current).not.toBe(null);

    await route(result, { type: 'retry' }, signal);

    expect(deps.coordinated.thinkingBlocksRef.current).toStrictEqual([]);
    expect(deps.coordinated.thoughtRef.current).toBe(null);
  });

  it('leaves a pending tool_group item untouched', async () => {
    const toolGroupItem: HistoryItemWithoutId = {
      type: 'tool_group',
      tools: [],
    };
    const deps = createRetryDiscardDeps({
      pendingHistoryItemRef: { current: toolGroupItem },
    });
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'retry' }, signal);

    expect(deps.coordinated.pendingHistoryItemRef.current).toBe(toolGroupItem);
  });

  it('does not release the turn or clear the submission queue', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);
    const respondingCallsBefore = [...deps.setIsRespondingCalls];

    await route(result, { type: 'retry' }, signal);

    expect(deps.setIsRespondingCalls).toStrictEqual(respondingCallsBefore);
    expect(deps.queuedSubmissionsRef.current).toStrictEqual([]);
  });

  it('returns the dispatcher buffer as an empty string for retry', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'text', text: 'abandoned' }, signal);
    await route(result, { type: 'retry' }, signal);
    await route(result, { type: 'text', text: 'x' }, signal);

    expect(pendingText(deps.coordinated.pendingHistoryItemRef.current)).toBe(
      'x',
    );
  });
});

describe('useSubmitQuery — committed segment retraction (issue #3048, REQ-3048-009)', () => {
  it('retracts stable segments committed by the abandoned attempt', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    // Stream text with a paragraph break so the content processor commits a
    // stable prefix via addItem. The ledger records the returned id.
    await route(result, { type: 'text', text: 'para one\n\npara two' }, signal);

    const committedTexts = deps.addItemRecorder.calls
      .filter(isStableSegmentCall)
      .map((call) => call.item.text);
    expect(committedTexts).toHaveLength(1);

    await route(result, { type: 'retry' }, signal);

    expect(deps.removeItemsRecorder.calls).toHaveLength(1);
    const retracted = retractedIds(deps.removeItemsRecorder.calls);
    expect(retracted).toHaveLength(1);
    // The retracted id must be the one addItem returned for the committed segment
    const committedSegmentCall = requireStableSegmentCall(
      deps.addItemRecorder.calls,
      'Expected the stable segment to be committed',
    );
    expect(retracted[0]).toBe(committedSegmentCall.id);
  });

  it('preserves items from before the assistant message', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    // Add a real earlier history item (a prior user message) and capture its
    // actual id. It must survive the retraction of the abandoned attempt.
    const earlierItemId = deps.addItemRecorder.addItem(
      { type: 'user', text: 'an earlier message' },
      0,
    );
    // Stream the assistant message, then abandon it.
    await route(result, { type: 'text', text: 'para one\n\npara two' }, signal);
    await route(result, { type: 'retry' }, signal);

    // The removeItems call should only target the committed segment id,
    // not any earlier items
    expect(deps.removeItemsRecorder.calls).toHaveLength(1);
    const retracted = retractedIds(deps.removeItemsRecorder.calls);
    expect(retracted).toHaveLength(1);
    // The earlier history item's id must be absent from the retraction set.
    expect(retracted).not.toContain(earlierItemId);
  });

  it('drains nothing on a second retry', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps);

    const signal = await startActiveTurn(result, rerender, deps);

    await route(result, { type: 'text', text: 'para one\n\npara two' }, signal);
    await route(result, { type: 'retry' }, signal);

    // First retry retracts the committed segment
    expect(deps.removeItemsRecorder.calls).toHaveLength(1);

    // Second retry: the ledger was drained, so nothing to retract
    await route(result, { type: 'retry' }, signal);
    expect(deps.removeItemsRecorder.calls).toHaveLength(1);
  });

  it('fails fast without losing ledger ids when retraction is unwired', async () => {
    const deps = createRetryDiscardDeps();
    const { result, rerender } = renderUseSubmitQuery(deps, {
      removeItems: undefined,
    });

    const signal = await startActiveTurn(result, rerender, deps);

    // Stream a multi-paragraph message so the content processor commits a
    // stable segment and records its id in the committed-segment ledger.
    await route(
      result,
      { type: 'text', text: ['para one', '', 'para two'].join('\n') },
      signal,
    );

    const committedCall = requireStableSegmentCall(
      deps.addItemRecorder.calls,
      'Expected a committed stable segment',
    );
    const committedId = committedCall.id;

    // With retraction unwired (removeItems undefined), routing the retry must
    // throw BEFORE draining the ledger so the committed id is not lost.
    let caught: unknown;
    try {
      await route(result, { type: 'retry' }, signal);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof Error).toBe(true);
    expect(
      errorMessage(caught).includes('History retraction is required'),
    ).toBe(true);

    // The ledger was not drained: the committed id survives for a later,
    // correctly-wired retraction.
    const retained = deps.pendingResponse.drainCommittedSegments();
    expect(retained).toContain(committedId);
  });

  /**
   * Runs a turn to completion: starts an active submission, routes the scripted
   * events, resolves the held `runStream` promise, and waits for the turn to
   * settle back to idle. Returns the turn's abort signal so a later turn can be
   * distinguished from it.
   */
  async function runTurnToCompletion(
    result: { current: ReturnType<typeof useSubmitQuery> },
    rerender: (props: { streamingState: StreamingState }) => void,
    deps: RetryDiscardDeps,
    events: readonly AgentEvent[],
  ): Promise<AbortSignal> {
    let resolveRun!: () => void;
    deps.runStreamRef.current = vi.fn(() => {
      const deferred = createDeferred<void>();
      resolveRun = deferred.resolve;
      return deferred.promise;
    });
    await act(async () => {
      void result.current.submitQuery('turn');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls.at(-1) ?? false).toBe(true),
    );
    await act(async () => {
      rerender({ streamingState: StreamingState.Responding });
    });
    const controller = deps.abortControllerRef.current;
    if (!controller) throw new Error('AbortController not set after submit');
    const signal = controller.signal;
    for (const event of events) {
      await route(result, event, signal);
    }
    await act(async () => {
      resolveRun();
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls.at(-1) ?? true).toBe(false),
    );
    await act(async () => {
      rerender({ streamingState: StreamingState.Idle });
    });
    return signal;
  }

  /**
   * Starts a subsequent turn while a previous turn has already completed. Unlike
   * {@link startActiveTurn} (which asserts the first-ever responding call), this
   * checks the *latest* responding call so it works after an earlier turn.
   */
  async function startNextActiveTurn(
    result: { current: ReturnType<typeof useSubmitQuery> },
    rerender: (props: { streamingState: StreamingState }) => void,
    deps: RetryDiscardDeps,
  ): Promise<AbortSignal> {
    deps.runStreamRef.current = vi.fn(() => {
      const deferred = createDeferred<void>();
      return deferred.promise;
    });
    await act(async () => {
      void result.current.submitQuery('turn-next');
    });
    await waitFor(() =>
      expect(deps.setIsRespondingCalls.at(-1) ?? false).toBe(true),
    );
    await act(async () => {
      rerender({ streamingState: StreamingState.Responding });
    });
    const controller = deps.abortControllerRef.current;
    if (!controller) throw new Error('AbortController not set after submit');
    return controller.signal;
  }

  describe('useSubmitQuery — committed segment ledger lifecycle across turns (issue #3048 review)', () => {
    it('preserves a completed turn history when a later turn retries before content', async () => {
      const deps = createRetryDiscardDeps();
      const { result, rerender } = renderUseSubmitQuery(deps);

      // Turn A: commits a stable paragraph segment, then completes.
      await runTurnToCompletion(result, rerender, deps, [
        { type: 'text', text: 'para one\n\npara two' },
        { type: 'done', reason: 'stop' },
      ]);

      // Turn A committed exactly one stable segment to history.
      const turnACommitted =
        deps.addItemRecorder.calls.filter(isStableSegmentCall);
      expect(turnACommitted).toHaveLength(1);
      // No retraction happened during turn A.
      expect(deps.removeItemsRecorder.calls).toStrictEqual([]);

      // Turn B: thinking then Retry BEFORE any Content.
      const turnBSignal = await startNextActiveTurn(result, rerender, deps);

      await route(result, THINKING_EVENT, turnBSignal);
      await route(result, { type: 'retry' }, turnBSignal);

      // Turn A's committed segment MUST survive: no retraction requested.
      expect(deps.removeItemsRecorder.calls).toStrictEqual([]);

      // The discard handler must still preserve a scheduler-owned tool_group
      // pending item during turn B (REQ-3048-008): the retry must not null it.
      const toolGroupItem: HistoryItemWithoutId = {
        type: 'tool_group',
        tools: [],
      };
      deps.coordinated.pendingHistoryItemRef.current = toolGroupItem;
      await route(result, { type: 'retry' }, turnBSignal);
      expect(deps.coordinated.pendingHistoryItemRef.current).toBe(
        toolGroupItem,
      );
    });
  });
});
