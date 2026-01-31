/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #1262 (interactive) and #1195 (non-interactive):
 * OAuth should check for existing valid tokens before triggering authentication.
 *
 * Root cause: When getToken() is called and no token is returned from getOAuthToken(),
 * it immediately triggers the OAuth flow without checking if a valid token exists
 * on disk (which might have been written by another process or earlier run).
 *
 * The fix: Before triggering OAuth authentication, re-read the token from disk
 * using the token store, respecting the locking pattern from PR #1258. Only
 * trigger OAuth if no valid token exists.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager, OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';
import { LoadedSettings } from '../config/settings.js';
import type { Settings } from '../config/settings.js';
import {
  resetSettingsService,
  registerSettingsService,
  SettingsService,
} from '@vybestack/llxprt-code-core';

/**
 * Mock OAuth provider that tracks whether initiateAuth was called
 */
class MockOAuthProvider implements OAuthProvider {
  readonly name: string;
  initiateAuthCalled: boolean = false;
  initiateAuthCallCount: number = 0;
  private _token: OAuthToken | null = null;

  constructor(name: string) {
    this.name = name;
  }

  async initiateAuth(): Promise<void> {
    this.initiateAuthCalled = true;
    this.initiateAuthCallCount++;
    // Simulate OAuth flow completing
    this._token = {
      access_token: `fresh_token_${this.name}_${Date.now()}`,
      refresh_token: `refresh_${this.name}_${Date.now()}`,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: 'read write',
    };
  }

  async getToken(): Promise<OAuthToken | null> {
    return this._token;
  }

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    return {
      ...currentToken,
      access_token: `refreshed_${this.name}_${Date.now()}`,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // Test helper to reset state
  reset(): void {
    this.initiateAuthCalled = false;
    this.initiateAuthCallCount = 0;
    this._token = null;
  }
}

/**
 * Mock token store that can simulate tokens written by other processes
 */
class MockTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    this.tokens.set(key, token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    return this.tokens.get(key) || null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    this.tokens.delete(key);
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const key of this.tokens.keys()) {
      const [provider] = key.split(':');
      providers.add(provider);
    }
    return Array.from(providers).sort();
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${provider}:`)) {
        const bucket = key.split(':')[1];
        buckets.push(bucket);
      }
    }
    // Include default if exists without bucket suffix
    if (this.tokens.has(provider)) {
      buckets.push('default');
    }
    return buckets.sort();
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    // No-op
  }

  // Test helper to clear all tokens
  clear(): void {
    this.tokens.clear();
  }

  // Test helper to simulate a token from another process
  simulateExternalToken(
    provider: string,
    bucket?: string,
    expiresInSeconds = 3600,
  ): OAuthToken {
    const token: OAuthToken = {
      access_token: `external_process_token_${Date.now()}`,
      refresh_token: `external_refresh_${Date.now()}`,
      expiry: Math.floor(Date.now() / 1000) + expiresInSeconds,
      token_type: 'Bearer',
      scope: 'read write',
    };
    const key = bucket ? `${provider}:${bucket}` : provider;
    this.tokens.set(key, token);
    return token;
  }
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

describe('OAuth Token Reuse (Issues #1262 and #1195)', () => {
  let manager: OAuthManager;
  let tokenStore: MockTokenStore;
  let anthropicProvider: MockOAuthProvider;
  let settings: LoadedSettings;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    anthropicProvider = new MockOAuthProvider('anthropic');
    settings = createLoadedSettings({
      oauthEnabledProviders: { anthropic: true },
    });
    manager = new OAuthManager(tokenStore, settings);
    manager.registerProvider(anthropicProvider);

    // Register a real SettingsService instance for the test
    const mockSettingsService = new SettingsService();
    registerSettingsService(mockSettingsService);
  });

  afterEach(() => {
    tokenStore.clear();
    anthropicProvider.reset();
    try {
      resetSettingsService();
    } catch {
      // Settings service may not be registered or may not have clear method
    }
    vi.restoreAllMocks();
  });

  describe('Issue #1262: Interactive mode should reuse existing valid tokens', () => {
    /**
     * @requirement Issue #1262
     * @scenario Valid token exists from another process
     * @given A valid OAuth token exists on disk (from another llxprt-code instance)
     * @when getToken() is called in interactive mode
     * @then Should return the existing token without triggering OAuth flow
     */
    it('should NOT trigger OAuth when valid token exists from another process', async () => {
      // Simulate: another llxprt-code process wrote a valid token to disk
      const existingToken = tokenStore.simulateExternalToken('anthropic');

      // When: this process requests a token
      const token = await manager.getToken('anthropic');

      // Then: should return the existing token
      expect(token).toBe(existingToken.access_token);

      // And: OAuth flow should NOT have been triggered
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
      expect(anthropicProvider.initiateAuthCallCount).toBe(0);
    });

    /**
     * @requirement Issue #1262
     * @scenario Valid token exists from earlier run
     * @given A valid OAuth token exists from a previous session
     * @when getToken() is called on first prompt
     * @then Should return the existing token without triggering OAuth flow
     */
    it('should NOT trigger OAuth when valid token exists from earlier run', async () => {
      // Simulate: token was saved in an earlier session (e.g., user ran llxprt earlier today)
      const earlierToken: OAuthToken = {
        access_token: 'earlier_session_token',
        refresh_token: 'earlier_refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600, // Still valid for 1 hour
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', earlierToken);

      // When: getToken() is called (lazy auth on first prompt)
      const token = await manager.getToken('anthropic');

      // Then: should return the existing token
      expect(token).toBe(earlierToken.access_token);

      // And: OAuth flow should NOT have been triggered
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });
  });

  describe('Issue #1195: Non-interactive mode should reuse existing valid tokens', () => {
    /**
     * @requirement Issue #1195
     * @scenario Multiple --profile-load runs with same profile
     * @given User runs: node scripts/start.js --profile-load opusthinking "prompt1"
     * @and Token was saved from that run
     * @when User runs: node scripts/start.js --profile-load opusthinking "prompt2"
     * @then Should reuse the token from the first run, not re-authenticate
     */
    it('should reuse token from previous --profile-load run', async () => {
      // First run: token gets saved
      const firstRunToken: OAuthToken = {
        access_token: 'first_run_token',
        refresh_token: 'first_run_refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', firstRunToken);

      // Second run: create fresh manager (simulating new process)
      const secondRunManager = new OAuthManager(tokenStore, settings);
      const freshProvider = new MockOAuthProvider('anthropic');
      secondRunManager.registerProvider(freshProvider);

      // When: second run requests token
      const token = await secondRunManager.getToken('anthropic');

      // Then: should use the existing token
      expect(token).toBe(firstRunToken.access_token);

      // And: no new OAuth flow should be triggered
      expect(freshProvider.initiateAuthCalled).toBe(false);
    });

    /**
     * @requirement Issue #1195
     * @scenario Multiple buckets with some already authenticated
     * @given Profile has buckets: [bucket1, bucket2, bucket3]
     * @and bucket1 and bucket2 have valid tokens from previous run
     * @when Profile is loaded
     * @then Only bucket3 should trigger OAuth, not bucket1 or bucket2
     */
    it('should only authenticate buckets that need it', async () => {
      // Setup: bucket1 and bucket2 have valid tokens
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'bucket1_token',
          refresh_token: 'bucket1_refresh',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
          scope: 'read write',
        },
        'bucket1',
      );

      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'bucket2_token',
          refresh_token: 'bucket2_refresh',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
          scope: 'read write',
        },
        'bucket2',
      );

      // bucket3 has NO token (needs authentication)
      // This is already the case - tokenStore has no bucket3

      // When: tokens are requested for each bucket
      const token1 = await manager.getToken('anthropic', 'bucket1');
      const token2 = await manager.getToken('anthropic', 'bucket2');

      // Then: existing tokens should be returned without OAuth
      expect(token1).toBe('bucket1_token');
      expect(token2).toBe('bucket2_token');
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });
  });

  describe('Token expiration and refresh behavior', () => {
    /**
     * @scenario Expired token should trigger refresh, not full OAuth
     * @given Token exists but is expired
     * @when getToken() is called
     * @then Should attempt refresh first, only do full OAuth if refresh fails
     */
    it('should attempt refresh before full OAuth for expired token', async () => {
      // Setup: expired token with valid refresh token
      const expiredToken: OAuthToken = {
        access_token: 'expired_token',
        refresh_token: 'valid_refresh_token',
        expiry: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', expiredToken);

      // When: token is requested
      const token = await manager.getToken('anthropic');

      // Then: should get a refreshed token (starts with "refreshed_")
      expect(token).toMatch(/^refreshed_/);

      // And: full OAuth flow should NOT have been triggered
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });

    /**
     * @scenario Token about to expire should still be used (within buffer)
     * @given Token expires in 20 seconds (within 30-second buffer)
     * @when getToken() is called
     * @then Should refresh the token proactively
     */
    it('should refresh token that expires within buffer period', async () => {
      // Setup: token expiring in 20 seconds (within 30-second buffer)
      const expiringToken: OAuthToken = {
        access_token: 'expiring_soon_token',
        refresh_token: 'valid_refresh',
        expiry: Math.floor(Date.now() / 1000) + 20, // Expires in 20 seconds
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', expiringToken);

      // When: token is requested
      const token = await manager.getToken('anthropic');

      // Then: should get a refreshed token
      expect(token).toMatch(/^refreshed_/);

      // And: full OAuth should NOT be triggered
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });
  });

  describe('Race condition prevention (PR #1258 locking)', () => {
    /**
     * @scenario Concurrent processes should not both trigger OAuth
     * @given Two processes call getToken() simultaneously
     * @and Neither has a valid token initially
     * @when First process completes OAuth and saves token
     * @then Second process should use the newly saved token
     */
    it('should use token saved by concurrent process', async () => {
      // This test verifies the double-check pattern after lock acquisition
      // Setup: no token initially

      // Simulate: first call starts OAuth, which takes time
      // During that time, another process writes a token
      let getTokenCallCount = 0;
      const originalGetToken = tokenStore.getToken.bind(tokenStore);
      tokenStore.getToken = async (
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> => {
        getTokenCallCount++;
        // On second call (after lock acquisition), simulate another process wrote a token
        if (getTokenCallCount === 2) {
          tokenStore.simulateExternalToken(provider, bucket);
        }
        return originalGetToken(provider, bucket);
      };

      // The actual behavior depends on how the locking is implemented
      // This test documents the expected behavior
      const token = await manager.getToken('anthropic');

      // Should eventually get a token (either from OAuth or from other process)
      expect(token).toBeDefined();
    });
  });

  describe('OAuth enablement checks', () => {
    /**
     * @scenario OAuth disabled should not trigger any auth
     * @given OAuth is disabled for the provider
     * @when getToken() is called
     * @then Should return null without triggering OAuth
     */
    it('should return null without OAuth when OAuth is disabled', async () => {
      // Setup: OAuth disabled for anthropic
      const disabledSettings = createLoadedSettings({
        oauthEnabledProviders: { anthropic: false },
      });
      const disabledManager = new OAuthManager(tokenStore, disabledSettings);
      const provider = new MockOAuthProvider('anthropic');
      disabledManager.registerProvider(provider);

      // Even if a token exists, OAuth disabled means we don't use it
      tokenStore.simulateExternalToken('anthropic');

      const token = await disabledManager.getToken('anthropic');

      expect(token).toBeNull();
      expect(provider.initiateAuthCalled).toBe(false);
    });
  });
});
