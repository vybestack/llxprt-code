/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AuthPrecedenceResolver } from '../auth-precedence-resolver.js';
import type { OAuthManager } from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';

/**
 * Real in-memory ISettingsService used by the resolver-backed integration
 * tests below (no stored keys — OAuth is the only auth source available).
 */
function createEmptySettingsService(): ISettingsService {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => store.get(key),
    getProviderSettings: () => ({}),
    on: () => {},
    off: () => {},
  };
}

/**
 * OAuth manager double whose token is DERIVED from the provider it is asked
 * for, recording each request so tests can assert exact fetch sequences.
 */
function createRecordingOAuthManager(tokenRequests: string[]): OAuthManager {
  return {
    getToken: async (provider: string) => {
      tokenRequests.push(provider);
      return `oauth-token-for-${provider}`;
    },
    isAuthenticated: async () => true,
  };
}

describe('Auth Integration: Complete Precedence Flow and Provider Coordination', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all auth-related env vars so tests are hermetic — ambient
    // developer credentials must not influence resolver behavior.
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Complete Auth Precedence Flow', () => {
    /**
     * @scenario Complete precedence chain with OAuth
     * @given Constructor apiKey, env var, and OAuth all available
     * @when Resolver resolves authentication
     * @then Uses constructor apiKey (highest precedence)
     * @and OAuth is not triggered
     */
    it('should follow complete precedence chain: CLI > Env > OAuth', async () => {
      // Given: All auth methods available — constructor key, env var, OAuth.
      process.env.OPENAI_API_KEY = 'env-key-456';
      const tokenRequests: string[] = [];
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          apiKey: 'cli-api-key-123',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );

      // When: Resolver resolves authentication with OAuth available.
      const resolvedAuth = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Constructor apiKey wins — the OAuth manager is never asked
      // for a token because a higher-precedence source answered first.
      expect(resolvedAuth).toBe('cli-api-key-123');
      expect(tokenRequests).toStrictEqual([]);
    });

    /**
     * @scenario Environment variable fallback
     * @given No constructor apiKey, env var and OAuth available
     * @when Resolver resolves authentication
     * @then Uses env var (second precedence)
     * @and OAuth is not triggered
     */
    it('should fall back to environment variable when no CLI arg', async () => {
      // Given: Env var and OAuth available, no constructor apiKey.
      process.env.OPENAI_API_KEY = 'env-key-456';
      const tokenRequests: string[] = [];
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );

      // When: Resolver resolves authentication with OAuth available.
      const resolvedAuth = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Environment variable wins over OAuth — the OAuth manager is
      // never asked for a token.
      expect(resolvedAuth).toBe('env-key-456');
      expect(tokenRequests).toStrictEqual([]);
    });

    /**
     * @scenario OAuth as final fallback
     * @given No CLI arg, no env var, OAuth enabled
     * @when Provider resolves authentication
     * @then Triggers lazy OAuth (lowest precedence)
     * @and Returns OAuth token
     */
    it('should use OAuth as final fallback when no higher precedence auth', async () => {
      // Given: Only OAuth available
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );

      // When: Provider resolves authentication with OAuth only
      const resolvedAuth = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: OAuth answers last — exactly one token fetch from the
      // configured OAuth provider, and the resolved key derives from it.
      expect(resolvedAuth).toBe('oauth-token-for-device-code-test');
      expect(tokenRequests).toStrictEqual(['device-code-test']);
    });
  });

  describe('AuthPrecedenceResolver Config-Gating', () => {
    /**
     * @scenario OAuth enablement config persists across resolver instances
     * @given OAuth enabled for device-code-test
     * @when New resolver instance is constructed from the updated config flag
     * @then OAuth reflects the new flag value
     * @and Can be toggled again
     */
    it('should gate OAuth on the isOAuthEnabled constructor flag across resolver instances', async () => {
      delete process.env.OPENAI_API_KEY;
      // The enablement flag is a constructor parameter: each new resolver
      // instance reads it at construction time, the way production wiring
      // reads stored enablement when constructing providers.
      const persistedEnablement: Record<string, boolean> = {};
      const tokenRequests: string[] = [];
      const buildResolver = (): AuthPrecedenceResolver =>
        new AuthPrecedenceResolver(
          {
            providerId: 'device-code-test',
            envKeyNames: ['OPENAI_API_KEY'],
            isOAuthEnabled: persistedEnablement['device-code-test'] ?? false,
            supportsOAuth: true,
            oauthProvider: 'device-code-test',
          },
          {
            settingsService: createEmptySettingsService(),
            oauthManager: createRecordingOAuthManager(tokenRequests),
          },
        );

      // Given: first resolver — enablement not yet set, OAuth never fires.
      await buildResolver().resolveAuthentication({ includeOAuth: true });
      expect(tokenRequests).toStrictEqual([]);

      // When: enablement is toggled and a new resolver instance is built
      persistedEnablement['device-code-test'] = true;
      const restarted = await buildResolver().resolveAuthentication({
        includeOAuth: true,
      });

      // Then: the new resolver sees the updated config.
      expect(restarted).toBe('oauth-token-for-device-code-test');
      expect(tokenRequests).toStrictEqual(['device-code-test']);

      // And: toggling to disabled affects the next instance the same way.
      persistedEnablement['device-code-test'] = false;
      const disabledResult = await buildResolver().resolveAuthentication({
        includeOAuth: true,
      });
      // The disabled resolver must return null (no auth), not a stale token.
      expect(disabledResult).toBeNull();
      // Token requests unchanged — no new OAuth request was made.
      expect(tokenRequests).toStrictEqual(['device-code-test']);
    });

    /**
     * @scenario Independent enablement per provider
     * @given Two resolvers with different OAuth enablement
     * @when Each resolves authentication
     * @then OAuth-enabled provider gets a token, disabled gets null
     * @and Token requests reflect independent enablement
     */
    it('should maintain independent OAuth enablement per provider', async () => {
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const sharedOAuthManager = createRecordingOAuthManager(tokenRequests);

      // Device-code-test: OAuth enabled.
      const deviceCodeResolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // Gemini: OAuth disabled.
      const geminiResolver = new AuthPrecedenceResolver(
        {
          providerId: 'gemini',
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: false,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // When: Each resolves authentication.
      const deviceCodeResult = await deviceCodeResolver.resolveAuthentication({
        includeOAuth: true,
      });
      const geminiResult = await geminiResolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Independent states — device-code-test gets a token,
      // gemini gets null (OAuth disabled, no env var).
      expect(deviceCodeResult).toBe('oauth-token-for-device-code-test');
      expect(geminiResult).toBeNull();

      // And: Only the OAuth-enabled provider's token was requested.
      expect(tokenRequests).toStrictEqual(['device-code-test']);
    });
  });

  describe('Lazy OAuth Triggering During API Calls', () => {
    /**
     * @scenario Lazy OAuth triggers on first API call
     * @given OAuth enabled but not authenticated
     * @when Resolver resolves auth with OAuth enabled
     * @then OAuth token returned from the OAuth manager
     * @and Token request recorded for the correct provider
     */
    it('should trigger OAuth lazily on first API call and delegate on subsequent calls', async () => {
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );

      // First resolution: no higher-precedence auth, OAuth fires.
      const firstToken = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(firstToken).toBe('oauth-token-for-device-code-test');
      expect(tokenRequests).toStrictEqual(['device-code-test']);

      // Second resolution: same result — the resolver delegates to the
      // OAuth manager on every call (no internal caching); the repeated
      // token request proves the resolver always delegates rather than
      // hard-coding a result.
      const secondToken = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(secondToken).toBe('oauth-token-for-device-code-test');
      expect(tokenRequests).toStrictEqual([
        'device-code-test',
        'device-code-test',
      ]);
    });

    /**
     * @scenario No OAuth triggering when disabled
     * @given OAuth disabled for provider
     * @when Resolver resolves auth
     * @then Returns null (no auth available)
     * @and No OAuth flow is triggered
     */
    it('should not trigger OAuth when disabled, causing auth to fail', async () => {
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const resolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: false,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );

      // When: Resolver resolves auth with OAuth disabled.
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: No auth available — null returned, no token request made.
      expect(result).toBeNull();
      expect(tokenRequests).toStrictEqual([]);
    });
  });

  describe('Provider Coordination with Auth System', () => {
    /**
     * @scenario Multiple providers coordinate with shared auth system
     * @given Device-code test provider and Gemini providers both using OAuth manager
     * @when Each provider resolves authentication independently
     * @then Each triggers OAuth only for its own provider
     * @and Auth states remain independent
     */
    it('should coordinate multiple providers with shared auth system', async () => {
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const sharedOAuthManager = createRecordingOAuthManager(tokenRequests);

      // Device-code-test: OAuth enabled, resolves to OAuth token.
      const deviceCodeResolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // Gemini: OAuth disabled, no env var — resolves to null.
      const geminiResolver = new AuthPrecedenceResolver(
        {
          providerId: 'gemini',
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: false,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // When: Both providers resolve authentication.
      const deviceCodeAuth = await deviceCodeResolver.resolveAuthentication({
        includeOAuth: true,
      });
      const geminiAuth = await geminiResolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Each provider gets appropriate result — device-code-test
      // gets an OAuth token, gemini gets null (OAuth disabled, no env var).
      expect(deviceCodeAuth).toBe('oauth-token-for-device-code-test');
      expect(geminiAuth).toBeNull();

      // And: Only the OAuth-enabled provider's token was requested.
      expect(tokenRequests).toStrictEqual(['device-code-test']);
    });

    /**
     * @scenario Auth method name reflects the live auth source
     * @given Provider with OAuth enabled and no higher-precedence auth
     * @when getAuthMethodName called
     * @then Returns the OAuth method name
     * @and A provider with a constructor key returns the constructor method name
     */
    it('should report the correct auth method name per provider', async () => {
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const sharedOAuthManager = createRecordingOAuthManager(tokenRequests);

      // OAuth-only provider.
      const oauthResolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // Constructor-key provider.
      const keyResolver = new AuthPrecedenceResolver(
        {
          providerId: 'gemini',
          apiKey: 'constructor-key-abc',
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // OAuth-only provider reports the OAuth method name.
      expect(await oauthResolver.getAuthMethodName()).toBe(
        'oauth-device-code-test',
      );

      // Constructor-key provider reports the constructor method name.
      expect(await keyResolver.getAuthMethodName()).toBe('constructor-apikey');

      // OAuth manager was never asked for a token by the key resolver.
      expect(tokenRequests).toStrictEqual([]);
    });
  });

  describe('End-to-End Integration Scenarios', () => {
    /**
     * @scenario Complete config-gated workflow: enable OAuth, make API call, check status
     * @given Fresh resolver with no stored keys, OAuth enablement off
     * @when Enablement toggled on, API call resolves auth, status checked
     * @then All steps succeed with proper coordination
     */
    it('should handle complete config-gated workflow end-to-end', async () => {
      delete process.env.OPENAI_API_KEY;
      // Fresh resolver: no stored keys, OAuth enablement off.
      const persistedEnablement: Record<string, boolean> = {};
      const tokenRequests: string[] = [];

      // Step 1: Toggle enablement on for device-code-test.
      persistedEnablement['device-code-test'] = true;

      // Step 2: The API call resolves auth lazily — only OAuth can answer.
      const resolver: AuthPrecedenceResolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: persistedEnablement['device-code-test'] ?? false,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: createRecordingOAuthManager(tokenRequests),
        },
      );
      const apiToken = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(apiToken).toBe('oauth-token-for-device-code-test');
      expect(tokenRequests).toStrictEqual(['device-code-test']);

      // Step 3: Status introspection reports the live OAuth method, derived
      // from the authenticated OAuth provider — verifying the resolver
      // wires the status path to the same config the token path used.
      expect(await resolver.getAuthMethodName()).toBe('oauth-device-code-test');
    });

    /**
     * @scenario Mixed auth methods coordination
     * @given Device-code-test uses OAuth, Gemini uses env var
     * @when Both resolvers resolve authentication
     * @then Each uses appropriate auth method
     * @and No interference between auth methods
     */
    it('should coordinate mixed authentication methods without interference', async () => {
      // Given: Mixed authentication setup — device-code-test uses OAuth,
      // gemini uses an env var. Each provider checks a DIFFERENT env var
      // name so the env var only satisfies gemini, not device-code-test.
      process.env.GEMINI_API_KEY = 'env-api-key-for-gemini';
      delete process.env.OPENAI_API_KEY;
      const tokenRequests: string[] = [];
      const sharedOAuthManager = createRecordingOAuthManager(tokenRequests);

      // Device-code-test: OAuth enabled, its env var is unset.
      const deviceCodeResolver = new AuthPrecedenceResolver(
        {
          providerId: 'device-code-test',
          envKeyNames: ['OPENAI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'device-code-test',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // Gemini: OAuth disabled, its env var is set.
      const geminiResolver = new AuthPrecedenceResolver(
        {
          providerId: 'gemini',
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: false,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        {
          settingsService: createEmptySettingsService(),
          oauthManager: sharedOAuthManager,
        },
      );

      // When: Both resolvers resolve authentication.
      const deviceCodeAuth = await deviceCodeResolver.resolveAuthentication({
        includeOAuth: true,
      });
      const geminiAuth = await geminiResolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Each uses appropriate method without interference.
      // Device-code-test gets an OAuth token (no env var for its provider);
      // gemini gets the env var (OAuth disabled).
      expect(deviceCodeAuth).toBe('oauth-token-for-device-code-test');
      expect(geminiAuth).toBe('env-api-key-for-gemini');

      // And: OAuth manager only called for the OAuth-enabled provider.
      expect(tokenRequests).toStrictEqual(['device-code-test']);
    });
  });
});
