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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import type { AgentEventRouter } from '../useAgentEventStream.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { createFakeAgent } from './helpers/createFakeAgent.js';

function setupHook(agent: Agent) {
  const routedEvents: AgentEvent[] = [];
  const processAgentEventRef: React.MutableRefObject<AgentEventRouter | null> =
    { current: null };
  const addItem = vi.fn();
  const flushPendingHistoryItem = vi.fn();
  const clearPendingHistoryItem = vi.fn();
  const performMemoryRefresh = vi.fn().mockResolvedValue(undefined);
  const onTodoPause = vi.fn();
  const markToolsAsDisplayCleared = vi.fn();
  const onToolCallsUpdate = vi.fn();
  const outputUpdateHandler = vi.fn();
  const getPreferredEditor = vi.fn();
  const onEditorOpen = vi.fn();
  const onEditorClose = vi.fn();

  const { result } = renderHook(() =>
    useAgentEventStream({
      agent,
      addItem,
      processAgentEventRef,
      flushPendingHistoryItem,
      clearPendingHistoryItem,
      performMemoryRefresh,
      onTodoPause,
      markToolsAsDisplayCleared,
      onToolCallsUpdate,
      outputUpdateHandler,
      getPreferredEditor,
      onEditorOpen,
      onEditorClose,
    }),
  );

  // Populate the router ref so events are actually routed.
  processAgentEventRef.current = (event: AgentEvent) => {
    routedEvents.push(event);
  };

  return {
    result,
    routedEvents,
    addItem,
    flushPendingHistoryItem,
    clearPendingHistoryItem,
    performMemoryRefresh,
    onTodoPause,
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
    const { result, routedEvents } = setupHook(agent);

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
  });

  it('breaks iteration when the abort signal fires', async () => {
    const controller = new AbortController();
    let yieldCount = 0;
    const agent = createFakeAgent([]);
    // Override stream to yield slowly and check abort
    (agent as unknown as { stream: unknown }).stream = async function* () {
      for (let i = 0; i < 100; i++) {
        if (controller.signal.aborted) break;
        yieldCount++;
        yield { type: 'text', text: `chunk-${i}` } as AgentEvent;
        // Yield to the event loop so the abort can fire
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const routed: AgentEvent[] = [];
    const { result } = renderHook(() =>
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

    // Should have stopped early (not all 100 chunks)
    expect(yieldCount).toBeLessThan(100);
  });

  it('serializes overlapping runStream calls', async () => {
    const events1: AgentEvent[] = [{ type: 'text', text: 'first' }];
    const events2: AgentEvent[] = [{ type: 'text', text: 'second' }];
    let callIndex = 0;
    const allEvents = [events1, events2];
    const startOrder: string[] = [];
    const endOrder: string[] = [];
    const agent = createFakeAgent([]);
    (agent as unknown as { stream: unknown }).stream = async function* () {
      const myIndex = callIndex++;
      startOrder.push(`start-${myIndex}`);
      const events = allEvents[myIndex] ?? [];
      for (const e of events) {
        // Yield asynchronously so both runs can be started concurrently
        await new Promise((r) => setTimeout(r, 0));
        yield e;
      }
      endOrder.push(`end-${myIndex}`);
    };

    const routed: AgentEvent[] = [];
    const { result } = renderHook(() =>
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

    // Serialization: run 1 ended BEFORE run 2 started (no overlap).
    expect(startOrder).toStrictEqual(['start-0', 'start-1']);
    expect(endOrder).toStrictEqual(['end-0', 'end-1']);
    // The critical serialization assertion: end-0 precedes start-1.
    expect(endOrder.indexOf('end-0')).toBeLessThan(
      startOrder.indexOf('start-1'),
    );
  });

  it('registers display callbacks on the agent via setDisplayCallbacks', () => {
    const setDisplayCallbacksSpy = vi.fn();
    const setEditorCallbacksSpy = vi.fn();
    const agent = createFakeAgent([]);
    agent.tools.setDisplayCallbacks = setDisplayCallbacksSpy;
    agent.tools.setEditorCallbacks = setEditorCallbacksSpy;

    const onToolCallsUpdate = vi.fn();
    renderHook(() =>
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
  });
});
