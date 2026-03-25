/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { appEvents, AppEvent } from '../../../../utils/events.js';
import { useAppEventHandlers } from './useAppEventHandlers.js';

describe('useAppEventHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens debug console on AppEvent.OpenDebugConsole and disables height constraint', () => {
    const setShowErrorDetails = vi.fn();
    const setConstrainHeight = vi.fn();
    const handleNewMessage = vi.fn();

    renderHook(() =>
      useAppEventHandlers({
        handleNewMessage,
        setShowErrorDetails,
        setConstrainHeight,
      }),
    );

    act(() => {
      appEvents.emit(AppEvent.OpenDebugConsole);
    });

    expect(setShowErrorDetails).toHaveBeenCalledWith(true);
    expect(setConstrainHeight).toHaveBeenCalledWith(false);
    expect(handleNewMessage).not.toHaveBeenCalled();
  });

  it('emits error console message when AppEvent.LogError is published', () => {
    const setShowErrorDetails = vi.fn();
    const setConstrainHeight = vi.fn();
    const handleNewMessage = vi.fn();

    renderHook(() =>
      useAppEventHandlers({
        handleNewMessage,
        setShowErrorDetails,
        setConstrainHeight,
      }),
    );

    act(() => {
      appEvents.emit(AppEvent.LogError, 'Error: boom');
    });

    expect(handleNewMessage).toHaveBeenCalledWith({
      type: 'error',
      content: 'Error: boom',
      count: 1,
    });
  });

  it('removes listeners on unmount', () => {
    const setShowErrorDetails = vi.fn();
    const setConstrainHeight = vi.fn();
    const handleNewMessage = vi.fn();

    const { unmount } = renderHook(() =>
      useAppEventHandlers({
        handleNewMessage,
        setShowErrorDetails,
        setConstrainHeight,
      }),
    );

    unmount();

    act(() => {
      appEvents.emit(AppEvent.OpenDebugConsole);
      appEvents.emit(AppEvent.LogError, 'should be ignored');
    });

    expect(setShowErrorDetails).not.toHaveBeenCalled();
    expect(setConstrainHeight).not.toHaveBeenCalled();
    expect(handleNewMessage).not.toHaveBeenCalled();
  });
});
