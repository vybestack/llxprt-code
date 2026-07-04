/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260608-ISSUE1586.P09
 * DI-refactored: SettingsService → ISettingsService local test double
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthPrecedenceResolver,
  flushRuntimeAuthScope,
} from '../precedence.js';
import type { OAuthManager } from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';

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
      let eventListeners = listeners.get(event);
      if (eventListeners === undefined) {
        eventListeners = new Set();
        listeners.set(event, eventListeners);
      }
      eventListeners.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
  };
}

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
  let mockSettingsService: ISettingsService;
  let resolver: AuthPrecedenceResolver;
  const testRuntimeId = 'test-oauth-logout-runtime';

  beforeEach(() => {
    // Flush any pre-existing runtime state
    flushRuntimeAuthScope(testRuntimeId);

    mockSettingsService = createStubSettingsService({
      activeProvider: 'anthropic',
      profile: 'default',
    });

    mockOAuthManager = {
      getToken: vi.fn(),
      getOAuthToken: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
    } as unknown as OAuthManager;

    resolver = new AuthPrecedenceResolver(
      {
        providerId: 'anthropic',
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'anthropic',
      },
      {
        oauthManager: mockOAuthManager,
        settingsService: mockSettingsService,
        getActiveRuntimeContext: () => ({
          settingsService: mockSettingsService,
          runtimeId: testRuntimeId,
        }),
      },
    );
  });

  afterEach(() => {
    flushRuntimeAuthScope(testRuntimeId);
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
    resolver.invalidateCache();

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
    resolver.invalidateCache();

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
