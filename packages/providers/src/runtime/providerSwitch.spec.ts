/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { coreEvents } from '@vybestack/llxprt-code-core';
import { DEFAULT_PRESERVE_EPHEMERALS } from './providerSwitch.js';

vi.mock('./runtimeAccessors.js', () => {
  const mockConfig = {
    setEphemeralSetting: vi.fn(),
    getEphemeralSetting: vi.fn(),
    getEphemeralSettings: vi.fn(() => ({})),
    setProviderManager: vi.fn(),
    setProvider: vi.fn(),
    setModel: vi.fn(),
    getModel: vi.fn(() => 'gpt-4'),
    setBucketFailoverHandler: vi.fn(),
    setContentGeneratorConfig: vi.fn(),
    getContentGeneratorConfig: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const mockSettingsService = {
    set: vi.fn(),
    get: vi.fn((key: string) => (key === 'currentProfile' ? null : 'openai')),
    getProviderSetting: vi.fn(),
    setProviderSetting: vi.fn(),
    switchProvider: vi.fn(),
    providerSettings: vi.fn(() => ({})),
  };
  const mockProviderManager = {
    getActiveProviderName: vi.fn(() => 'openai'),
    setActiveProvider: vi.fn(),
    getActiveProvider: vi.fn(() => ({
      name: 'openai',
      getDefaultModel: vi.fn(() => 'gpt-4'),
      getModels: vi.fn(() => []),
    })),
    getProviderByName: vi.fn(() => ({
      name: 'gemini',
      getDefaultModel: vi.fn(() => 'gemini-2.0-flash'),
    })),
  };
  return {
    getCliRuntimeServices: vi.fn(() => ({
      config: mockConfig,
      settingsService: mockSettingsService,
      providerManager: mockProviderManager,
    })),
    getCliOAuthManager: vi.fn(() => null),
    getActiveModelName: vi.fn(() => 'gpt-4'),
    getActiveProviderName: vi.fn(() => 'openai'),
    getEphemeralSettings: vi.fn(() => ({})),
    setEphemeralSetting: vi.fn(),
    clearEphemeralSetting: vi.fn(),
    setActiveModelParam: vi.fn(),
    clearActiveModelParam: vi.fn(),
    _internal: {
      getProviderSettingsSnapshot: vi.fn(() => ({})),
      getActiveProviderOrThrow: vi.fn(() => ({
        name: 'openai',
        getDefaultModel: vi.fn(() => 'gpt-4'),
      })),
      resolveActiveProviderName: vi.fn(() => 'openai'),
      extractModelParams: vi.fn(() => ({})),
    },
  };
});

vi.mock('./providerMutations.js', () => ({
  computeModelDefaults: vi.fn(() => ({})),
  normalizeProviderBaseUrl: vi.fn(),
  extractProviderBaseUrl: vi.fn(() => undefined),
  updateActiveProviderApiKey: vi.fn(),
}));

vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerAliases.js',
  () => ({
    loadProviderAliasEntries: vi.fn(() => []),
  }),
);

vi.mock(
  '@vybestack/llxprt-code-providers/composition/oauth-provider-registration.js',
  () => ({
    ensureOAuthProviderRegistered: vi.fn(),
  }),
);

describe('providerSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DEFAULT_PRESERVE_EPHEMERALS', () => {
    it('should include expected keys for context preservation', () => {
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('context-limit');
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('max_tokens');
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('streaming');
    });

    it('should be a readonly array', () => {
      expect(Array.isArray(DEFAULT_PRESERVE_EPHEMERALS)).toBe(true);
    });
  });

  describe('switchActiveProvider', () => {
    it('should return unchanged result when switching to the same provider', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      const result = await switchActiveProvider('openai', {});

      expect(result.changed).toBe(false);
      expect(result.previousProvider).toBe('openai');
      expect(result.nextProvider).toBe('openai');
      expect(result.infoMessages).toStrictEqual([]);
    });

    it('should throw error when provider name is empty string', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      await expect(switchActiveProvider('', {})).rejects.toThrow(
        'Provider name is required.',
      );
    });

    it('should throw error when provider name is whitespace only', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      await expect(switchActiveProvider('   ', {})).rejects.toThrow(
        'Provider name is required.',
      );
    });

    it('emits ModelProfileChanged with resolved model when modelToApply is empty', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // computeModelDefaults mock returns {} so modelToApply stays empty.
      // getActiveModelName mock returns 'gpt-4' as fallback.
      await switchActiveProvider('gemini', {});

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Must NOT be empty string — should fall back to the active model
      expect(emitted.model).not.toBe('');
      expect(emitted.model).toBe('gpt-4');
      expect(emitted.displayLabel).not.toBe('');
    });

    it('does not emit empty model/displayLabel even when no default model exists', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // Make the provider return no default model so modelToApply resolves to ''
      const { getCliRuntimeServices } = await import('./runtimeAccessors.js');
      const mockFn = getCliRuntimeServices as unknown as ReturnType<
        typeof vi.fn
      >;
      mockFn.mockReturnValue({
        config: {
          setEphemeralSetting: vi.fn(),
          getEphemeralSetting: vi.fn(),
          getEphemeralSettings: vi.fn(() => ({})),
          setProviderManager: vi.fn(),
          setProvider: vi.fn(),
          setModel: vi.fn(),
          getModel: vi.fn(() => ''),
          setBucketFailoverHandler: vi.fn(),
          setContentGeneratorConfig: vi.fn(),
          getContentGeneratorConfig: vi.fn(),
          get: vi.fn(),
          set: vi.fn(),
        },
        settingsService: {
          set: vi.fn(),
          get: vi.fn(() => null),
          getProviderSetting: vi.fn(),
          setProviderSetting: vi.fn(),
          switchProvider: vi.fn(),
          providerSettings: vi.fn(() => ({})),
        },
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          getActiveProvider: vi.fn(() => ({
            name: 'openai',
            getDefaultModel: vi.fn(() => undefined),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => undefined),
          })),
        },
      });

      await switchActiveProvider('gemini', {});

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Even with no default model, must not emit empty string
      expect(emitted.model).not.toBe('');
      expect(emitted.displayLabel).not.toBe('');
    });

    it('does not emit empty displayLabel when no profile and no modelToApply', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      await switchActiveProvider('gemini', {});

      const emitted = emitSpy.mock.calls[0][0];
      expect(emitted.displayLabel).not.toBe('');
      // Falls back to active model name when no profile
      expect(emitted.displayLabel).toBe('gpt-4');
    });

    it('falls back to provider name when active model, config model, and provider default are all empty', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // Override mocks so ALL model sources return empty.
      // Provider manager active name must differ from the target ('gemini')
      // so that switchActiveProvider actually performs a switch.
      const { getCliRuntimeServices, getActiveModelName } = await import(
        './runtimeAccessors.js'
      );
      (
        getCliRuntimeServices as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        config: {
          setEphemeralSetting: vi.fn(),
          getEphemeralSetting: vi.fn(),
          getEphemeralSettings: vi.fn(() => ({})),
          setProviderManager: vi.fn(),
          setProvider: vi.fn(),
          setModel: vi.fn(),
          getModel: vi.fn(() => ''),
          setBucketFailoverHandler: vi.fn(),
          setContentGeneratorConfig: vi.fn(),
          getContentGeneratorConfig: vi.fn(),
          get: vi.fn(),
          set: vi.fn(),
        },
        settingsService: {
          set: vi.fn(),
          get: vi.fn(() => null),
          getProviderSetting: vi.fn(),
          setProviderSetting: vi.fn(),
          switchProvider: vi.fn(),
          providerSettings: vi.fn(() => ({})),
          getCurrentProfileName: vi.fn(() => null),
        },
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          getActiveProvider: vi.fn(() => ({
            name: 'openai',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      });
      (
        getActiveModelName as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue('');

      await switchActiveProvider('gemini', {});

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // model must NEVER be empty — fallback chain ends with provider name
      expect(emitted.model).not.toBe('');
      expect(emitted.model).toBe('gemini');
      // displayLabel must NEVER be empty either
      expect(emitted.displayLabel).not.toBe('');
      expect(emitted.displayLabel).toBe('gemini');
    });

    it('does not use stale getActiveModelName when modelToApply is empty; prefers context-scoped config model', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const { getCliRuntimeServices, getActiveModelName } = await import(
        './runtimeAccessors.js'
      );

      // modelToApply will be empty because provider has no default model.
      // config.getModel reflects the post-switch model.
      // getActiveModelName is STALE — returns the old provider's model.
      (
        getCliRuntimeServices as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        config: {
          setEphemeralSetting: vi.fn(),
          getEphemeralSetting: vi.fn(),
          getEphemeralSettings: vi.fn(() => ({})),
          setProviderManager: vi.fn(),
          setProvider: vi.fn(),
          setModel: vi.fn(),
          getModel: vi.fn(() => 'gemini-2.0-flash'),
          setBucketFailoverHandler: vi.fn(),
          setContentGeneratorConfig: vi.fn(),
          getContentGeneratorConfig: vi.fn(),
          get: vi.fn(),
          set: vi.fn(),
        },
        settingsService: {
          set: vi.fn(),
          get: vi.fn(() => null),
          getProviderSetting: vi.fn(),
          setProviderSetting: vi.fn(),
          switchProvider: vi.fn(),
          providerSettings: vi.fn(() => ({})),
          getCurrentProfileName: vi.fn(() => null),
        },
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          // No default model → modelToApply resolves to ''
          getActiveProvider: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      });
      // Stale global: still returns old provider's model
      (
        getActiveModelName as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue('gpt-4-stale');

      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');
      await switchActiveProvider('gemini', {});

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Must NOT use stale 'gpt-4-stale' from the global accessor.
      // Should use context-scoped config model 'gemini-2.0-flash'.
      expect(emitted.model).not.toBe('gpt-4-stale');
      expect(emitted.model).toBe('gemini-2.0-flash');
    });

    it('multi-provider: emitting context-scoped model, not stale global, when switching from openai to anthropic', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const { getCliRuntimeServices, getActiveModelName } = await import(
        './runtimeAccessors.js'
      );

      (
        getCliRuntimeServices as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        config: {
          setEphemeralSetting: vi.fn(),
          getEphemeralSetting: vi.fn(),
          getEphemeralSettings: vi.fn(() => ({})),
          setProviderManager: vi.fn(),
          setProvider: vi.fn(),
          setModel: vi.fn(),
          // Post-switch config model is the anthropic model
          getModel: vi.fn(() => 'claude-sonnet'),
          setBucketFailoverHandler: vi.fn(),
          setContentGeneratorConfig: vi.fn(),
          getContentGeneratorConfig: vi.fn(),
          get: vi.fn(),
          set: vi.fn(),
        },
        settingsService: {
          set: vi.fn(),
          get: vi.fn(() => null),
          getProviderSetting: vi.fn(),
          setProviderSetting: vi.fn(),
          switchProvider: vi.fn(),
          providerSettings: vi.fn(() => ({})),
          getCurrentProfileName: vi.fn(() => null),
        },
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          // No default model → modelToApply resolves to ''
          getActiveProvider: vi.fn(() => ({
            name: 'anthropic',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'anthropic',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      });
      // Stale global: still returns old openai model
      (
        getActiveModelName as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue('gpt-4o-stale');

      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');
      await switchActiveProvider('anthropic', {});

      const emitted = emitSpy.mock.calls[0][0];
      // Must use context-scoped model, not stale global
      expect(emitted.model).toBe('claude-sonnet');
      expect(emitted.providerName).toBe('anthropic');
    });
  });
});
