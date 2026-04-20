/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '../../test-utils/render.js';
import { useMessageQueue } from './useMessageQueue.js';
import { StreamingState } from '../types.js';

describe('useMessageQueue', () => {
  let mockSubmitQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSubmitQuery = vi.fn();
  });

  const renderMessageQueueHook = (initialProps: {
    isConfigInitialized: boolean;
    streamingState: StreamingState;
    submitQuery: (query: string) => void;
    isMcpReady: boolean;
  }) => {
    let hookResult: ReturnType<typeof useMessageQueue>;
    let currentProps = { ...initialProps };

    function TestComponent(props: typeof initialProps) {
      hookResult = useMessageQueue(props);
      return null;
    }

    const { rerender } = render(<TestComponent {...initialProps} />);
    const rerenderFn = (newProps: Partial<typeof initialProps>) => {
      currentProps = { ...currentProps, ...newProps };
      rerender(<TestComponent {...currentProps} />);
    };

    return {
      result: {
        get current() {
          return hookResult;
        },
      },
      rerender: rerenderFn,
    };
  };

  it('should initialize with an empty queue', () => {
    const { result } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Idle,
      submitQuery: mockSubmitQuery,
      isMcpReady: true,
    });

    expect(result.current.messageQueue).toStrictEqual([]);
    expect(mockSubmitQuery).not.toHaveBeenCalled();
  });

  it('queues prompt while MCP init is in progress', async () => {
    const { result } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Idle,
      submitQuery: mockSubmitQuery,
      isMcpReady: false,
    });

    act(() => {
      result.current.addMessage('hello');
    });

    expect(result.current.messageQueue).toStrictEqual(['hello']);
    expect(mockSubmitQuery).not.toHaveBeenCalled();
  });

  it('flushes queue when MCP becomes ready', async () => {
    const { result, rerender } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Idle,
      submitQuery: mockSubmitQuery,
      isMcpReady: false,
    });

    act(() => {
      result.current.addMessage('Delayed message');
    });

    expect(result.current.messageQueue).toStrictEqual(['Delayed message']);
    expect(mockSubmitQuery).not.toHaveBeenCalled();

    rerender({ isMcpReady: true });

    expect(mockSubmitQuery).toHaveBeenCalledWith('Delayed message');
    expect(result.current.messageQueue).toStrictEqual([]);
  });

  it('does not flush queue while streaming even when MCP ready', () => {
    const { result, rerender } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Responding,
      submitQuery: mockSubmitQuery,
      isMcpReady: true,
    });

    act(() => {
      result.current.addMessage('queued while streaming');
    });

    expect(result.current.messageQueue).toStrictEqual([
      'queued while streaming',
    ]);
    expect(mockSubmitQuery).not.toHaveBeenCalled();

    // Still streaming — should not flush
    rerender({ streamingState: StreamingState.Responding });
    expect(mockSubmitQuery).not.toHaveBeenCalled();
  });

  it('flushes all queued messages as a single combined submission when conditions are met', () => {
    const { result, rerender } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Responding,
      submitQuery: mockSubmitQuery,
      isMcpReady: true,
    });

    act(() => {
      result.current.addMessage('first');
    });
    act(() => {
      result.current.addMessage('second');
    });
    act(() => {
      result.current.addMessage('third');
    });

    // Become idle — all three messages should be combined into one call
    rerender({ streamingState: StreamingState.Idle });

    expect(mockSubmitQuery).toHaveBeenCalledTimes(1);
    expect(mockSubmitQuery).toHaveBeenCalledWith('first\n\nsecond\n\nthird');
    expect(result.current.messageQueue).toStrictEqual([]);
  });

  it('no-server startup: isMcpReady=true immediately, no queueing needed', () => {
    // When no MCP servers configured, isMcpReady starts true.
    // Messages submitted in Idle state go straight to submitQuery via handleFinalSubmit,
    // never reaching the queue. The queue itself just passes through when all gates open.
    const { result } = renderMessageQueueHook({
      isConfigInitialized: true,
      streamingState: StreamingState.Idle,
      submitQuery: mockSubmitQuery,
      isMcpReady: true,
    });

    act(() => {
      result.current.addMessage('immediate');
    });

    // With isMcpReady=true and Idle, the message is flushed immediately.
    expect(mockSubmitQuery).toHaveBeenCalledWith('immediate');
    expect(result.current.messageQueue).toStrictEqual([]);
  });
});
