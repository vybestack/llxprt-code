/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P13
 * @requirement REQ-OAUTH-001.1, REQ-ADAPTER-001.1
 *
 * Task 2: Behavioral test that AuthPrecedenceResolver works with an
 * in-memory/fake OAuthManager implementation.
 *
 * Assertions on resolved auth RESULTS (the token string or null), not on
 * mock call counts. No mock theater — all doubles are minimal in-memory
 * implementations with real behavior.
 *
 * These tests prove the AuthPrecedenceResolver is genuinely decoupled from
 * any specific OAuth implementation and works purely through the OAuthManager
 * interface contract defined in the auth package.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthPrecedenceResolver } from '../auth-precedence-resolver.js';
import type { OAuthManager } from '../precedence.js';
import type { OAuthToken } from '../types.js';
import { ensureRuntimeState, runtimeScopedStates } from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';

// ─── In-memory fake OAuthManager ─────────────────────────────────────────────

/**
 * A completely in-memory fake OAuthManager. No network, no keychain, no CLI
 * dependencies. Proves that AuthPrecedenceResolver works with ANY implementation
 * of the OAuthManager interface.
 */
class InMemoryOAuthManager implements OAuthManager {
  private tokens = new Map<string, string>();
  private oauthTokens = new Map<string, OAuthToken>();

  setToken(provider: string, token: string): void {
    this.tokens.set(provider, token);
  }

  setOAuthToken(provider: string, token: OAuthToken): void {
    this.oauthTokens.set(provider, token);
  }

  async getToken(provider: string): Promise<string | null> {
    return this.tokens.get(provider) ?? null;
  }

  async isAuthenticated(provider: string): Promise<boolean> {
    return this.tokens.has(provider);
  }

  async getOAuthToken(provider: string): Promise<OAuthToken | null> {
    return this.oauthTokens.get(provider) ?? null;
  }
}

/**
 * A different fake OAuthManager to prove adapter swap works.
 * Returns fixed tokens with a "custom-" prefix to distinguish from InMemoryOAuthManager.
 */
class CustomOAuthManager implements OAuthManager {
  async getToken(provider: string): Promise<string | null> {
    return `custom-${provider}-token`;
  }

  async isAuthenticated(_provider: string): Promise<boolean> {
    return true;
  }
}

// ─── In-memory ISettingsService ──────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthPrecedenceResolver with in-memory/fake OAuthManager', () => {
  beforeEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  describe('OAuth token resolution with InMemoryOAuthManager', () => {
    it('resolves OAuth token when includeOAuth=true and no higher-priority auth', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('acme-provider', 'acme-oauth-token');
      oauthManager.setOAuthToken('acme-provider', {
        access_token: 'acme-oauth-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const runtimeContext = createTestRuntimeContext(
        'runtime-behavioral-1',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'acme-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'acme-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('acme-oauth-token');
    });

    it('returns null when OAuth manager has no token', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      // No token set — manager returns null

      const runtimeContext = createTestRuntimeContext(
        'runtime-behavioral-2',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'acme-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'acme-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBeNull();
    });

    it('higher-priority auth-key takes precedence over OAuth', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'priority-auth-key',
      });
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('acme-provider', 'acme-oauth-token');

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'acme-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'acme-provider',
        },
        {
          settingsService: settings,
          oauthManager,
        },
      );

      // Even with includeOAuth=true, auth-key wins
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('priority-auth-key');
    });

    it('OAuth token is resolved after env var fallback', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('test-provider', 'test-oauth-token');
      oauthManager.setOAuthToken('test-provider', {
        access_token: 'test-oauth-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const runtimeContext = createTestRuntimeContext(
        'runtime-behavioral-env',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'test-provider',
          envKeyNames: ['TEST_P13_OAUTH_ENV_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'test-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // Without env var, OAuth is resolved
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('test-oauth-token');
    });

    it('cached OAuth token is returned on subsequent resolution', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('cached-provider', 'initial-cached-token');
      oauthManager.setOAuthToken('cached-provider', {
        access_token: 'initial-cached-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const runtimeContext = createTestRuntimeContext(
        'runtime-behavioral-cache',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'cached-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'cached-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // First call — resolves and caches
      const first = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(first).toBe('initial-cached-token');

      // Change the underlying token — cached value should still be returned
      oauthManager.setToken('cached-provider', 'new-uncached-token');

      const second = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(second).toBe('initial-cached-token');
    });
  });

  describe('adapter swap — different OAuthManager implementations', () => {
    it('InMemoryOAuthManager resolves tokens correctly', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('test-provider', 'in-memory-token');
      oauthManager.setOAuthToken('test-provider', {
        access_token: 'in-memory-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const runtimeContext = createTestRuntimeContext(
        'runtime-swap-memory',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'test-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'test-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('in-memory-token');
    });

    it('CustomOAuthManager resolves tokens correctly', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new CustomOAuthManager();

      const runtimeContext = createTestRuntimeContext(
        'runtime-swap-custom',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'custom-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'custom-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('custom-custom-provider-token');
    });

    it('updateOAuthManager swaps implementation at runtime', async () => {
      const settings = createInMemorySettingsService();

      const managerA = new InMemoryOAuthManager();
      managerA.setToken('swap-provider', 'token-from-A');
      managerA.setOAuthToken('swap-provider', {
        access_token: 'token-from-A',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const managerB = new CustomOAuthManager();

      const runtimeContext = createTestRuntimeContext(
        'runtime-swap-dynamic',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'swap-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'swap-provider',
        },
        {
          settingsService: settings,
          oauthManager: managerA,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // With managerA
      const resultA = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(resultA).toBe('token-from-A');

      // Swap to managerB — invalidate cache first
      resolver.updateOAuthManager(managerB);
      resolver.invalidateCache();

      const resultB = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(resultB).toBe('custom-swap-provider-token');
    });
  });

  describe('full precedence chain with OAuth at bottom', () => {
    it('constructor API key beats OAuth', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('precedence-provider', 'oauth-should-lose');

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'precedence-provider',
          apiKey: 'api-key-wins',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'precedence-provider',
        },
        {
          settingsService: settings,
          oauthManager,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('api-key-wins');
    });

    it('env var beats OAuth', async () => {
      process.env.TEST_P13_PRECEDENCE_ENV = 'env-wins';
      try {
        const settings = createInMemorySettingsService();
        const oauthManager = new InMemoryOAuthManager();
        oauthManager.setToken('precedence-provider', 'oauth-should-lose');

        const resolver = new AuthPrecedenceResolver(
          {
            providerId: 'precedence-provider',
            envKeyNames: ['TEST_P13_PRECEDENCE_ENV'],
            isOAuthEnabled: true,
            supportsOAuth: true,
            oauthProvider: 'precedence-provider',
          },
          {
            settingsService: settings,
            oauthManager,
          },
        );

        const result = await resolver.resolveAuthentication({
          includeOAuth: true,
        });
        expect(result).toBe('env-wins');
      } finally {
        delete process.env.TEST_P13_PRECEDENCE_ENV;
      }
    });

    it('OAuth is resolved when no higher-priority auth exists', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('oauth-only-provider', 'oauth-wins');
      oauthManager.setOAuthToken('oauth-only-provider', {
        access_token: 'oauth-wins',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const runtimeContext = createTestRuntimeContext(
        'runtime-precedence-oauth',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'oauth-only-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'oauth-only-provider',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('oauth-wins');
    });

    it('returns null when no auth available and OAuth not included', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new InMemoryOAuthManager();
      oauthManager.setToken('excluded-provider', 'should-not-be-returned');

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'excluded-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'excluded-provider',
        },
        {
          settingsService: settings,
          oauthManager,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: false,
      });
      expect(result).toBeNull();
    });

    it('isOAuthOnlyAvailable returns true when only OAuth is available', async () => {
      const settings = createInMemorySettingsService();

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'oauth-only-check',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'oauth-only-check',
        },
        {
          settingsService: settings,
          oauthManager: new InMemoryOAuthManager(),
        },
      );

      const isOnly = await resolver.isOAuthOnlyAvailable();
      expect(isOnly).toBe(true);
    });

    it('isOAuthOnlyAvailable returns false when non-OAuth auth exists', async () => {
      const settings = createInMemorySettingsService({
        'auth-key': 'non-oauth-key',
      });

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'mixed-auth-check',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'mixed-auth-check',
        },
        {
          settingsService: settings,
          oauthManager: new InMemoryOAuthManager(),
        },
      );

      const isOnly = await resolver.isOAuthOnlyAvailable();
      expect(isOnly).toBe(false);
    });
  });
});
