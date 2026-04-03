/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * AuthPrecedenceResolver cache invalidation tests for token revocation handling
 *
 * These behavioral tests verify that invalidateProviderCache correctly invalidates
 * specific provider entries in the runtime-scoped auth cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
  type OAuthTokenRequestMetadata,
} from './precedence.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  getSettingsService,
  registerSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';

const baseConfig: AuthPrecedenceConfig = {
  envKeyNames: [],
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'anthropic',
  providerId: 'anthropic',
};

describe('AuthPrecedenceResolver invalidateProviderCache', () => {
  let originalContext: ReturnType<typeof createProviderRuntimeContext> | null;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalContext = null;
    resetSettingsService();
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache invalidates specific provider entries
   */
  it('should invalidate cached tokens for a specific provider', async () => {
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-invalidation-test',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

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

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

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
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-profile-test',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

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
      oauthManager,
    );

    // Simulate two tokens in cache with different profiles by calling twice with different metadata
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
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-multi-provider-test',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

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
      oauthManager,
    );

    const geminiResolver = new AuthPrecedenceResolver(
      { ...baseConfig, providerId: 'gemini', oauthProvider: 'gemini' },
      oauthManager,
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

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

    // Should not throw when no runtime context exists
    expect(() => resolver.invalidateProviderCache('anthropic')).not.toThrow();
  });

  /**
   * @fix issue1861
   * Test that invalidateProviderCache handles invalid provider gracefully
   */
  it('should handle invalidation for non-existent provider', async () => {
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-nonexistent-test',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const oauthManager: OAuthManager = {
      getToken: vi.fn().mockResolvedValue('token'),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        token_type: 'Bearer',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

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
