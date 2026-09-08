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
 * P07 default-off event-dispatch behavioral tests (issue #3167).
 *
 * useAgentEventStream routes each AgentEvent to the React state handler
 * (processAgentEvent). When a perf observer (onAgentEventObserved) is present,
 * it ALSO measures synchronous dispatch and invokes the observer OUTSIDE the
 * generic catch (D8: a perf-callback throw rejects the stream). When the
 * observer is ABSENT (perf disabled — the default), there must be NO timing
 * work per event and NO sample allocation.
 *
 * These tests exercise the REAL useAgentEventStream through the REAL event
 * iteration loop (a lightweight fake Agent yielding canned AgentEvents). They
 * inject a package-private monotonic-clock seam to prove the absent-observer
 * path performs zero timing calls. No mock theater around the dispatch logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import type { ContentBlock, IContent } from '@vybestack/llxprt-code-core';
import type {
  AgentEventRouter,
  UseAgentEventStreamReturn,
} from '../useAgentEventStream.js';
import {
  useAgentEventStream,
  __setMonotonicClockForTesting,
} from '../useAgentEventStream.js';
import { createFakeAgent } from './helpers/createFakeAgent.js';

describe('useAgentEventStream default-off P07 test lifecycle', () => {
  beforeEach(() => {
    __setMonotonicClockForTesting(null);
  });

  afterEach(() => {
    __setMonotonicClockForTesting(null);
  });

  function makeCountingClock(): {
    clock: () => number;
    calls: () => number;
  } {
    let calls = 0;
    let t = 0;
    return {
      clock: () => {
        calls += 1;
        t += 1;
        return t;
      },
      calls: () => calls,
    };
  }

  function renderStreamHook(
    agent: Agent,
    onAgentEventObserved?: (
      event: AgentEvent,
      signal: AbortSignal,
      handlerMs: number,
    ) => void,
  ): {
    result: {
      current: {
        runStream: UseAgentEventStreamReturn['runStream'];
      };
    };
    unmount: () => void;
    processAgentEventRef: React.MutableRefObject<AgentEventRouter | null>;
  } {
    const processAgentEventRef: React.MutableRefObject<AgentEventRouter | null> =
      { current: null };
    const { result, unmount } = renderHook(() =>
      useAgentEventStream({
        agent,
        addItem: vi.fn(),
        processAgentEventRef,
        flushPendingHistoryItem: vi.fn(),
        clearPendingHistoryItem: vi.fn(),
        performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
        onAgentEventObserved,
      }),
    );
    return { result, unmount, processAgentEventRef };
  }

  describe('useAgentEventStream default-off event dispatch (P07)', () => {
    it('absent observer performs NO monotonic-clock calls per event', async () => {
      const events: AgentEvent[] = [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'text', text: 'c' },
        { type: 'done', reason: 'stop' },
      ];
      const agent = createFakeAgent(events);
      const { clock, calls } = makeCountingClock();
      __setMonotonicClockForTesting(clock);

      const routed: AgentEvent[] = [];
      const { result, unmount, processAgentEventRef } = renderStreamHook(agent);
      processAgentEventRef.current = (event: AgentEvent) => routed.push(event);

      const controller = new AbortController();
      await act(async () => {
        await result.current.runStream(
          'hi' as string | ContentBlock[] | IContent,
          controller.signal,
          'prompt-defaultoff',
        );
      });

      // Events were still routed (proving the loop ran).
      expect(routed).toHaveLength(4);
      // NO timing work happened because no observer was supplied.
      expect(calls()).toBe(0);
      unmount();
    });

    const observeAbsentObserverAfterOrdinaryHandlerError = async (): Promise<{
      readonly routed: readonly string[];
      readonly clockCalls: number;
      readonly unmount: () => void;
    }> => {
      const events: AgentEvent[] = [
        { type: 'text', text: 'before-error' },
        { type: 'text', text: 'throws' },
        { type: 'text', text: 'after-error' },
        { type: 'done', reason: 'stop' },
      ];
      const agent = createFakeAgent(events);
      const { clock, calls } = makeCountingClock();
      __setMonotonicClockForTesting(clock);

      const routed: string[] = [];
      const { result, unmount, processAgentEventRef } = renderStreamHook(agent);
      processAgentEventRef.current = (event: AgentEvent) => {
        if (event.type === 'text' && event.text === 'throws') {
          throw new Error('ordinary handler error');
        }
        routed.push(event.type === 'text' ? event.text : event.type);
      };

      const controller = new AbortController();
      await act(async () => {
        await result.current.runStream(
          'hi' as string | ContentBlock[] | IContent,
          controller.signal,
          'prompt-handler-error',
        );
      });

      return { routed, clockCalls: calls(), unmount };
    };

    it('absent observer still continues after an ordinary handler error', async () => {
      const { routed, clockCalls, unmount } =
        await observeAbsentObserverAfterOrdinaryHandlerError();

      // The bad event was swallowed; subsequent events still arrived.
      expect(routed).toStrictEqual(['before-error', 'after-error', 'done']);
      // Still no timing work with an absent observer.
      expect(clockCalls).toBe(0);
      unmount();
    });

    it('present observer measures dispatch and is invoked (clock IS used)', async () => {
      const events: AgentEvent[] = [
        { type: 'text', text: 'x' },
        { type: 'done', reason: 'stop' },
      ];
      const agent = createFakeAgent(events);
      const { clock, calls } = makeCountingClock();
      __setMonotonicClockForTesting(clock);

      const observed: Array<{ event: string; handlerMs: number }> = [];
      const { result, unmount, processAgentEventRef } = renderStreamHook(
        agent,
        (event, _signal, handlerMs) => {
          observed.push({ event: event.type, handlerMs });
        },
      );
      processAgentEventRef.current = () => {};

      const controller = new AbortController();
      await act(async () => {
        await result.current.runStream(
          'hi' as string | ContentBlock[] | IContent,
          controller.signal,
          'prompt-observer-present',
        );
      });

      // The observer fired once per event, AFTER the timing measurement.
      expect(observed).toHaveLength(2);
      expect(observed.map((o) => o.event)).toStrictEqual(['text', 'done']);
      // Two clock calls per observed event (start + end).
      expect(calls()).toBe(4);
      // handlerMs is the synchronous dispatch delta (positive because the
      // counting clock advances by 1 each call).
      expect(observed[0].handlerMs).toBeGreaterThan(0);
      unmount();
    });

    it('present observer that throws rejects the stream (fail-fast)', async () => {
      const events: AgentEvent[] = [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
        { type: 'done', reason: 'stop' },
      ];
      const agent = createFakeAgent(events);

      const { result, unmount, processAgentEventRef } = renderStreamHook(
        agent,
        () => {
          throw new Error('perf observer internal error');
        },
      );
      processAgentEventRef.current = () => {};

      const controller = new AbortController();
      await act(async () => {
        await expect(
          result.current.runStream(
            'hi' as string | ContentBlock[] | IContent,
            controller.signal,
            'prompt-observer-throw',
          ),
        ).rejects.toThrow('perf observer internal error');
      });
      unmount();
    });
  });
});
