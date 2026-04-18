/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
    get: vi.fn(() => 'openai'),
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

vi.mock('../providers/providerAliases.js', () => ({
  loadProviderAliasEntries: vi.fn(() => []),
}));

vi.mock('../providers/oauth-provider-registration.js', () => ({
  ensureOAuthProviderRegistered: vi.fn(),
}));

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
  });
});
