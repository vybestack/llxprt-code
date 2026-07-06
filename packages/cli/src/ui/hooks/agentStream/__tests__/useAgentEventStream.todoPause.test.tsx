/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: useAgentEventStream fires onTodoPause when the
 * onAllToolCallsComplete callback receives a completed pause-task tool
 * call with status 'success'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core';
import type { AgentEventRouter } from '../useAgentEventStream.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { createFakeAgent } from './helpers/createFakeAgent.js';

// Mock toolMapping so handleToolsComplete doesn't need full tool objects
vi.mock('../../toolMapping.js', () => ({
  mapToDisplay: () => ({
    type: 'tool_group' as const,
    agentId: 'default-agent',
    tools: [],
  }),
}));

describe('useAgentEventStream todoPause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires onTodoPause when onAllToolCallsComplete receives a successful todo_pause', async () => {
    const onTodoPause = vi.fn();
    const onAllToolCallsCompleteRef: {
      current: ((c: readonly unknown[]) => void) | null;
    } = { current: null };

    const agent = createFakeAgent([{ type: 'done', reason: 'stop' }]);
    agent.tools.setDisplayCallbacks = (cbs: {
      onAllToolCallsComplete?: (c: readonly unknown[]) => void;
    }) => {
      onAllToolCallsCompleteRef.current = cbs.onAllToolCallsComplete ?? null;
    };

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
        onTodoPause,
      }),
    );

    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'call-1',
          name: 'todo_pause',
          args: {},
        },
        response: {
          responseParts: [{ text: 'paused' }],
        },
        status: 'success',
      } as unknown as CompletedToolCall,
    ];

    await act(async () => {
      onAllToolCallsCompleteRef.current?.(completed);
    });

    expect(onTodoPause).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onTodoPause for non-todo_pause tools', async () => {
    const onTodoPause = vi.fn();
    const onAllToolCallsCompleteRef: {
      current: ((c: readonly unknown[]) => void) | null;
    } = { current: null };

    const agent = createFakeAgent([{ type: 'done', reason: 'stop' }]);
    agent.tools.setDisplayCallbacks = (cbs: {
      onAllToolCallsComplete?: (c: readonly unknown[]) => void;
    }) => {
      onAllToolCallsCompleteRef.current = cbs.onAllToolCallsComplete ?? null;
    };

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
        onTodoPause,
      }),
    );

    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'call-2',
          name: 'read_file',
          args: {},
        },
        response: {
          responseParts: [{ text: 'content' }],
        },
        status: 'success',
      } as unknown as CompletedToolCall,
    ];

    await act(async () => {
      onAllToolCallsCompleteRef.current?.(completed);
    });

    expect(onTodoPause).not.toHaveBeenCalled();
  });

  it('does NOT fire onTodoPause when todo_pause completes with status error', async () => {
    const onTodoPause = vi.fn();
    const onAllToolCallsCompleteRef: {
      current: ((c: readonly unknown[]) => void) | null;
    } = { current: null };

    const agent = createFakeAgent([{ type: 'done', reason: 'stop' }]);
    agent.tools.setDisplayCallbacks = (cbs: {
      onAllToolCallsComplete?: (c: readonly unknown[]) => void;
    }) => {
      onAllToolCallsCompleteRef.current = cbs.onAllToolCallsComplete ?? null;
    };

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
        onTodoPause,
      }),
    );

    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'call-err',
          name: 'todo_pause',
          args: {},
        },
        response: {
          responseParts: [{ text: 'error' }],
        },
        status: 'error',
      } as unknown as CompletedToolCall,
    ];

    await act(async () => {
      onAllToolCallsCompleteRef.current?.(completed);
    });

    expect(onTodoPause).not.toHaveBeenCalled();
  });
});
