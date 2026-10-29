/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { useHookDisplayState } from './useHookDisplayState.js';
import { type MessageBus, MessageBusType } from '@vybestack/llxprt-code-core';
import { createHookControlDeps } from '../../__tests__/ui-consent-hook-owners.js';

const cleanups: Array<() => void> = [];
function createTestMessageBus() {
  const { control, messageBus } = createHookControlDeps();
  cleanups.push(() => control.detach());
  return {
    bus: messageBus,
    subscribeExecutionPhase: control.subscribeExecutionPhase.bind(control),
  };
}

function publishRequest(
  bus: MessageBus,
  eventName: string,
  correlationId: string,
) {
  bus.publish({
    type: MessageBusType.HOOK_EXECUTION_REQUEST,
    payload: { eventName, correlationId },
  });
}

function publishResponse(bus: MessageBus, correlationId: string) {
  bus.publish({
    type: MessageBusType.HOOK_EXECUTION_RESPONSE,
    payload: { correlationId, success: true },
  });
}

describe('useHookDisplayState', () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  it('returns an empty array when no hooks are active', () => {
    const { subscribeExecutionPhase } = createTestMessageBus();
    const { result } = renderHook(() =>
      useHookDisplayState(subscribeExecutionPhase),
    );
    expect(result.current).toStrictEqual([]);
  });

  it('adds an active hook on request event', () => {
    const { bus, subscribeExecutionPhase } = createTestMessageBus();
    const { result } = renderHook(() =>
      useHookDisplayState(subscribeExecutionPhase),
    );

    act(() => publishRequest(bus, 'BeforeTool', 'req-1'));

    expect(result.current).toHaveLength(1);
    expect(result.current[0].eventName).toBe('BeforeTool');
  });

  it('removes the correct hook when response B arrives before response A', () => {
    const { bus, subscribeExecutionPhase } = createTestMessageBus();
    const { result } = renderHook(() =>
      useHookDisplayState(subscribeExecutionPhase),
    );

    act(() => {
      publishRequest(bus, 'BeforeTool', 'req-A');
      publishRequest(bus, 'AfterTool', 'req-B');
    });

    expect(result.current).toHaveLength(2);

    // Response for B arrives first
    act(() => publishResponse(bus, 'req-B'));

    // Only A should remain — the out-of-order response should remove B, not A
    expect(result.current).toHaveLength(1);
    expect(result.current[0].eventName).toBe('BeforeTool');
  });

  it('removes the correct instance when multiple hooks share an event name', () => {
    const { bus, subscribeExecutionPhase } = createTestMessageBus();
    const { result } = renderHook(() =>
      useHookDisplayState(subscribeExecutionPhase),
    );

    act(() => {
      publishRequest(bus, 'BeforeTool', 'req-1');
      publishRequest(bus, 'BeforeTool', 'req-2');
    });

    expect(result.current).toHaveLength(2);

    // Response for req-2 arrives
    act(() => publishResponse(bus, 'req-2'));

    // One instance removed, one remains with correlationId req-1
    expect(result.current).toHaveLength(1);
    expect(result.current[0].correlationId).toBe('req-1');
  });

  it('leaves active hooks unchanged when response has unknown correlationId', () => {
    const { bus, subscribeExecutionPhase } = createTestMessageBus();
    const { result } = renderHook(() =>
      useHookDisplayState(subscribeExecutionPhase),
    );

    act(() => publishRequest(bus, 'BeforeTool', 'req-1'));

    expect(result.current).toHaveLength(1);

    act(() => publishResponse(bus, 'unknown-id'));

    // Should remain unchanged — no FIFO removal
    expect(result.current).toHaveLength(1);
    expect(result.current[0].eventName).toBe('BeforeTool');
  });

  it('returns empty when no messageBus is provided', () => {
    const { result } = renderHook(() => useHookDisplayState(undefined));
    expect(result.current).toStrictEqual([]);
  });
});
