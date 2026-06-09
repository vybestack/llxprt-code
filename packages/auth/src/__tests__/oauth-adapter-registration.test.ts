/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P13
 * @requirement REQ-ADAPTER-001.1, REQ-ADAPTER-001.2
 *
 * Task 3: Adapter registration test proving a new provider can be
 * registered/injected without auth package changes, and that
 * AuthPrecedenceResolver does not hard-code provider-specific OAuth logic.
 *
 * No mock theater — all doubles are in-memory implementations with real behavior.
 * No reverse testing — we assert on resolved auth results, not on internal structure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthPrecedenceResolver } from '../auth-precedence-resolver.js';
import type { OAuthManager, OAuthTokenRequestMetadata } from '../precedence.js';
import type { OAuthToken } from '../types.js';
import { ensureRuntimeState, runtimeScopedStates } from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';

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

// ─── Fake provider OAuthManagers ─────────────────────────────────────────────

/**
 * Simulates a brand-new provider ("acme-ai") that didn't exist when the auth
 * package was written. Proves that new providers can be injected without any
 * auth package changes.
 */
class AcmeOAuthManager implements OAuthManager {
  async getToken(provider: string): Promise<string | null> {
    if (provider === 'acme-ai') {
      return 'acme-ai-access-token-xyz';
    }
    return null;
  }

  async isAuthenticated(provider: string): Promise<boolean> {
    return provider === 'acme-ai';
  }

  async getOAuthToken(provider: string): Promise<OAuthToken | null> {
    if (provider === 'acme-ai') {
      return {
        access_token: 'acme-ai-access-token-xyz',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
    }
    return null;
  }
}

/**
 * Simulates another new provider ("zetacorp") with different token format.
 * Proves the auth package doesn't hard-code any specific provider behavior.
 */
class ZetaCorpOAuthManager implements OAuthManager {
  async getToken(provider: string): Promise<string | null> {
    if (provider === 'zetacorp') {
      return 'zetacorp-bearer-abc123';
    }
    return null;
  }

  async isAuthenticated(provider: string): Promise<boolean> {
    return provider === 'zetacorp';
  }
}

/**
 * A multi-provider OAuthManager that handles multiple providers.
 * Proves that a single OAuthManager can serve multiple providers
 * and the auth package doesn't restrict this.
 */
class MultiProviderOAuthManager implements OAuthManager {
  private providerTokens = new Map<string, string>();

  registerProviderToken(provider: string, token: string): void {
    this.providerTokens.set(provider, token);
  }

  async getToken(provider: string): Promise<string | null> {
    return this.providerTokens.get(provider) ?? null;
  }

  async isAuthenticated(provider: string): Promise<boolean> {
    return this.providerTokens.has(provider);
  }

  async getOAuthToken(provider: string): Promise<OAuthToken | null> {
    const token = this.providerTokens.get(provider);
    if (!token) return null;
    return {
      access_token: token,
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Adapter registration and provider injection', () => {
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

  describe('new provider registration without auth package changes', () => {
    it('AcmeOAuthManager resolves tokens for a previously unknown provider', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new AcmeOAuthManager();

      const runtimeContext = createTestRuntimeContext(
        'runtime-acme-registration',
        settings,
      );

      // AuthPrecedenceResolver doesn't know anything about "acme-ai" —
      // it just passes the provider name to the OAuthManager
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'acme-ai',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'acme-ai',
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
      expect(result).toBe('acme-ai-access-token-xyz');
    });

    it('ZetaCorpOAuthManager resolves tokens for a different unknown provider', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new ZetaCorpOAuthManager();

      const runtimeContext = createTestRuntimeContext(
        'runtime-zetacorp-registration',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'zetacorp',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'zetacorp',
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
      expect(result).toBe('zetacorp-bearer-abc123');
    });

    it('MultiProviderOAuthManager handles multiple providers simultaneously', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager = new MultiProviderOAuthManager();
      oauthManager.registerProviderToken('provider-alpha', 'alpha-token');
      oauthManager.registerProviderToken('provider-beta', 'beta-token');

      const runtimeContext = createTestRuntimeContext(
        'runtime-multi-registration',
        settings,
      );

      // Resolve for alpha
      const resolverAlpha = new AuthPrecedenceResolver(
        {
          providerId: 'provider-alpha',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'provider-alpha',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );
      const alphaResult = await resolverAlpha.resolveAuthentication({
        includeOAuth: true,
      });
      expect(alphaResult).toBe('alpha-token');

      // Resolve for beta
      const resolverBeta = new AuthPrecedenceResolver(
        {
          providerId: 'provider-beta',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'provider-beta',
        },
        {
          settingsService: settings,
          oauthManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );
      const betaResult = await resolverBeta.resolveAuthentication({
        includeOAuth: true,
      });
      expect(betaResult).toBe('beta-token');
    });
  });

  describe('AuthPrecedenceResolver does not hard-code provider-specific logic', () => {
    it('resolver uses provider name from config, not hardcoded values', async () => {
      const settings = createInMemorySettingsService();

      // Track which provider name the OAuthManager receives
      let receivedProvider: string | null = null;
      const trackingManager: OAuthManager = {
        getToken: async (provider: string) => {
          receivedProvider = provider;
          return `tracked-${provider}-token`;
        },
        isAuthenticated: async () => true,
        getOAuthToken: async (provider: string) => ({
          access_token: `tracked-${provider}-token`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const runtimeContext = createTestRuntimeContext(
        'runtime-tracking',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'brand-new-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'brand-new-provider',
        },
        {
          settingsService: settings,
          oauthManager: trackingManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('tracked-brand-new-provider-token');
      // The resolver passed the config's provider name — not a hardcoded one
      expect(receivedProvider).toBe('brand-new-provider');
    });

    it('resolver works with any arbitrary string as provider name', async () => {
      const settings = createInMemorySettingsService();
      const oauthManager: OAuthManager = {
        getToken: async (provider: string) => `token-for-${provider}`,
        isAuthenticated: async () => true,
        getOAuthToken: async (provider: string) => ({
          access_token: `token-for-${provider}`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const providerNames = [
        'completely-arbitrary',
        'x-'.repeat(20), // long name
        'provider-with-special_chars.v2',
      ];

      for (const providerName of providerNames) {
        // Clean runtime state between iterations
        for (const key of [...runtimeScopedStates.keys()]) {
          runtimeScopedStates.delete(key);
        }
        const ctx = createTestRuntimeContext(
          `runtime-${providerName}`,
          settings,
        );

        const resolver = new AuthPrecedenceResolver(
          {
            providerId: providerName,
            isOAuthEnabled: true,
            supportsOAuth: true,
            oauthProvider: providerName,
          },
          {
            settingsService: settings,
            oauthManager,
            getActiveRuntimeContext: () => ctx,
          },
        );

        const result = await resolver.resolveAuthentication({
          includeOAuth: true,
        });
        expect(result).toBe(`token-for-${providerName}`);
      }
    });

    it('resolver passes OAuthTokenRequestMetadata through to OAuthManager', async () => {
      const settings = createInMemorySettingsService();

      let receivedMetadata: OAuthTokenRequestMetadata | undefined;
      const metadataManager: OAuthManager = {
        getToken: async (
          _provider: string,
          metadata?: OAuthTokenRequestMetadata,
        ) => {
          receivedMetadata = metadata;
          return 'metadata-aware-token';
        },
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: 'metadata-aware-token',
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const runtimeContext = createTestRuntimeContext(
        'runtime-metadata',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'metadata-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'metadata-provider',
        },
        {
          settingsService: settings,
          oauthManager: metadataManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('metadata-aware-token');
      // The resolver constructed metadata with provider-specific info
      expect(receivedMetadata).toBeDefined();
      expect(receivedMetadata!.providerId).toBe('metadata-provider');
    });
  });

  describe('adapter injection without auth source modification', () => {
    it('a lambda-based OAuthManager works without any class definition', async () => {
      const settings = createInMemorySettingsService();

      // Simple object literal satisfies OAuthManager — no class needed
      const lambdaManager: OAuthManager = {
        getToken: async (provider: string) =>
          `lambda-${provider}-${Date.now()}`,
        isAuthenticated: async () => true,
        getOAuthToken: async (provider: string) => ({
          access_token: `lambda-${provider}`,
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const runtimeContext = createTestRuntimeContext(
        'runtime-lambda',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'lambda-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'lambda-provider',
        },
        {
          settingsService: settings,
          oauthManager: lambdaManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toMatch(/^lambda-lambda-provider-/);
    });

    it('an OAuthManager that throws on getToken results in null resolution', async () => {
      const settings = createInMemorySettingsService();

      const errorManager: OAuthManager = {
        getToken: async () => {
          throw new Error('OAuth service unavailable');
        },
        isAuthenticated: async () => false,
      };

      const runtimeContext = createTestRuntimeContext(
        'runtime-error',
        settings,
      );

      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'error-provider',
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'error-provider',
        },
        {
          settingsService: settings,
          oauthManager: errorManager,
          getActiveRuntimeContext: () => runtimeContext,
        },
      );

      // Resolver catches the error and returns null gracefully
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBeNull();
    });
  });
});
