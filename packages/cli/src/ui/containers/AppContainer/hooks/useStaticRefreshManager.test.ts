/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { appEvents, AppEvent } from '../../../../utils/events.js';
import { StreamingState } from '../../../types.js';
import { useStaticRefreshManager } from './useStaticRefreshManager.js';

interface Props {
  streamingState: StreamingState;
  terminalWidth: number;
  terminalHeight: number;
}

describe('useStaticRefreshManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips initial-mount refresh and only refreshes on subsequent resize while idle', () => {
    const refreshStatic = vi.fn();
    const setConstrainHeight = vi.fn();

    const { rerender } = renderHook(
      ({ streamingState, terminalWidth, terminalHeight }: Props) =>
        useStaticRefreshManager({
          streamingState,
          terminalWidth,
          terminalHeight,
          refreshStatic,
          constrainHeight: true,
          setConstrainHeight,
        }),
      {
        initialProps: {
          streamingState: StreamingState.Idle,
          terminalWidth: 100,
          terminalHeight: 30,
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(refreshStatic).not.toHaveBeenCalled();

    rerender({
      streamingState: StreamingState.Idle,
      terminalWidth: 120,
      terminalHeight: 30,
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(refreshStatic).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refreshStatic).toHaveBeenCalledTimes(1);
  });

  it('defers refresh during active streaming and flushes when stream returns idle', () => {
    const refreshStatic = vi.fn();
    const setConstrainHeight = vi.fn();

    const { rerender } = renderHook(
      ({ streamingState, terminalWidth, terminalHeight }: Props) =>
        useStaticRefreshManager({
          streamingState,
          terminalWidth,
          terminalHeight,
          refreshStatic,
          constrainHeight: true,
          setConstrainHeight,
        }),
      {
        initialProps: {
          streamingState: StreamingState.Idle,
          terminalWidth: 100,
          terminalHeight: 30,
        },
      },
    );

    rerender({
      streamingState: StreamingState.Responding,
      terminalWidth: 120,
      terminalHeight: 30,
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(refreshStatic).not.toHaveBeenCalled();

    rerender({
      streamingState: StreamingState.Idle,
      terminalWidth: 120,
      terminalHeight: 30,
    });

    expect(refreshStatic).toHaveBeenCalledTimes(1);
  });

  it('forces constrainHeight true on flicker event when currently unconstrained', () => {
    const refreshStatic = vi.fn();
    const setConstrainHeight = vi.fn();

    renderHook(() =>
      useStaticRefreshManager({
        streamingState: StreamingState.Idle,
        terminalWidth: 100,
        terminalHeight: 30,
        constrainHeight: false,
        refreshStatic,
        setConstrainHeight,
      }),
    );

    act(() => {
      appEvents.emit(AppEvent.Flicker, {
        contentHeight: 40,
        terminalHeight: 30,
        overflow: 10,
      });
    });

    expect(setConstrainHeight).toHaveBeenCalledWith(true);
  });

  it('does not force constrainHeight when already constrained', () => {
    const refreshStatic = vi.fn();
    const setConstrainHeight = vi.fn();

    renderHook(() =>
      useStaticRefreshManager({
        streamingState: StreamingState.Idle,
        terminalWidth: 100,
        terminalHeight: 30,
        constrainHeight: true,
        refreshStatic,
        setConstrainHeight,
      }),
    );

    act(() => {
      appEvents.emit(AppEvent.Flicker, {
        contentHeight: 31,
        terminalHeight: 30,
        overflow: 1,
      });
    });

    expect(setConstrainHeight).not.toHaveBeenCalled();
  });
});
