/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { useModelRuntimeSync } from './useModelRuntimeSync.js';

describe('useModelRuntimeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses provider model when runtime model is non-empty and updates current model', () => {
    const setCurrentModel = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
    } as unknown as { getModel: () => string };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'stale-model',
        setCurrentModel,
        getActiveModelName,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('provider-model');
  });

  it('falls back to config model when runtime model is blank', () => {
    const setCurrentModel = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('   ');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
    } as unknown as { getModel: () => string };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'old-model',
        setCurrentModel,
        getActiveModelName,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('config-model');
  });

  it('does not update state when effective model already matches current model', () => {
    const setCurrentModel = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
    } as unknown as { getModel: () => string };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'provider-model',
        setCurrentModel,
        getActiveModelName,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();
  });

  it('polls every 500ms and clears interval on unmount', () => {
    const setCurrentModel = vi.fn();
    const getActiveModelName = vi
      .fn()
      .mockReturnValueOnce('provider-a')
      .mockReturnValueOnce('provider-b')
      .mockReturnValueOnce('provider-c');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
    } as unknown as { getModel: () => string };

    const { unmount } = renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'none',
        setCurrentModel,
        getActiveModelName,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('provider-a');

    vi.advanceTimersByTime(500);
    expect(setCurrentModel).toHaveBeenCalledWith('provider-b');

    unmount();

    const callsAfterUnmount = setCurrentModel.mock.calls.length;
    vi.advanceTimersByTime(2000);

    expect(setCurrentModel).toHaveBeenCalledTimes(callsAfterUnmount);
  });
});
