/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { useModelRuntimeSync } from './useModelRuntimeSync.js';
import {
  coreEvents,
  CoreEvent,
  type ModelProfileInfoPayload,
} from '@vybestack/llxprt-code-core';

function createConfig(
  model = 'config-model',
  contextLimit?: number,
): {
  getModel: () => string;
  getEphemeralSetting: (key: string) => number | undefined;
} {
  return {
    getModel: vi.fn().mockReturnValue(model),
    getEphemeralSetting: vi.fn().mockReturnValue(contextLimit),
  } as unknown as {
    getModel: () => string;
    getEphemeralSetting: (key: string) => number | undefined;
  };
}

describe('useModelRuntimeSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    coreEvents.removeAllListeners();
  });

  afterEach(() => {
    vi.useRealTimers();
    coreEvents.removeAllListeners();
    vi.clearAllMocks();
  });

  it('uses provider model on initial sync when runtime model is non-empty', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = createConfig();

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'stale-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('provider-model');
  });

  it('falls back to config model when runtime model is blank', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('   ');
    const config = createConfig('config-model');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'old-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).toHaveBeenCalledWith('config-model');
  });

  it('does not update state when effective model already matches current model', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = createConfig();

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'provider-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();
  });

  it('updates model when ModelProfileChanged event is emitted', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-a');
    const config = createConfig();

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'provider-a',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();

    getActiveModelName.mockReturnValue('provider-b');
    const payload: ModelProfileInfoPayload = {
      model: 'provider-b',
      providerName: 'openai',
      profileName: 'work',
      displayLabel: 'work',
    };
    coreEvents.emitModelProfileChanged(payload);

    expect(setCurrentModel).toHaveBeenCalledWith('provider-b');
  });

  it('updates model when ModelChanged event is emitted', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('model-a');
    const config = createConfig('model-a');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'model-a',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();

    getActiveModelName.mockReturnValue('model-b');
    coreEvents.emitModelChanged('model-b');

    expect(setCurrentModel).toHaveBeenCalledWith('model-b');
  });

  it('updates model when SettingsChanged event is emitted', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('same-model');
    const config = createConfig('same-model');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'same-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(setCurrentModel).not.toHaveBeenCalled();

    getActiveModelName.mockReturnValue('new-model');
    coreEvents.emitSettingsChanged();

    expect(setCurrentModel).toHaveBeenCalledWith('new-model');
  });

  it('does not use setInterval polling', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('provider-model');
    const config = createConfig();

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'provider-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    const pollingIntervals = setIntervalSpy.mock.calls.filter(
      ([, delay]) => delay === 500,
    );
    expect(pollingIntervals).toHaveLength(0);
    setIntervalSpy.mockRestore();
  });

  it('cleans up event subscriptions on unmount', () => {
    const setCurrentModel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('same-model');
    const config = createConfig('same-model');

    const { unmount } = renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'same-model',
        setCurrentModel,
        getActiveModelName,
        contextLimit: undefined,
        setContextLimit,
      }),
    );

    expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBeGreaterThan(0);

    unmount();

    expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBe(0);
    expect(coreEvents.listenerCount(CoreEvent.ModelProfileChanged)).toBe(0);
    expect(coreEvents.listenerCount(CoreEvent.SettingsChanged)).toBe(0);
  });

  describe('contextLimit tracking', () => {
    it('detects contextLimit changes via event and calls setContextLimit', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('same-model');
      const config = createConfig('same-model', undefined);

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'same-model',
          setCurrentModel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      expect(setContextLimit).not.toHaveBeenCalled();

      config.getEphemeralSetting = vi.fn().mockReturnValue(200000);
      coreEvents.emitSettingsChanged();

      expect(setContextLimit).toHaveBeenCalledWith(200000);
    });

    it('does not call setContextLimit when contextLimit has not changed', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('same-model');
      const config = createConfig('same-model', 200000);

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'same-model',
          setCurrentModel,
          getActiveModelName,
          contextLimit: 200000,
          setContextLimit,
        }),
      );

      expect(setContextLimit).not.toHaveBeenCalled();

      coreEvents.emitSettingsChanged();
      coreEvents.emitSettingsChanged();

      expect(setContextLimit).not.toHaveBeenCalled();
    });

    it('detects both model and contextLimit changes simultaneously via event', () => {
      const setCurrentModel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('old-model');
      const config = createConfig('old-model', undefined);

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'old-model',
          setCurrentModel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      expect(setCurrentModel).not.toHaveBeenCalled();
      expect(setContextLimit).not.toHaveBeenCalled();

      getActiveModelName.mockReturnValue('new-model');
      config.getEphemeralSetting = vi.fn().mockReturnValue(200000);
      coreEvents.emitSettingsChanged();

      expect(setCurrentModel).toHaveBeenCalledWith('new-model');
      expect(setContextLimit).toHaveBeenCalledWith(200000);
    });
  });

  describe('profile-aware display label tracking', () => {
    it('updates modelLabel when ModelProfileChanged fires with same model but different profile', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('gpt-4o');
      const config = createConfig('gpt-4o');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'gpt-4o',
          setCurrentModel,
          currentModelLabel: 'work',
          setCurrentModelLabel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      // Footer label starts as 'work', model unchanged
      expect(setCurrentModel).not.toHaveBeenCalled();

      // Profile changes from 'work' to 'personal' but model string stays 'gpt-4o'
      coreEvents.emitModelProfileChanged({
        model: 'gpt-4o',
        providerName: 'openai',
        profileName: 'personal',
        displayLabel: 'personal',
      });

      // Model string unchanged so setCurrentModel not called
      expect(setCurrentModel).not.toHaveBeenCalled();
      // But the footer-visible label DID change
      expect(setCurrentModelLabel).toHaveBeenCalledWith('personal');
    });

    it('updates modelLabel when provider changes but model string is unchanged', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('llama3');
      const config = createConfig('llama3');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'llama3',
          setCurrentModel,
          currentModelLabel: 'ollama:llama3',
          setCurrentModelLabel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      // Provider changes from ollama to groq but model string stays 'llama3'
      coreEvents.emitModelProfileChanged({
        model: 'llama3',
        providerName: 'groq',
        profileName: null,
        displayLabel: 'groq:llama3',
      });

      // Model string unchanged
      expect(setCurrentModel).not.toHaveBeenCalled();
      // Label identity includes provider so it changed
      expect(setCurrentModelLabel).toHaveBeenCalledWith('groq:llama3');
    });

    it('does not call setCurrentModelLabel when identity is unchanged', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('gpt-4o');
      const config = createConfig('gpt-4o');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'gpt-4o',
          setCurrentModel,
          currentModelLabel: 'work',
          setCurrentModelLabel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      coreEvents.emitModelProfileChanged({
        model: 'gpt-4o',
        providerName: 'openai',
        profileName: 'work',
        displayLabel: 'work',
      });

      expect(setCurrentModelLabel).not.toHaveBeenCalled();
    });

    it('updates modelLabel on initial sync using computed display label', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('gpt-4o');
      const config = createConfig('gpt-4o');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'gpt-4o',
          setCurrentModel,
          currentModelLabel: '',
          setCurrentModelLabel,
          getActiveModelName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      expect(setCurrentModelLabel).toHaveBeenCalledWith('gpt-4o');
    });

    it('updates stale profile label when ModelChanged fires and provider/model differ', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('gpt-4o');
      const getActiveProviderName = vi.fn().mockReturnValue('openai');
      const config = createConfig('gpt-4o');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'gpt-4o',
          setCurrentModel,
          // Profile label set by a previous ModelProfileChanged event
          currentModelLabel: 'work-profile',
          setCurrentModelLabel,
          getActiveModelName,
          getActiveProviderName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      // No initial update — label already set
      expect(setCurrentModelLabel).not.toHaveBeenCalled();

      // Model changes via ModelChanged event (e.g. user switched model in-session)
      getActiveModelName.mockReturnValue('claude-sonnet');
      getActiveProviderName.mockReturnValue('anthropic');
      coreEvents.emitModelChanged('claude-sonnet');

      // Label should update from stale 'work-profile' to reflect new model
      expect(setCurrentModelLabel).toHaveBeenCalledWith(
        'anthropic:claude-sonnet',
      );
    });

    it('updates stale profile label when SettingsChanged fires and model changes', () => {
      const setCurrentModel = vi.fn();
      const setCurrentModelLabel = vi.fn();
      const setContextLimit = vi.fn();
      const getActiveModelName = vi.fn().mockReturnValue('gpt-4o');
      const getActiveProviderName = vi.fn().mockReturnValue('openai');
      const config = createConfig('gpt-4o');

      renderHook(() =>
        useModelRuntimeSync({
          config: config as never,
          currentModel: 'gpt-4o',
          setCurrentModel,
          currentModelLabel: 'old-profile',
          setCurrentModelLabel,
          getActiveModelName,
          getActiveProviderName,
          contextLimit: undefined,
          setContextLimit,
        }),
      );

      expect(setCurrentModelLabel).not.toHaveBeenCalled();

      getActiveModelName.mockReturnValue('llama3');
      getActiveProviderName.mockReturnValue('ollama');
      coreEvents.emitSettingsChanged();

      expect(setCurrentModelLabel).toHaveBeenCalledWith('ollama:llama3');
    });
  });
});

describe('useModelRuntimeSync profile-qualified footer identity (issue #2193)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    coreEvents.removeAllListeners();
  });

  afterEach(() => {
    vi.useRealTimers();
    coreEvents.removeAllListeners();
    vi.clearAllMocks();
  });

  it('computes the footer label from the injected identity resolver on initial sync', () => {
    const setCurrentModel = vi.fn();
    const setCurrentModelLabel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('gpt-4');
    const config = createConfig('gpt-4');
    // Issue #2193 req #1: standard profile identity is `profileName:modelName`.
    const resolveModelDisplayLabel = vi.fn().mockReturnValue('work:gpt-4');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'gpt-4',
        setCurrentModel,
        currentModelLabel: '',
        setCurrentModelLabel,
        getActiveModelName,
        resolveModelDisplayLabel,
        contextLimit: undefined,
        setContextLimit,
      } as never),
    );

    expect(resolveModelDisplayLabel).toHaveBeenCalled();
    expect(setCurrentModelLabel).toHaveBeenCalledWith('work:gpt-4');
  });

  it('recomputes the footer label when a LoadBalancerSelectionChanged trigger fires', () => {
    const setCurrentModel = vi.fn();
    const setCurrentModelLabel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('glm');
    const config = createConfig('glm');
    // Before the first request the identity is pending; after the LB selects a
    // sub-profile it resolves to `lb:<lb>:<sub>:<model>`.
    const resolveModelDisplayLabel = vi
      .fn()
      .mockReturnValueOnce('lb:glm:none:none')
      .mockReturnValue('lb:glm:zai:glm-4-zai');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'glm',
        setCurrentModel,
        currentModelLabel: undefined,
        setCurrentModelLabel,
        getActiveModelName,
        resolveModelDisplayLabel,
        contextLimit: undefined,
        setContextLimit,
      } as never),
    );

    // Initial sync seeds the pending identity.
    expect(setCurrentModelLabel).toHaveBeenLastCalledWith('lb:glm:none:none');

    // The provider emits a dedicated LoadBalancerSelectionChanged event when it
    // selects a sub-profile; the footer label must refresh to the live identity.
    coreEvents.emitLoadBalancerSelectionChanged({
      profileName: 'glm',
      subProfileName: 'zai',
      model: 'glm-4-zai',
    });

    expect(setCurrentModelLabel).toHaveBeenLastCalledWith(
      'lb:glm:zai:glm-4-zai',
    );
  });

  it('does not update the footer label when the resolved identity is unchanged', () => {
    const setCurrentModel = vi.fn();
    const setCurrentModelLabel = vi.fn();
    const setContextLimit = vi.fn();
    const getActiveModelName = vi.fn().mockReturnValue('gpt-4');
    const config = createConfig('gpt-4');
    const resolveModelDisplayLabel = vi.fn().mockReturnValue('work:gpt-4');

    renderHook(() =>
      useModelRuntimeSync({
        config: config as never,
        currentModel: 'gpt-4',
        setCurrentModel,
        currentModelLabel: 'work:gpt-4',
        setCurrentModelLabel,
        getActiveModelName,
        resolveModelDisplayLabel,
        contextLimit: undefined,
        setContextLimit,
      } as never),
    );

    setCurrentModelLabel.mockClear();
    coreEvents.emitModelChanged('gpt-4');

    expect(setCurrentModelLabel).not.toHaveBeenCalled();
  });
});
