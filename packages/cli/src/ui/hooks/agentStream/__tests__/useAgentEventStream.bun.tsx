/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent, ContentBlock } from '@vybestack/llxprt-code-core';

/**
 * Behavioral tests for useAgentEventStream — the CLI's consumer of the public
 * Agent facade. These tests verify that the hook correctly:
 *  - Iterates agent.stream() and routes AgentEvents to React state.
 *  - Serializes overlapping runStream calls.
 *  - Handles mid-stream cancellation.
 *  - Registers display+editor callbacks on the agent.
 *
 * These tests use a lightweight fake Agent that yields canned AgentEvent arrays
 * — they verify the hook's event-routing, serialization, and callback-wiring
 * contracts without standing up the full multi-turn loop engine. The real
 * engine (createAgenticLoop + mapLoopStream) integration tests live in
 * useAgentEventStream.loopIntegration.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import type { AgentEventRouter } from '../useAgentEventStream.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { createFakeAgent } from './helpers/createFakeAgent.js';

function setupHook(agent: Agent) {
  const routedEvents: AgentEvent[] = [];
  const routedSignals: AbortSignal[] = [];
  const processAgentEventRef: React.MutableRefObject<AgentEventRouter | null> =
    { current: null };
  const addItem = vi.fn();
  const flushPendingHistoryItem = vi.fn();
  const clearPendingHistoryItem = vi.fn();
  const performMemoryRefresh = vi.fn().mockResolvedValue(undefined);
  const markToolsAsDisplayCleared = vi.fn();
  const onToolCallsUpdate = vi.fn();
  const outputUpdateHandler = vi.fn();
  const getPreferredEditor = vi.fn();
  const onEditorOpen = vi.fn();
  const onEditorClose = vi.fn();

  const { result, unmount } = renderHook(() =>
    useAgentEventStream({
      agent,
      addItem,
      processAgentEventRef,
      flushPendingHistoryItem,
      clearPendingHistoryItem,
      performMemoryRefresh,
      markToolsAsDisplayCleared,
      onToolCallsUpdate,
      outputUpdateHandler,
      getPreferredEditor,
      onEditorOpen,
      onEditorClose,
    }),
  );

  // Populate the router ref so events are actually routed.
  processAgentEventRef.current = (
    event: AgentEvent,
    _timestamp: number,
    signal: AbortSignal,
  ) => {
    routedEvents.push(event);
    routedSignals.push(signal);
  };

  return {
    result,
    unmount,
    routedEvents,
    routedSignals,
    addItem,
    flushPendingHistoryItem,
    clearPendingHistoryItem,
    performMemoryRefresh,
    markToolsAsDisplayCleared,
    onToolCallsUpdate,
    outputUpdateHandler,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('useAgentEventStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('iterates agent.stream() events and routes each to the event router', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Hello' },
      { type: 'done', reason: 'stop' },
    ];
    const agent = createFakeAgent(events);
    const { result, unmount, routedEvents, routedSignals } = setupHook(agent);

    const controller = new AbortController();
    await act(async () => {
      await result.current.runStream(
        'test' as string | ContentBlock[] | IContent,
        controller.signal,
        'prompt-1',
      );
    });

    expect(routedEvents).toHaveLength(2);
    expect(routedEvents[0]).toStrictEqual({ type: 'text', text: 'Hello' });
    expect(routedEvents[1]).toStrictEqual({ type: 'done', reason: 'stop' });
    expect(routedSignals).toStrictEqual([controller.signal, controller.signal]);
    unmount();
  });

  it('breaks iteration when the abort signal fires', async () => {
    const controller = new AbortController();
    let yieldCount = 0;
    const agent = createFakeAgent([]);
    (agent as unknown as { stream: unknown }).stream = async function* () {
      for (let i = 0; i < 100; i++) {
        yieldCount++;
        yield { type: 'text', text: `chunk-${i}` } as AgentEvent;
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const routed: AgentEvent[] = [];
    const { result, unmount } = renderHook(() =>
      useAgentEventStream({
        agent,
        addItem: vi.fn(),
        processAgentEventRef: {
          current: (e: AgentEvent, _ts: number) => routed.push(e),
        } as React.MutableRefObject<AgentEventRouter | null>,
        flushPendingHistoryItem: vi.fn(),
        clearPendingHistoryItem: vi.fn(),
        performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
      }),
    );

    // Start streaming, then abort after first chunk
    const promise = act(async () => {
      const p = result.current.runStream(
        'test' as string | ContentBlock[] | IContent,
        controller.signal,
        'prompt-abort',
      );
      // Abort after a microtask
      setTimeout(() => controller.abort(), 0);
      await p;
    });
    await promise;

    expect(routed.length).toBeGreaterThan(0);
    expect(routed.length).toBeLessThan(100);
    expect(yieldCount).toBeLessThanOrEqual(routed.length + 1);
    unmount();
  });

  it('serializes overlapping runStream calls', async () => {
    const events1: AgentEvent[] = [{ type: 'text', text: 'first' }];
    const events2: AgentEvent[] = [{ type: 'text', text: 'second' }];
    let callIndex = 0;
    const allEvents = [events1, events2];
    const executionOrder: string[] = [];
    const agent = createFakeAgent([]);
    (agent as unknown as { stream: unknown }).stream = async function* () {
      const myIndex = callIndex++;
      executionOrder.push(`start-${myIndex}`);
      const events = allEvents[myIndex] ?? [];
      for (const e of events) {
        // Yield asynchronously so both runs can be started concurrently
        await new Promise((r) => setTimeout(r, 0));
        yield e;
      }
      executionOrder.push(`end-${myIndex}`);
    };

    const routed: AgentEvent[] = [];
    const { result, unmount } = renderHook(() =>
      useAgentEventStream({
        agent,
        addItem: vi.fn(),
        processAgentEventRef: {
          current: (e: AgentEvent, _ts: number) => routed.push(e),
        } as React.MutableRefObject<AgentEventRouter | null>,
        flushPendingHistoryItem: vi.fn(),
        clearPendingHistoryItem: vi.fn(),
        performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
      }),
    );

    const controller = new AbortController();
    await act(async () => {
      // Start both runs "simultaneously" — the second is queued behind the
      // first via the inflightRunRef serialization chain.
      const p1 = result.current.runStream(
        'a' as string | ContentBlock[] | IContent,
        controller.signal,
        'p1',
      );
      // Let the microtask queue flush so run 1 starts before run 2 is called
      await new Promise((r) => setTimeout(r, 0));
      const p2 = result.current.runStream(
        'b' as string | ContentBlock[] | IContent,
        controller.signal,
        'p2',
      );
      await Promise.all([p1, p2]);
    });

    // Both runs completed; events from both arrived in order
    expect(routed).toHaveLength(2);
    expect(routed[0]).toStrictEqual({ type: 'text', text: 'first' });
    expect(routed[1]).toStrictEqual({ type: 'text', text: 'second' });

    expect(executionOrder).toStrictEqual([
      'start-0',
      'end-0',
      'start-1',
      'end-1',
    ]);
    unmount();
  });

  it('registers display callbacks on the agent via setDisplayCallbacks', () => {
    const setDisplayCallbacksSpy = vi.fn();
    const setEditorCallbacksSpy = vi.fn();
    const agent = createFakeAgent([]);
    agent.tools.setDisplayCallbacks = setDisplayCallbacksSpy;
    agent.tools.setEditorCallbacks = setEditorCallbacksSpy;

    const onToolCallsUpdate = vi.fn();
    const { unmount } = renderHook(() =>
      useAgentEventStream({
        agent,
        addItem: vi.fn(),
        processAgentEventRef: {
          current: null,
        } as React.MutableRefObject<AgentEventRouter | null>,
        flushPendingHistoryItem: vi.fn(),
        clearPendingHistoryItem: vi.fn(),
        performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
        onToolCallsUpdate,
        outputUpdateHandler: vi.fn(),
        getPreferredEditor: vi.fn(),
        onEditorOpen: vi.fn(),
        onEditorClose: vi.fn(),
      }),
    );

    expect(setDisplayCallbacksSpy).toHaveBeenCalledTimes(1);
    expect(setEditorCallbacksSpy).toHaveBeenCalledTimes(1);
    // Verify the display callbacks object has the expected keys
    const displayCbs = setDisplayCallbacksSpy.mock.calls[0][0];
    expect(displayCbs).toHaveProperty('onToolCallsUpdate');
    expect(displayCbs).toHaveProperty('outputUpdateHandler');
    expect(displayCbs).toHaveProperty('onAllToolCallsComplete');

    unmount();
    expect(setDisplayCallbacksSpy).toHaveBeenLastCalledWith({});
    expect(setEditorCallbacksSpy).toHaveBeenLastCalledWith({});
  });
});
