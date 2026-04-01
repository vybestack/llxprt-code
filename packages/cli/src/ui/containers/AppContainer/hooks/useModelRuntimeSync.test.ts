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
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as {
      getModel: () => string;
      getEphemeralSetting: (key: string) => number | undefined;
    };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'stale-model',
        contextLimit: undefined,
        setCurrentModel,
        getActiveModelName,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('provider-model');
  });

  it('falls back to config model when runtime model is blank', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('   ');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as {
      getModel: () => string;
      getEphemeralSetting: (key: string) => number | undefined;
    };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'old-model',
        contextLimit: undefined,
        setCurrentModel,
        getActiveModelName,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('config-model');
  });

  it('does not update state when effective model already matches current model', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as {
      getModel: () => string;
      getEphemeralSetting: (key: string) => number | undefined;
    };

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'provider-model',
        contextLimit: undefined,
        setCurrentModel,
        getActiveModelName,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();
  });

  it('polls every 500ms and clears interval on unmount', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi
      .fn()
      .mockReturnValueOnce('provider-a')
      .mockReturnValueOnce('provider-b')
      .mockReturnValueOnce('provider-c');
    const config = {
      getModel: vi.fn().mockReturnValue('config-model'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as {
      getModel: () => string;
      getEphemeralSetting: (key: string) => number | undefined;
    };

    const { unmount } = renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'none',
        contextLimit: undefined,
        setCurrentModel,
        getActiveModelName,
        setContextLimit,
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

  describe('contextLimit tracking', () => {
    it('detects contextLimit changes and calls setContextLimit', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('same-model');
      const config = {
        getModel: vi.fn().mockReturnValue('same-model'),
        getEphemeralSetting: vi
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(200000),
      } as unknown as {
        getModel: () => string;
        getEphemeralSetting: (key: string) => number | undefined;
      };

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'same-model',
          contextLimit: undefined,
          setCurrentModel,
          getActiveModelName,
          setContextLimit,
        }),
      );

      expect(setContextLimit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);

      expect(setContextLimit).toHaveBeenCalledWith(200000);
    });

    it('does not call setContextLimit when contextLimit has not changed', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('same-model');
      const config = {
        getModel: vi.fn().mockReturnValue('same-model'),
        getEphemeralSetting: vi.fn().mockReturnValue(200000),
      } as unknown as {
        getModel: () => string;
        getEphemeralSetting: (key: string) => number | undefined;
      };

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'same-model',
          contextLimit: 200000,
          setCurrentModel,
          getActiveModelName,
          setContextLimit,
        }),
      );

      expect(setContextLimit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(500);

      expect(setContextLimit).not.toHaveBeenCalled();
    });

    it('detects both model and contextLimit changes simultaneously', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi
        .fn()
        .mockReturnValueOnce('old-model')
        .mockReturnValueOnce('new-model');
      const config = {
        getModel: vi.fn().mockReturnValue('old-model'),
        getEphemeralSetting: vi
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(200000),
      } as unknown as {
        getModel: () => string;
        getEphemeralSetting: (key: string) => number | undefined;
      };

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'old-model',
          contextLimit: undefined,
          setCurrentModel,
          getActiveModelName,
          setContextLimit,
        }),
      );

      expect(setCurrentModel).not.toHaveBeenCalled();
      expect(setContextLimit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);

      expect(setCurrentModel).toHaveBeenCalledWith('new-model');
      expect(setContextLimit).toHaveBeenCalledWith(200000);
    });
  });
});
