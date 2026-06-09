/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * AuthPrecedenceResolver cache invalidation tests for token revocation handling
 *
 * @plan PLAN-20260608-ISSUE1586.P09
 * DI-refactored: SettingsService → ISettingsService local test double,
 *                providerRuntimeContext → runtime state injection via precedence.ts helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type OAuthManager,
  type OAuthTokenRequestMetadata,
  ensureRuntimeState,
  runtimeScopedStates,
} from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';

/**
 * Local ISettingsService test double.
 * @plan PLAN-20260608-ISSUE1586.P09
 */
function createStubSettingsService(
  overrides?: Record<string, unknown>,
): ISettingsService {
  const store = new Map<string, unknown>(Object.entries(overrides ?? {}));
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    getProviderSettings: vi.fn(() => ({})),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
  };
}

/**
 * Creates a runtime context for testing that establishes runtime-scoped state.
 * This replaces the core createProviderRuntimeContext / setActiveProviderRuntimeContext.
 */
function createTestRuntimeContext(
  runtimeId: string,
  settingsService?: ISettingsService,
): IProviderRuntimeContext {
  const context: IProviderRuntimeContext = {
    settingsService: settingsService ?? createStubSettingsService(),
    runtimeId,
    metadata: {},
  };
  // Ensure runtime state is created so the resolver can find it
  ensureRuntimeState(context);
  return context;
}

const baseConfig: AuthPrecedenceConfig = {
  envKeyNames: [],
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'anthropic',
  providerId: 'anthropic',
};

describe('AuthPrecedenceResolver invalidateProviderCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clean up any runtime states from previous tests
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    // Clean up runtime states
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache invalidates specific provider entries
   */
  it('should invalidate cached tokens for a specific provider', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-invalidation-test',
      settingsService,
    );

    // Create a resolver with a getActiveRuntimeContext function that returns our context
    let tokenCallCount = 0;
    const getTokenMock = vi.fn(
      async (_provider: string, _metadata?: OAuthTokenRequestMetadata) => {
        tokenCallCount++;
        return `token-${tokenCallCount}`;
      },
    );

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        token_type: 'Bearer',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    // First call - should fetch from OAuth manager and cache
    const firstToken = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(firstToken).toBe('token-1');
    expect(getTokenMock).toHaveBeenCalledTimes(1);

    // Second call - should use cached token (no new fetch)
    const secondToken = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(secondToken).toBe('token-1');
    expect(getTokenMock).toHaveBeenCalledTimes(1); // Still 1

    // Invalidate cache for this provider
    resolver.invalidateProviderCache('anthropic');

    // Third call - should fetch new token after invalidation
    const thirdToken = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(thirdToken).toBe('token-2');
    expect(getTokenMock).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache with profileId only invalidates that specific profile
   */
  it('should invalidate only the specified profile when profileId is provided', async () => {
    const settingsService = createStubSettingsService({
      currentProfile: 'default',
    });
    const runtimeContext = createTestRuntimeContext(
      'runtime-profile-test',
      settingsService,
    );

    let tokenCallCount = 0;
    const getTokenMock = vi.fn(
      async (_provider: string, metadata?: OAuthTokenRequestMetadata) => {
        tokenCallCount++;
        return `token-${metadata?.profileId ?? 'default'}-${tokenCallCount}`;
      },
    );

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        token_type: 'Bearer',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const resolver = new AuthPrecedenceResolver(
      { ...baseConfig, providerId: 'anthropic' },
      {
        oauthManager,
        settingsService,
        getActiveRuntimeContext: () => runtimeContext,
      },
    );

    // First fetch - default profile
    const token1 = await resolver.resolveAuthentication({ includeOAuth: true });
    expect(token1).toBe('token-default-1');

    // Verify the token is cached by calling again (should not call getToken again)
    const token2 = await resolver.resolveAuthentication({ includeOAuth: true });
    expect(token2).toBe('token-default-1');
    expect(getTokenMock).toHaveBeenCalledTimes(1);

    // Invalidate with specific profileId that doesn't match default
    resolver.invalidateProviderCache('anthropic', 'other-profile');

    // Token should still be cached (profileId didn't match)
    const token3 = await resolver.resolveAuthentication({ includeOAuth: true });
    expect(token3).toBe('token-default-1');
    expect(getTokenMock).toHaveBeenCalledTimes(1);

    // Invalidate with matching provider but no profileId (should invalidate all for provider)
    resolver.invalidateProviderCache('anthropic');

    // Now should refetch
    const token4 = await resolver.resolveAuthentication({ includeOAuth: true });
    expect(token4).toBe('token-default-2');
    expect(getTokenMock).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache does not affect other providers
   */
  it('should not invalidate tokens for other providers', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-multi-provider-test',
      settingsService,
    );

    let anthropicCallCount = 0;
    let geminiCallCount = 0;

    const getTokenMock = vi.fn(
      async (provider: string, _metadata?: OAuthTokenRequestMetadata) => {
        if (provider === 'anthropic') {
          anthropicCallCount++;
          return `anthropic-token-${anthropicCallCount}`;
        } else if (provider === 'gemini') {
          geminiCallCount++;
          return `gemini-token-${geminiCallCount}`;
        }
        return null;
      },
    );

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        token_type: 'Bearer',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const anthropicResolver = new AuthPrecedenceResolver(
      { ...baseConfig, providerId: 'anthropic', oauthProvider: 'anthropic' },
      {
        oauthManager,
        settingsService,
        getActiveRuntimeContext: () => runtimeContext,
      },
    );

    const geminiResolver = new AuthPrecedenceResolver(
      { ...baseConfig, providerId: 'gemini', oauthProvider: 'gemini' },
      {
        oauthManager,
        settingsService,
        getActiveRuntimeContext: () => runtimeContext,
      },
    );

    // Fetch tokens for both providers
    const anthropicToken1 = await anthropicResolver.resolveAuthentication({
      includeOAuth: true,
    });
    const geminiToken1 = await geminiResolver.resolveAuthentication({
      includeOAuth: true,
    });

    expect(anthropicToken1).toBe('anthropic-token-1');
    expect(geminiToken1).toBe('gemini-token-1');

    // Invalidate anthropic only
    anthropicResolver.invalidateProviderCache('anthropic');

    // Fetch again - anthropic should refetch, gemini should use cache
    const anthropicToken2 = await anthropicResolver.resolveAuthentication({
      includeOAuth: true,
    });
    const geminiToken2 = await geminiResolver.resolveAuthentication({
      includeOAuth: true,
    });

    expect(anthropicToken2).toBe('anthropic-token-2'); // New token
    expect(geminiToken2).toBe('gemini-token-1'); // Cached token
    expect(anthropicCallCount).toBe(2);
    expect(geminiCallCount).toBe(1); // No additional calls for gemini
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache handles missing runtime gracefully
   */
  it('should handle invalidation when no runtime context exists', () => {
    const oauthManager: OAuthManager = {
      getToken: vi.fn().mockResolvedValue('token'),
      isAuthenticated: vi.fn().mockResolvedValue(true),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, { oauthManager });

    // Should not throw when no runtime context exists
    expect(() => resolver.invalidateProviderCache('anthropic')).not.toThrow();
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache handles invalid provider gracefully
   */
  it('should handle invalidation for non-existent provider', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-nonexistent-test',
      settingsService,
    );

    const oauthManager: OAuthManager = {
      getToken: vi.fn().mockResolvedValue('token'),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        token_type: 'Bearer',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    // Cache a token first
    await resolver.resolveAuthentication({ includeOAuth: true });

    // Invalidate a different provider (not cached)
    expect(() =>
      resolver.invalidateProviderCache('nonexistent-provider'),
    ).not.toThrow();

    // Original token should still be cached
    await resolver.resolveAuthentication({ includeOAuth: true });
    expect(oauthManager.getToken).toHaveBeenCalledTimes(1); // No additional calls
  });
});
