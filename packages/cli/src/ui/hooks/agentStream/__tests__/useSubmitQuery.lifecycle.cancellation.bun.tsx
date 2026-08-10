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
 * P07: granular cancellation classification integration tests (AC-4).
 *
 * Split from useSubmitQuery.lifecycle.test.tsx. Proves that
 * cancelled_during_api, cancelled_during_tool, cancelled_during_approval are
 * selected from real live/terminal phase evidence on AbortSignal
 * cancellation, using a real OperationLifecycleRegistry + PerfSink writing to
 * temp files. Mocks are limited to external boundaries
 * (runStream, prepareQueryForAgent, event handlers) — the lifecycle, sink,
 * and retention are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery } from '../useSubmitQuery.js';
import { createDeferred } from './createDeferred.js';
import {
  createLifecycleDeps,
  createLifecyclePerfHarness,
  buildLifecycleHookDeps,
  type LifecycleDeps,
} from './lifecyclePerfFixtures.js';
import type {
  OperationLifecycleRegistry,
  ObservableAgentEvent,
} from '../operationLifecycle.js';

// ─── Module mocks ───────────────────────────────────────────────────────────

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: vi.fn(),
    prepareQueryForAgent: vi.fn().mockResolvedValue({
      queryToSend: 'test-query',
      shouldProceed: true,
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
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
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

// ─── Harness ────────────────────────────────────────────────────────────────

const harness = createLifecyclePerfHarness();
let registry: OperationLifecycleRegistry;

function renderUseSubmitQuery(deps: LifecycleDeps) {
  return renderHook(() =>
    useSubmitQuery(buildLifecycleHookDeps(deps, harness.registry)),
  );
}

function drainAndRead() {
  return harness.drainAndRead();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — P07 granular cancellation classification (AC-4)', () => {
  beforeEach(async () => {
    await harness.setup();
    registry = harness.registry;
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('classifies as "cancelled_during_api" when the signal aborts during streaming (default phase)', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    // Start turn (blocks on deferred runStream).
    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-capi',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());

    // Abort the signal during the API/streaming phase (no tool-status event).
    deps.abortControllerRef.current!.abort();
    // Reject the deferred to settle runStream.
    const abortError = new DOMException('Aborted', 'AbortError');
    await act(async () => {
      turnDeferred.reject(abortError);
      await turnPromise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_during_api');
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-capi');
  });

  it('classifies as "cancelled_during_tool" when the signal aborts during a tool phase', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-ctool',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());
    const signal = deps.abortControllerRef.current!.signal;

    // Route a tool-status 'executing' event through the registry's real
    // event-observation entry point (the path the orchestration wires via
    // onAgentEventObserved, OUTSIDE the generic event-handler catch — D8).
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c1', name: 'shell', status: 'executing' },
        } as never,
        signal,
        0,
      );
    });

    // Abort during the tool phase.
    deps.abortControllerRef.current!.abort();
    const abortError = new DOMException('Aborted', 'AbortError');
    await act(async () => {
      turnDeferred.reject(abortError);
      await turnPromise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_during_tool');
  });

  it('classifies as "cancelled_during_approval" when the signal aborts during an approval phase', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-cappr',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());
    const signal = deps.abortControllerRef.current!.signal;

    // Route a tool-status 'awaiting-approval' event through the registry's
    // real event-observation entry point (outside the generic catch — D8).
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c1', status: 'awaiting-approval' },
        } satisfies ObservableAgentEvent,
        signal,
        0,
      );
    });

    // Abort during the approval phase.
    deps.abortControllerRef.current!.abort();
    const abortError = new DOMException('Aborted', 'AbortError');
    await act(async () => {
      turnDeferred.reject(abortError);
      await turnPromise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_during_approval');
  });

  it('deterministic precedence: approval > tool > api when overlapping phases occur', async () => {
    const turnDeferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-prec',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());
    const signal = deps.abortControllerRef.current!.signal;

    // Enter tool phase first, then approval phase (higher precedence). Both
    // routed through the registry's real event-observation entry point.
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c1', status: 'executing' },
        } satisfies ObservableAgentEvent,
        signal,
        0,
      );
    });
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c2', status: 'awaiting-approval' },
        } satisfies ObservableAgentEvent,
        signal,
        0,
      );
    });

    // Abort: precedence says approval wins.
    deps.abortControllerRef.current!.abort();
    const abortError = new DOMException('Aborted', 'AbortError');
    await act(async () => {
      turnDeferred.reject(abortError);
      await turnPromise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_during_approval');
  });

  it('classifies as "cancelled_during_tool" when a retained tool-status cancelled event holds evidence', async () => {
    // This exercises the retainedCancellationEvidence path (set ONLY by a
    // tool-status 'cancelled' event), which persists past finalise and wins
    // over the live-phase fallback. Even though the tool call is removed from
    // activeToolCallIds by the 'cancelled' handler, the retained evidence
    // ensures classifyCancellation returns cancelled_during_tool.
    const turnDeferred = createDeferred<void>();
    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderUseSubmitQuery(deps);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-rcancel',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());
    const signal = deps.abortControllerRef.current!.signal;

    // A tool enters the executing phase, then is cancelled (terminal 'cancelled'
    // status). This retains tool-phase cancellation evidence and closes the
    // active tool call — so at abort time activeToolCallIds is empty but the
    // retained evidence must still win.
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c1', status: 'executing' },
        } satisfies ObservableAgentEvent,
        signal,
        0,
      );
    });
    act(() => {
      registry.observeAgentEvent(
        {
          type: 'tool-status',
          update: { id: 'c1', status: 'cancelled' },
        } satisfies ObservableAgentEvent,
        signal,
        0,
      );
    });

    // Abort AFTER the tool phase has already closed. Retained evidence must
    // still classify as cancelled_during_tool (not the fallback during_api).
    deps.abortControllerRef.current!.abort();
    const abortError = new DOMException('Aborted', 'AbortError');
    await act(async () => {
      turnDeferred.reject(abortError);
      await turnPromise.catch(() => {});
    });

    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled_during_tool');
  });
});
