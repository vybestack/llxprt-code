/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P10
 * @requirement REQ-TEST-001.1, REQ-TEST-001.3
 *
 * AuthPrecedenceResolver DI behavioral tests.
 * Uses in-memory ISettingsService and DI doubles.
 * Assertions focus on resolution results and observable cache behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthPrecedenceResolver } from '../auth-precedence-resolver.js';
import type { OAuthManager } from '../precedence.js';
import { ensureRuntimeState, runtimeScopedStates } from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';
import type { IProviderKeyStorage } from '../interfaces/provider-key-storage.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

function createInMemorySettingsService(
  settings: Record<string, unknown> = {},
  providerSettings: Record<string, Record<string, unknown>> = {},
): ISettingsService & { emit(event: string, ...args: unknown[]): void } {
  const store = new Map<string, unknown>(Object.entries(settings));
  const providerStore = new Map<string, Record<string, unknown>>(
    Object.entries(providerSettings),
  );
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    get: (key: string) => store.get(key),
    getProviderSettings: (providerName: string) =>
      providerStore.get(providerName) ?? {},
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    },
    emit: (event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          handler(...args);
        }
      }
    },
  };
}

function createInMemoryKeyStorage(
  keys: Record<string, string> = {},
): IProviderKeyStorage {
  const store = new Map<string, string>(Object.entries(keys));
  return {
    getKey: async (name: string) => store.get(name) ?? null,
    listKeys: async () => [...store.keys()],
    hasKey: async (name: string) => store.has(name),
  };
}

function createTestRuntimeContext(
  runtimeId: string,
  settingsService?: ISettingsService,
): IProviderRuntimeContext {
  const context: IProviderRuntimeContext = {
    settingsService: settingsService ?? createInMemorySettingsService(),
    runtimeId,
    metadata: {},
  };
  ensureRuntimeState(context);
  return context;
}

function createOAuthManager(
  tokenValue: string = 'oauth-token-value',
): OAuthManager & { tokenCallCount: number } {
  return {
    tokenCallCount: 0,
    getToken: async () => tokenValue,
    isAuthenticated: async () => true,
    getOAuthToken: async () => ({
      access_token: tokenValue,
      token_type: 'Bearer' as const,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthPrecedenceResolver DI behavioral tests', () => {
  beforeEach(() => {
    // Clean up runtime states
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  describe('precedence chain resolution', () => {
    it('resolves auth-key from provider-specific settings first', async () => {
      const settings = createInMemorySettingsService(
        { 'auth-key': 'global-key' },
        { anthropic: { 'auth-key': 'provider-specific-key' } },
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          envKeyNames: ['ANTHROPIC_API_KEY'],
          apiKey: 'constructor-api-key',
        },
        { settingsService: settings },
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBe('provider-specific-key');
    });

    it('falls back to constructor API key when no provider-specific auth-key', async () => {
      const settings = createInMemorySettingsService();

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          apiKey: 'constructor-api-key',
        },
        { settingsService: settings },
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBe('constructor-api-key');
    });

    it('falls back to environment variable when no auth-key or API key', async () => {
      process.env.TEST_AUTH_API_KEY = 'env-key-value';
      try {
        const settings = createInMemorySettingsService();

        const resolver = new AuthPrecedenceResolver(
          {
            providerId: 'test-provider',
            envKeyNames: ['TEST_AUTH_API_KEY'],
          },
          { settingsService: settings },
        );

        const result = await resolver.resolveAuthentication();
        expect(result).toBe('env-key-value');
      } finally {
        delete process.env.TEST_AUTH_API_KEY;
      }
    });

    it('resolves global auth-key when activeProvider matches', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'global-key',
        activeProvider: 'anthropic',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'anthropic' },
        { settingsService: settings },
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBe('global-key');
    });

    it('skips global auth-key when activeProvider does not match', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'global-key',
        activeProvider: 'gemini',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'anthropic' },
        { settingsService: settings },
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBeNull();
    });

    it('resolves OAuth token when includeOAuth=true and no higher-priority auth', async () => {
      const settings = createInMemorySettingsService();
      const runtimeContext = createTestRuntimeContext(
        'runtime-oauth-test',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        {
          settingsService: settings,
          oauthManager: createOAuthManager('oauth-resolved-token'),
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('oauth-resolved-token');
    });

    it('returns null when no auth method available and OAuth not included', async () => {
      const settings = createInMemorySettingsService();

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'anthropic' },
        { settingsService: settings },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: false,
      });
      expect(result).toBeNull();
    });

    it('resolves named key via IProviderKeyStorage injection', async () => {
      const settings = createInMemorySettingsService({
        'auth-key-name': 'my-named-key',
      });
      const keyStorage = createInMemoryKeyStorage({
        'my-named-key': 'named-key-value',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'anthropic' },
        { settingsService: settings, providerKeyStorage: keyStorage },
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBe('named-key-value');
    });
  });

  describe('OAuthManager injection', () => {
    it('OAuth token is cached and served from cache on subsequent call', async () => {
      const settings = createInMemorySettingsService();
      const runtimeContext = createTestRuntimeContext(
        'runtime-cache-test',
        settings,
      );

      let fetchCount = 0;
      const oauthManager: OAuthManager = {
        getToken: async () => {
          fetchCount++;
          return 'cached-oauth-token';
        },
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: 'cached-oauth-token',
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // First call: fetches from OAuth
      const first = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(first).toBe('cached-oauth-token');
      expect(fetchCount).toBe(1);

      // Second call: served from cache
      const second = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(second).toBe('cached-oauth-token');
      expect(fetchCount).toBe(1); // No additional fetch
    });
  });

  describe('cache invalidation via ISettingsService events', () => {
    it('provider-change event invalidates cached entries for matching provider', async () => {
      const settings = createInMemorySettingsService();
      const runtimeContext = createTestRuntimeContext(
        'runtime-invalidation-event',
        settings,
      );

      let fetchCount = 0;
      const oauthManager: OAuthManager = {
        getToken: async () => {
          fetchCount++;
          return `token-v${fetchCount}`;
        },
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: `token-v${fetchCount}`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // Prime the cache
      const first = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(first).toBe('token-v1');
      expect(fetchCount).toBe(1);

      // Emit provider-change event for anthropic
      settings.emit('provider-change', { provider: 'anthropic' });

      // After invalidation, should refetch
      const second = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(second).toBe('token-v2');
      expect(fetchCount).toBe(2);
    });

    it('profile-change event invalidates all cached entries', async () => {
      const settings = createInMemorySettingsService();
      const runtimeContext = createTestRuntimeContext(
        'runtime-profile-change',
        settings,
      );

      let fetchCount = 0;
      const oauthManager: OAuthManager = {
        getToken: async () => {
          fetchCount++;
          return `token-profile-${fetchCount}`;
        },
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: `token-profile-${fetchCount}`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // Prime the cache
      await resolver.resolveAuthentication({ includeOAuth: true });
      expect(fetchCount).toBe(1);

      // Emit profile change
      settings.emit('change', { key: 'currentProfile' });

      // After profile change, cache should be invalidated
      await resolver.resolveAuthentication({ includeOAuth: true });
      expect(fetchCount).toBe(2);
    });

    it('settings-cleared event invalidates all cached entries', async () => {
      const settings = createInMemorySettingsService();
      const runtimeContext = createTestRuntimeContext(
        'runtime-cleared',
        settings,
      );

      let fetchCount = 0;
      const oauthManager: OAuthManager = {
        getToken: async () => {
          fetchCount++;
          return `token-cleared-${fetchCount}`;
        },
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: `token-cleared-${fetchCount}`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'anthropic',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // Prime the cache
      await resolver.resolveAuthentication({ includeOAuth: true });
      expect(fetchCount).toBe(1);

      // Emit settings cleared
      settings.emit('cleared');

      // After cleared event, cache should be invalidated
      await resolver.resolveAuthentication({ includeOAuth: true });
      expect(fetchCount).toBe(2);
    });
  });

  describe('setSettingsService DI', () => {
    it('setSettingsService updates the resolver for subsequent calls', async () => {
      const settings1 = createInMemorySettingsService({
        'auth-key': 'key-from-settings1',
      });
      const settings2 = createInMemorySettingsService({
        'auth-key': 'key-from-settings2',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test-provider' },
        { settingsService: settings1 },
      );

      const result1 = await resolver.resolveAuthentication();
      expect(result1).toBe('key-from-settings1');

      resolver.setSettingsService(settings2);

      const result2 = await resolver.resolveAuthentication();
      expect(result2).toBe('key-from-settings2');
    });
  });

  describe('getAuthMethodName', () => {
    it('returns auth method name based on resolution', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'test-key',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test-provider' },
        { settingsService: settings },
      );

      const method = await resolver.getAuthMethodName();
      expect(method).toBe('command-key');
    });

    it('returns constructor-apikey when config has apiKey', async () => {
      const settings = createInMemorySettingsService();

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test-provider', apiKey: 'my-key' },
        { settingsService: settings },
      );

      const method = await resolver.getAuthMethodName();
      expect(method).toBe('constructor-apikey');
    });
  });

  describe('hasNonOAuthAuthentication', () => {
    it('returns true when auth-key is set', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'my-key',
      });

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test-provider' },
        { settingsService: settings },
      );

      const has = await resolver.hasNonOAuthAuthentication();
      expect(has).toBe(true);
    });

    it('returns false when no auth available', async () => {
      const settings = createInMemorySettingsService();

      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test-provider' },
        { settingsService: settings },
      );

      const has = await resolver.hasNonOAuthAuthentication();
      expect(has).toBe(false);
    });
  });
});
