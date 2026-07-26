/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { StreamingState, ToolCallStatus } from '../../../types.js';
import { useSteer } from './useSteer.js';

const executingTool = {
  type: 'tool_group' as const,
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
};

describe('useSteer', () => {
  it('injects sanitized text while a tool call is outstanding', () => {
    const injectSteer = vi.fn();
    const addMessage = vi.fn();
    const sanitizeContent = vi.fn(() => ({
      text: 'sanitized steer',
      blocked: false,
    }));
    const { result } = renderHook(() =>
      useSteer(
        { injectSteer },
        StreamingState.Responding,
        sanitizeContent,
        [executingTool],
        addMessage,
      ),
    );

    let consumed = false;
    act(() => {
      consumed = result.current('raw steer');
    });

    expect(consumed).toBe(true);
    expect(sanitizeContent).toHaveBeenCalledWith('raw steer');
    expect(injectSteer).toHaveBeenCalledWith('sanitized steer');
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('degrades to the normal queue during a final-answer stream', () => {
    const injectSteer = vi.fn();
    const addMessage = vi.fn();
    const { result } = renderHook(() =>
      useSteer(
        { injectSteer },
        StreamingState.Responding,
        () => ({ text: 'queued steer', blocked: false }),
        [],
        addMessage,
      ),
    );

    let consumed = false;
    act(() => {
      consumed = result.current('queued steer');
    });

    expect(consumed).toBe(true);
    expect(addMessage).toHaveBeenCalledWith('queued steer');
    expect(injectSteer).not.toHaveBeenCalled();
  });

  it('does not consume Ctrl+Enter outside an active response', () => {
    const injectSteer = vi.fn();
    const addMessage = vi.fn();
    const sanitizeContent = vi.fn();
    const { result } = renderHook(() =>
      useSteer(
        { injectSteer },
        StreamingState.Idle,
        sanitizeContent,
        [],
        addMessage,
      ),
    );

    expect(result.current('newline')).toBe(false);
    expect(sanitizeContent).not.toHaveBeenCalled();
    expect(injectSteer).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('does not inject or queue blocked content', () => {
    const injectSteer = vi.fn();
    const addMessage = vi.fn();
    const { result } = renderHook(() =>
      useSteer(
        { injectSteer },
        StreamingState.Responding,
        () => ({ text: '', blocked: true }),
        [executingTool],
        addMessage,
      ),
    );

    expect(result.current('blocked')).toBe(false);
    expect(injectSteer).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('does not crash the input handler when sanitization fails', () => {
    const injectSteer = vi.fn();
    const addMessage = vi.fn();
    const { result } = renderHook(() =>
      useSteer(
        { injectSteer },
        StreamingState.Responding,
        () => {
          throw new Error('sanitizer failure');
        },
        [executingTool],
        addMessage,
      ),
    );

    expect(result.current('steer')).toBe(false);
    expect(injectSteer).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });
});
