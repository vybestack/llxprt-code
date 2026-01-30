import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import type {
  Config,
  BucketFailoverHandler,
} from '@vybestack/llxprt-code-core';
import type { TokenStore, OAuthToken } from './types.js';

interface OAuthProvider {
  name: string;
  initiateAuth(): Promise<void>;
  getToken(): Promise<OAuthToken | null>;
  refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null>;
  logout?(token?: OAuthToken): Promise<void>;
}

/**
 * Tests for Issue 1151: BucketFailoverHandler not wired when 403 occurs
 *
 * Problem: When a 403 OAuth token revoked error occurs, AnthropicProvider checks
 * for the bucket failover handler in runtimeConfig, optionsConfig, and globalConfig.
 * All three may return undefined because the handler was never wired to the config.
 *
 * Root cause: The handler is only created during getOAuthToken() when a valid token
 * exists. If the first request after profile activation gets a 403, the handler
 * hasn't been wired yet.
 *
 * Solution: Wire the handler BEFORE making requests, not just when retrieving tokens.
 */
describe('OAuthManager - Bucket Failover Handler Wiring (Issue 1151)', () => {
  let oauthManager: OAuthManager;
  let mockConfig: Config;
  let mockGetBucketFailoverHandler: ReturnType<typeof vi.fn>;
  let mockSetBucketFailoverHandler: ReturnType<typeof vi.fn>;
  let mockConfigGetter: ReturnType<typeof vi.fn>;
  let mockTokenStore: TokenStore;
  let mockProvider: OAuthProvider;

  beforeEach(() => {
    // Create mock token store
    mockTokenStore = {
      getToken: vi.fn(),
      saveToken: vi.fn(),
      removeToken: vi.fn(),
      listProviders: vi.fn(),
      listBuckets: vi.fn(),
      acquireRefreshLock: vi.fn(),
      releaseRefreshLock: vi.fn(),
    } as unknown as TokenStore;

    // Create mock provider
    mockProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn(),
    };

    // Create mock config
    mockGetBucketFailoverHandler = vi.fn();
    mockSetBucketFailoverHandler = vi.fn();
    mockConfig = {
      getBucketFailoverHandler: mockGetBucketFailoverHandler,
      setBucketFailoverHandler: mockSetBucketFailoverHandler,
    } as unknown as Config;

    mockConfigGetter = vi.fn().mockReturnValue(mockConfig);

    oauthManager = new OAuthManager(mockTokenStore);
    oauthManager.registerProvider(mockProvider);
    oauthManager.setConfigGetter(mockConfigGetter);
  });

  it('should create BucketFailoverHandler when profile has multiple buckets', async () => {
    // Issue 1151: This is the critical test - handler must be wired EVEN when no token exists
    // This simulates the scenario where a 403 occurs on the first request after profile activation

    // Setup: Mock token store to return NO token (simulating fresh profile or expired token)
    (mockTokenStore.getToken as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    // Setup: Mock profile with multiple buckets
    const getProfileBucketsSpy = vi
      .spyOn(
        oauthManager as unknown as {
          getProfileBuckets: () => Promise<string[]>;
        },
        'getProfileBuckets',
      )
      .mockResolvedValue(['bucket1', 'bucket2', 'bucket3']);

    mockGetBucketFailoverHandler.mockReturnValue(undefined);

    // Act: Call getOAuthToken - should wire handler even though token doesn't exist
    await oauthManager.getOAuthToken('anthropic');

    // Assert: Handler should be created and set BEFORE attempting to retrieve token
    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0];
    expect(handlerArg).toBeDefined();
    expect(handlerArg.getBuckets()).toEqual(['bucket1', 'bucket2', 'bucket3']);

    getProfileBucketsSpy.mockRestore();
  });

  it('should reuse existing handler if buckets match', async () => {
    // Setup: Mock token store
    const mockToken: OAuthToken = {
      access_token: 'test-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh-token',
    };
    (mockTokenStore.getToken as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockToken,
    );

    // Mock profile with buckets
    const getProfileBucketsSpy = vi
      .spyOn(
        oauthManager as unknown as {
          getProfileBuckets: () => Promise<string[]>;
        },
        'getProfileBuckets',
      )
      .mockResolvedValue(['bucket1', 'bucket2']);

    // Mock existing handler with matching buckets
    const existingHandler: BucketFailoverHandler = {
      getBuckets: vi.fn().mockReturnValue(['bucket1', 'bucket2']),
      getCurrentBucket: vi.fn(),
      tryFailover: vi.fn(),
      isEnabled: vi.fn(),
    };

    mockGetBucketFailoverHandler.mockReturnValue(existingHandler);

    // Act
    await oauthManager.getOAuthToken('anthropic');

    // Assert: Should NOT create a new handler
    expect(mockSetBucketFailoverHandler).not.toHaveBeenCalled();

    getProfileBucketsSpy.mockRestore();
  });

  it('should recreate handler if bucket list changes', async () => {
    // Setup: Mock token store
    const mockToken: OAuthToken = {
      access_token: 'test-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh-token',
    };
    (mockTokenStore.getToken as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockToken,
    );

    // Mock profile with different buckets
    const getProfileBucketsSpy = vi
      .spyOn(
        oauthManager as unknown as {
          getProfileBuckets: () => Promise<string[]>;
        },
        'getProfileBuckets',
      )
      .mockResolvedValue(['bucket1', 'bucket3', 'bucket4']);

    // Mock existing handler with different buckets
    const existingHandler: BucketFailoverHandler = {
      getBuckets: vi.fn().mockReturnValue(['bucket1', 'bucket2']),
      getCurrentBucket: vi.fn(),
      tryFailover: vi.fn(),
      isEnabled: vi.fn(),
    };

    mockGetBucketFailoverHandler.mockReturnValue(existingHandler);

    // Act
    await oauthManager.getOAuthToken('anthropic');

    // Assert: Should create a new handler with updated buckets
    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0];
    expect(handlerArg.getBuckets()).toEqual(['bucket1', 'bucket3', 'bucket4']);

    getProfileBucketsSpy.mockRestore();
  });

  it('should warn if buckets configured but no config available', async () => {
    // Issue 1151: This is the bug scenario - multi-bucket profile but setConfigGetter not called yet
    // This can happen if profile is activated before runtime infrastructure is fully initialized

    // Setup: Create manager without config getter
    const mockTokenStoreNoConfig: TokenStore = {
      getToken: vi.fn(),
      saveToken: vi.fn(),
      removeToken: vi.fn(),
      listProviders: vi.fn(),
      listBuckets: vi.fn(),
      acquireRefreshLock: vi.fn(),
      releaseRefreshLock: vi.fn(),
    } as unknown as TokenStore;

    const mockProviderNoConfig: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn(),
    };

    const oauthManagerNoConfig = new OAuthManager(mockTokenStoreNoConfig);
    oauthManagerNoConfig.registerProvider(mockProviderNoConfig);
    // Explicitly NOT calling setConfigGetter - this is the bug!

    // Mock token store to return null (simulating fresh profile)
    (
      mockTokenStoreNoConfig.getToken as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    // Mock profile with multiple buckets
    const getProfileBucketsSpy = vi
      .spyOn(
        oauthManagerNoConfig as unknown as {
          getProfileBuckets: () => Promise<string[]>;
        },
        'getProfileBuckets',
      )
      .mockResolvedValue(['bucket1', 'bucket2']);

    // Import the logger and spy on warn
    const { DebugLogger } = await import('@vybestack/llxprt-code-core');
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    // Act: Call getOAuthToken - should warn about missing config
    await oauthManagerNoConfig.getOAuthToken('anthropic');

    // Assert: Should log warning about missing config
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[issue1029\].*buckets.*no Config available/),
    );

    warnSpy.mockRestore();
    getProfileBucketsSpy.mockRestore();
  });
});
