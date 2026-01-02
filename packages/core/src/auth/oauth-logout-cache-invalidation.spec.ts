/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPrecedenceResolver, flushRuntimeAuthScope } from './precedence.js';
import type { OAuthManager, SettingsService } from '../index.js';

/**
 * Test suite for Issue #975: OAuth logout does not invalidate in-memory cached token
 *
 * This test verifies that after logout, the cached OAuth tokens are properly
 * invalidated without requiring a provider switch.
 *
 * @see https://github.com/vybestack/llxprt-code/issues/975
 */
describe('OAuth Logout Cache Invalidation (Issue #975)', () => {
  let mockOAuthManager: OAuthManager;
  let mockSettingsService: SettingsService;
  let resolver: AuthPrecedenceResolver;
  const testRuntimeId = 'test-oauth-logout-runtime';

  beforeEach(() => {
    // Flush any pre-existing runtime state
    flushRuntimeAuthScope(testRuntimeId);
    flushRuntimeAuthScope('legacy-singleton');

    mockSettingsService = {
      get: vi.fn((key: string) => {
        if (key === 'activeProvider') return 'anthropic';
        if (key === 'profile') return 'default';
        return undefined;
      }),
      getProviderSettings: vi.fn(() => ({})),
      set: vi.fn(),
      setProviderSetting: vi.fn(),
      switchProvider: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as SettingsService;

    mockOAuthManager = {
      getToken: vi.fn(),
      getOAuthToken: vi.fn(),
      isOAuthEnabled: vi.fn().mockReturnValue(true),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      logout: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as OAuthManager;

    resolver = new AuthPrecedenceResolver(
      {
        providerId: 'anthropic',
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'anthropic',
      },
      mockOAuthManager,
      mockSettingsService,
    );
  });

  afterEach(() => {
    flushRuntimeAuthScope(testRuntimeId);
    flushRuntimeAuthScope('legacy-singleton');
    vi.clearAllMocks();
  });

  it('should return fresh token after logout without requiring provider switch', async () => {
    // Given: First account's token is cached
    const tokenAccountA = 'oauth-token-account-a';
    const tokenAccountB = 'oauth-token-account-b';

    vi.mocked(mockOAuthManager.getToken).mockResolvedValue(tokenAccountA);

    // First authentication - token A gets cached
    const firstAuth = await resolver.resolveAuthentication({
      settingsService: mockSettingsService,
      includeOAuth: true,
    });
    expect(firstAuth).toBe(tokenAccountA);

    // Simulate logout - invalidate the cache
    resolver.invalidateCache?.();

    // Login with different account - token B
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue(tokenAccountB);

    // When: Resolve authentication again WITHOUT switching providers
    const secondAuth = await resolver.resolveAuthentication({
      settingsService: mockSettingsService,
      includeOAuth: true,
    });

    // Then: Should get the new token after cache invalidation
    expect(secondAuth).toBe(tokenAccountB);
  });

  it('should allow BaseProvider to invalidate resolver cache on logout', async () => {
    // This test verifies that AuthPrecedenceResolver has an invalidateCache method
    // that can be called from BaseProvider.clearAuthCache()
    expect(typeof resolver.invalidateCache).toBe('function');
  });

  it('should not return stale token after explicit cache invalidation', async () => {
    const freshToken = 'fresh-oauth-token';
    const staleToken = 'stale-cached-token';

    // First: Get and cache a token
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue(staleToken);
    const cachedResult = await resolver.resolveAuthentication({
      settingsService: mockSettingsService,
      includeOAuth: true,
    });
    expect(cachedResult).toBe(staleToken);

    // Invalidate the cache (simulating logout)
    if (typeof resolver.invalidateCache === 'function') {
      resolver.invalidateCache();
    }

    // OAuth manager now returns fresh token
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue(freshToken);

    // Resolve again - should get fresh token, not stale cached one
    const freshResult = await resolver.resolveAuthentication({
      settingsService: mockSettingsService,
      includeOAuth: true,
    });

    expect(freshResult).toBe(freshToken);
    expect(mockOAuthManager.getToken).toHaveBeenCalledTimes(2);
  });
});
