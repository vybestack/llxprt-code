/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import type { TextBuffer } from '../../../components/shared/text-buffer.js';
import { ToolCallStatus, type HistoryItemWithoutId } from '../../../types.js';
import { useInputHandling } from './useInputHandling.js';

interface InputHandlingHarness {
  buffer: TextBuffer;
  bufferSetText: ReturnType<typeof vi.fn>;
  addInput: ReturnType<typeof vi.fn>;
  submitQuery: ReturnType<typeof vi.fn>;
  pendingHistoryItems: HistoryItemWithoutId[];
  lastSubmittedPromptRef: { current: string | null };
  hadToolCallsRef: { current: boolean };
  clearPause: ReturnType<typeof vi.fn>;
  todoContinuationRef: { current: { clearPause: () => void } | null };
  isMcpReady: boolean;
  addMessage: ReturnType<typeof vi.fn>;
}

const createHarness = (
  overrides: Partial<InputHandlingHarness> = {},
): InputHandlingHarness => {
  const bufferSetText = vi.fn();
  const addInput = vi.fn();
  const submitQuery = vi.fn().mockResolvedValue(undefined);
  const clearPause = vi.fn();

  return {
    buffer: { setText: bufferSetText } as unknown as TextBuffer,
    pendingHistoryItems: [],
    lastSubmittedPromptRef: { current: 'last submitted prompt' },
    hadToolCallsRef: { current: true },
    todoContinuationRef: { current: { clearPause } },
    isMcpReady: true,
    addMessage: vi.fn(),
    ...overrides,
    bufferSetText,
    addInput,
    submitQuery,
    clearPause,
  };
};

describe('useInputHandling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores the last prompt when user cancel requests restore', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleUserCancel(true);
    });

    expect(harness.bufferSetText).toHaveBeenCalledWith('last submitted prompt');
  });

  it('clears the buffer when user cancel does not request restore', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleUserCancel(false);
    });

    expect(harness.bufferSetText).toHaveBeenCalledWith('');
  });

  it('forces buffer clear from cancel handler when a tool is executing', () => {
    const harness = createHarness({
      pendingHistoryItems: [
        {
          type: 'tool_group',
          tools: [
            {
              callId: 'call-1',
              name: 'shell',
              description: 'Shell tool',
              resultDisplay: undefined,
              status: ToolCallStatus.Executing,
              confirmationDetails: undefined,
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.cancelHandlerRef.current?.(true);
    });

    expect(harness.bufferSetText).toHaveBeenCalledWith('');
    expect(harness.bufferSetText).not.toHaveBeenCalledWith(
      'last submitted prompt',
    );
  });

  it('submits trimmed input and resets continuation-related refs', () => {
    const harness = createHarness({
      lastSubmittedPromptRef: { current: null },
      hadToolCallsRef: { current: true },
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleFinalSubmit('   run tests   ');
    });

    expect(harness.hadToolCallsRef.current).toBe(false);
    expect(harness.clearPause).toHaveBeenCalledTimes(1);
    expect(harness.lastSubmittedPromptRef.current).toBe('run tests');
    expect(harness.addInput).toHaveBeenCalledWith('run tests');
    expect(harness.submitQuery).toHaveBeenCalledWith('run tests');
  });

  it('ignores blank submissions and does not mutate state or side effects', () => {
    const harness = createHarness({
      lastSubmittedPromptRef: { current: 'keep me' },
      hadToolCallsRef: { current: true },
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleFinalSubmit('   ');
    });

    expect(harness.hadToolCallsRef.current).toBe(true);
    expect(harness.lastSubmittedPromptRef.current).toBe('keep me');
    expect(harness.clearPause).not.toHaveBeenCalled();
    expect(harness.addInput).not.toHaveBeenCalled();
    expect(harness.submitQuery).not.toHaveBeenCalled();
  });

  it('queues non-slash prompt when MCP is not ready', () => {
    const harness = createHarness({
      isMcpReady: false,
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleFinalSubmit('search my files');
    });

    // Should be queued, not submitted
    expect(harness.addMessage).toHaveBeenCalledWith('search my files');
    expect(harness.addInput).toHaveBeenCalledWith('search my files');
    expect(harness.submitQuery).not.toHaveBeenCalled();
    // Should not reset tool call ref since submission is deferred
    expect(harness.hadToolCallsRef.current).toBe(true);
  });

  it('lets slash commands through even when MCP is not ready', () => {
    const harness = createHarness({
      isMcpReady: false,
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleFinalSubmit('/help');
    });

    // Slash commands bypass MCP gate
    expect(harness.submitQuery).toHaveBeenCalledWith('/help');
    expect(harness.addMessage).not.toHaveBeenCalled();
  });

  it('submits directly when MCP is ready', () => {
    const harness = createHarness({
      isMcpReady: true,
    });

    const { result } = renderHook(() =>
      useInputHandling({
        buffer: harness.buffer,
        inputHistoryStore: { addInput: harness.addInput },
        submitQuery: harness.submitQuery,
        pendingHistoryItems: harness.pendingHistoryItems,
        lastSubmittedPromptRef: harness.lastSubmittedPromptRef,
        hadToolCallsRef: harness.hadToolCallsRef,
        todoContinuationRef: harness.todoContinuationRef,
        isMcpReady: harness.isMcpReady,
        addMessage: harness.addMessage,
      }),
    );

    act(() => {
      result.current.handleFinalSubmit('analyze the codebase');
    });

    expect(harness.submitQuery).toHaveBeenCalledWith('analyze the codebase');
    expect(harness.addMessage).not.toHaveBeenCalled();
  });
});
