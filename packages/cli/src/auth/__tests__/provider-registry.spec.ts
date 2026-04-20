/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderRegistry } from '../provider-registry.js';
import type { OAuthProvider, OAuthToken } from '../types.js';
import { LoadedSettings } from '../../config/settings.js';
import type { Settings } from '../../config/settings.js';

/**
 * Mock OAuth provider for testing
 */
function createMockProvider(
  name: string,
  overrides: Partial<OAuthProvider> = {},
): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(
      async (): Promise<OAuthToken> => ({
        access_token: `access_${name}`,
        refresh_token: `refresh_${name}`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
      }),
    ),
    getToken: vi.fn(async (): Promise<OAuthToken | null> => null),
    refreshToken: vi.fn(async (): Promise<OAuthToken | null> => null),
    ...overrides,
  };
}

function createLoadedSettings(
  overrides: Partial<Settings> = {},
): LoadedSettings {
  const emptySettings = {} as Settings;
  const userSettings = { ...overrides } as Settings;
  return new LoadedSettings(
    { path: '', settings: emptySettings },
    { path: '', settings: emptySettings },
    { path: '', settings: userSettings },
    { path: '', settings: emptySettings },
    true,
  );
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('registerProvider', () => {
    it('stores and retrieves providers by name', () => {
      const provider = createMockProvider('anthropic');
      registry.registerProvider(provider);

      const retrieved = registry.getProvider('anthropic');
      expect(retrieved).toBe(provider);
    });

    it('rejects null provider', () => {
      expect(() => {
        registry.registerProvider(null as unknown as OAuthProvider);
      }).toThrow('Provider cannot be null or undefined');
    });

    it('rejects undefined provider', () => {
      expect(() => {
        registry.registerProvider(undefined as unknown as OAuthProvider);
      }).toThrow('Provider cannot be null or undefined');
    });

    it('rejects provider without valid name', () => {
      const provider = { ...createMockProvider('test'), name: '' };
      expect(() => {
        registry.registerProvider(provider);
      }).toThrow('Provider must have a valid name');
    });

    it('rejects provider missing initiateAuth method', () => {
      const provider = {
        name: 'test',
        getToken: vi.fn(),
        refreshToken: vi.fn(),
      } as unknown as OAuthProvider;
      expect(() => {
        registry.registerProvider(provider);
      }).toThrow('Provider must implement initiateAuth method');
    });

    it('rejects provider missing getToken method', () => {
      const provider = {
        name: 'test',
        initiateAuth: vi.fn(),
        refreshToken: vi.fn(),
      } as unknown as OAuthProvider;
      expect(() => {
        registry.registerProvider(provider);
      }).toThrow('Provider must implement getToken method');
    });

    it('rejects provider missing refreshToken method', () => {
      const provider = {
        name: 'test',
        initiateAuth: vi.fn(),
        getToken: vi.fn(),
      } as unknown as OAuthProvider;
      expect(() => {
        registry.registerProvider(provider);
      }).toThrow('Provider must implement refreshToken method');
    });
  });

  describe('getProvider', () => {
    it('returns undefined for unknown providers', () => {
      expect(registry.getProvider('unknown')).toBeUndefined();
    });

    it('returns registered provider', () => {
      const provider = createMockProvider('qwen');
      registry.registerProvider(provider);

      expect(registry.getProvider('qwen')).toBe(provider);
    });
  });

  describe('getSupportedProviders', () => {
    it('returns empty array when no providers registered', () => {
      expect(registry.getSupportedProviders()).toStrictEqual([]);
    });

    it('returns all registered provider names sorted', () => {
      registry.registerProvider(createMockProvider('qwen'));
      registry.registerProvider(createMockProvider('anthropic'));
      registry.registerProvider(createMockProvider('gemini'));

      expect(registry.getSupportedProviders()).toStrictEqual([
        'anthropic',
        'gemini',
        'qwen',
      ]);
    });
  });

  describe('toggleOAuthEnabled', () => {
    it('throws error for unknown provider', () => {
      expect(() => {
        registry.toggleOAuthEnabled('unknown');
      }).toThrow('Unknown provider: unknown');
    });

    it('toggles OAuth state from false to true', () => {
      const provider = createMockProvider('anthropic');
      registry.registerProvider(provider);

      const newState = registry.toggleOAuthEnabled('anthropic');
      expect(newState).toBe(true);
      expect(registry.isOAuthEnabled('anthropic')).toBe(true);
    });

    it('toggles OAuth state from true to false', () => {
      const provider = createMockProvider('anthropic');
      registry.registerProvider(provider);
      registry.setOAuthEnabledState('anthropic', true);

      const newState = registry.toggleOAuthEnabled('anthropic');
      expect(newState).toBe(false);
      expect(registry.isOAuthEnabled('anthropic')).toBe(false);
    });
  });

  describe('isOAuthEnabled', () => {
    it('returns false when no settings and no in-memory state', () => {
      expect(registry.isOAuthEnabled('anthropic')).toBe(false);
    });

    it('returns true when in-memory state is true', () => {
      registry.setOAuthEnabledState('anthropic', true);
      expect(registry.isOAuthEnabled('anthropic')).toBe(true);
    });

    it('returns false when in-memory state is false', () => {
      registry.setOAuthEnabledState('anthropic', false);
      expect(registry.isOAuthEnabled('anthropic')).toBe(false);
    });

    it('reads from settings when available', () => {
      const settings = createLoadedSettings({
        oauthEnabledProviders: { gemini: true },
      });
      const settingsRegistry = new ProviderRegistry(settings);

      expect(settingsRegistry.isOAuthEnabled('gemini')).toBe(true);
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(false);
    });

    it('in-memory state overrides settings when set explicitly', () => {
      const settings = createLoadedSettings({
        oauthEnabledProviders: { anthropic: true },
      });
      const settingsRegistry = new ProviderRegistry(settings);

      // Settings say true, then in-memory override
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(true);

      settingsRegistry.setOAuthEnabledState('anthropic', false);
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(false);
    });
  });

  describe('setOAuthEnabledState', () => {
    it('sets in-memory state when no settings', () => {
      registry.setOAuthEnabledState('anthropic', true);
      expect(registry.isOAuthEnabled('anthropic')).toBe(true);

      registry.setOAuthEnabledState('anthropic', false);
      expect(registry.isOAuthEnabled('anthropic')).toBe(false);
    });

    it('persists to settings when available', () => {
      const settings = createLoadedSettings({
        oauthEnabledProviders: {},
      });
      const settingsRegistry = new ProviderRegistry(settings);

      settingsRegistry.setOAuthEnabledState('anthropic', true);

      // Check settings was updated
      expect(settings.merged.oauthEnabledProviders?.['anthropic']).toBe(true);
    });
  });

  describe('hasExplicitInMemoryOAuthState', () => {
    it('returns false when no in-memory state set', () => {
      expect(registry.hasExplicitInMemoryOAuthState('anthropic')).toBe(false);
    });

    it('returns true when in-memory state is explicitly set', () => {
      registry.setOAuthEnabledState('anthropic', true);
      expect(registry.hasExplicitInMemoryOAuthState('anthropic')).toBe(true);
    });

    it('returns true when in-memory state is explicitly set to false', () => {
      registry.setOAuthEnabledState('anthropic', false);
      expect(registry.hasExplicitInMemoryOAuthState('anthropic')).toBe(true);
    });

    it('returns false for different provider', () => {
      registry.setOAuthEnabledState('anthropic', true);
      expect(registry.hasExplicitInMemoryOAuthState('gemini')).toBe(false);
    });
  });

  describe('with settings integration', () => {
    it('settings oauthEnabledProviders is checked first', () => {
      const settings = createLoadedSettings({
        oauthEnabledProviders: { qwen: true, gemini: false },
      });
      const settingsRegistry = new ProviderRegistry(settings);

      expect(settingsRegistry.isOAuthEnabled('qwen')).toBe(true);
      expect(settingsRegistry.isOAuthEnabled('gemini')).toBe(false);
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(false);
    });

    it('in-memory state takes precedence over settings', () => {
      const settings = createLoadedSettings({
        oauthEnabledProviders: { anthropic: true },
      });
      const settingsRegistry = new ProviderRegistry(settings);

      // Initially uses settings
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(true);

      // Set in-memory to false
      settingsRegistry.setOAuthEnabledState('anthropic', false);

      // Now in-memory takes precedence
      expect(settingsRegistry.isOAuthEnabled('anthropic')).toBe(false);
    });
  });
});
