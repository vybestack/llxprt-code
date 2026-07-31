/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { StreamingState } from '../../../types.js';
import { useStreamingState } from '../useAgentStreamLifecycle.js';
import type { TrackedToolCall } from '../../useReactToolScheduler.js';

const REQUEST = {
  callId: 'test-call-id',
  name: 'testTool',
  args: {},
} as unknown as import('@vybestack/llxprt-code-core').ToolCallRequestInfo;

function executingCall(): TrackedToolCall {
  return {
    status: 'executing',
    request: REQUEST,
    tool: {} as never,
    invocation: {} as never,
  } as unknown as TrackedToolCall;
}

function successCall(displayCleared = false): TrackedToolCall {
  return {
    status: 'success',
    request: REQUEST,
    tool: {} as never,
    response: {} as never,
    invocation: {} as never,
    displayCleared,
  } as unknown as TrackedToolCall;
}

function awaitingApprovalCall(): TrackedToolCall {
  return {
    status: 'awaiting_approval',
    request: REQUEST,
    tool: {} as never,
    invocation: {} as never,
    confirmationDetails: {} as never,
  } as unknown as TrackedToolCall;
}

function renderStreamingState(
  isResponding: boolean,
  toolCalls: TrackedToolCall[],
  cancelled = false,
) {
  return renderHook(
    (props: {
      isResponding: boolean;
      toolCalls: TrackedToolCall[];
      cancelled: boolean;
    }) =>
      useStreamingState(props.isResponding, props.toolCalls, props.cancelled),
    {
      initialProps: { isResponding, toolCalls, cancelled },
    },
  );
}

describe('useStreamingState', () => {
  it('returns Idle when not responding and no outstanding tool calls', () => {
    const { result } = renderStreamingState(false, []);
    expect(result.current).toBe(StreamingState.Idle);
  });

  it('returns Responding when isResponding is true', () => {
    const { result } = renderStreamingState(true, []);
    expect(result.current).toBe(StreamingState.Responding);
  });

  it('returns Responding when an outstanding tool call exists', () => {
    const { result } = renderStreamingState(false, [executingCall()]);
    expect(result.current).toBe(StreamingState.Responding);
  });

  it('returns Responding for a completed-but-not-displayCleared tool call', () => {
    const { result } = renderStreamingState(false, [successCall(false)]);
    expect(result.current).toBe(StreamingState.Responding);
  });

  it('returns Idle for a completed and displayCleared tool call', () => {
    const { result } = renderStreamingState(false, [successCall(true)]);
    expect(result.current).toBe(StreamingState.Idle);
  });

  // ── Issue #2882: cancel-aware streaming state ─────────────────────────
  describe('cancel-awareness (issue #2882)', () => {
    it('returns Idle after cancel even with outstanding tool calls', () => {
      const { result } = renderStreamingState(false, [executingCall()], true);
      expect(result.current).toBe(StreamingState.Idle);
    });

    it('returns Idle after cancel with completed-but-not-displayCleared tool calls', () => {
      const { result } = renderStreamingState(
        false,
        [successCall(false)],
        true,
      );
      expect(result.current).toBe(StreamingState.Idle);
    });

    it('still returns WaitingForConfirmation after cancel if a tool needs approval', () => {
      const { result } = renderStreamingState(
        false,
        [awaitingApprovalCall()],
        true,
      );
      expect(result.current).toBe(StreamingState.WaitingForConfirmation);
    });

    it('returns Idle when isResponding is already false and cancel flag flips (no isResponding change)', () => {
      // This is the critical edge case (ocr high-severity finding): the agent
      // finished streaming (isResponding already false) but tools are still
      // outstanding, so streamingState was Responding. The user cancels,
      // flipping only the cancel flag — isResponding stays false.
      // The memo must recompute because turnCancelled is a real dependency.
      const toolCalls = [successCall(false)];
      const { result, rerender } = renderStreamingState(
        false,
        toolCalls,
        false,
      );
      expect(result.current).toBe(StreamingState.Responding);

      rerender({ isResponding: false, toolCalls, cancelled: true });
      expect(result.current).toBe(StreamingState.Idle);
    });
  });
});
