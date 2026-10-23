/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it } from 'bun:test';
import { MessageBusType } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../__tests__/render.js';
import { createHookControlDeps } from '../../__tests__/ui-consent-hook-owners.js';
import { useHookDisplayState } from './useHookDisplayState.js';

describe('hook display observer lifetime', () => {
  it('retains active correlations across rerenders without duplicate starts', () => {
    const fixture = createHookControlDeps();
    const subscribe = fixture.control.subscribeExecutionPhase.bind(
      fixture.control,
    );
    const view = renderHook(() => useHookDisplayState(subscribe));
    try {
      act(() => fixture.publishBusRequest('BeforeTool', 'A'));
      view.rerender();
      act(() => fixture.publishBusRequest('AfterTool', 'B'));
      expect(
        view.result.current.map((hook) => hook.correlationId),
      ).toStrictEqual(['A', 'B']);
      act(() => fixture.publishBusResponse('B'));
      expect(
        view.result.current.map((hook) => hook.correlationId),
      ).toStrictEqual(['A']);
    } finally {
      view.unmount();
      fixture.control.detach();
    }
  });

  it('unmounts only its observer while completion observers and the borrowed bus remain usable', () => {
    const fixture = createHookControlDeps();
    const subscribe = fixture.control.subscribeExecutionPhase.bind(
      fixture.control,
    );
    const first = renderHook(() => useHookDisplayState(subscribe));
    const peer = renderHook(() => useHookDisplayState(subscribe));
    let completions = 0;
    const stop = fixture.control.onHookExecution(() => {
      completions++;
    });
    try {
      act(() => fixture.publishBusRequest('BeforeTool', 'A'));
      first.unmount();
      expect(peer.result.current).toHaveLength(1);
      act(() => fixture.publishBusResponse('A'));
      expect(peer.result.current).toStrictEqual([]);
      expect(completions).toBe(1);
      act(() => fixture.publishBusRequest('AfterTool', 'B'));
      expect(peer.result.current[0].correlationId).toBe('B');
      expect(
        fixture.messageBus.listenerCount(MessageBusType.HOOK_EXECUTION_REQUEST),
      ).toBe(1);
    } finally {
      peer.unmount();
      stop();
      fixture.control.detach();
    }
  });
});
