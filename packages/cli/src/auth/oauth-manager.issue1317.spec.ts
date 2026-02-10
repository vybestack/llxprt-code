/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #1317: OAuth Token Reuse Bug
 *
 * Bug 1: `createIsolatedRuntimeContext` creates OAuthManager without settings,
 * so `isOAuthEnabled()` always returns false for subagent invocations.
 *
 * Bug 2: `getToken()` triggers full re-auth when `getOAuthToken()` returns null
 * after a failed refresh, even when the expired disk token has a valid refresh_token
 * that could be retried.
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
  private _refreshBehavior: 'succeed' | 'fail' | 'fail-then-succeed' =
    'succeed';
  private _refreshCallCount: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  async initiateAuth(): Promise<void> {
    this.initiateAuthCalled = true;
    this.initiateAuthCallCount++;
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
    this._refreshCallCount++;

    if (this._refreshBehavior === 'fail') {
      return null;
    }

    if (this._refreshBehavior === 'fail-then-succeed') {
      // First call fails, subsequent calls succeed
      if (this._refreshCallCount <= 1) {
        return null;
      }
    }

    return {
      ...currentToken,
      access_token: `refreshed_${this.name}_${Date.now()}`,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  get refreshCallCount(): number {
    return this._refreshCallCount;
  }

  setRefreshBehavior(behavior: 'succeed' | 'fail' | 'fail-then-succeed'): void {
    this._refreshBehavior = behavior;
  }

  reset(): void {
    this.initiateAuthCalled = false;
    this.initiateAuthCallCount = 0;
    this._token = null;
    this._refreshBehavior = 'succeed';
    this._refreshCallCount = 0;
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

  clear(): void {
    this.tokens.clear();
  }

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

describe('Issue #1317: OAuth Token Reuse Bug', () => {
  let tokenStore: MockTokenStore;
  let anthropicProvider: MockOAuthProvider;
  let settings: LoadedSettings;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    anthropicProvider = new MockOAuthProvider('anthropic');
    settings = createLoadedSettings({
      oauthEnabledProviders: { anthropic: true },
    });

    const mockSettingsService = new SettingsService();
    registerSettingsService(mockSettingsService);
  });

  afterEach(() => {
    tokenStore.clear();
    anthropicProvider.reset();
    try {
      resetSettingsService();
    } catch {
      // Settings service may not be registered
    }
    vi.restoreAllMocks();
  });

  describe('Bug 1: OAuthManager without settings should check oauthEnabledProviders from disk', () => {
    /**
     * @requirement Issue #1317 Bug 1 Fix
     * @scenario Isolated runtime OAuthManager should load settings from disk
     * @given createIsolatedRuntimeContext creates a new OAuthManager without settings
     * @and OAuth is enabled for the provider in the user settings on disk
     * @and A valid token exists in the token store
     * @when The factory loads settings from disk for the new OAuthManager
     * @then isOAuthEnabled() should return true and getToken() should return the token
     */
    it('should use loaded settings so isOAuthEnabled returns true for configured providers', async () => {
      // Setup: valid token exists
      const validToken = tokenStore.simulateExternalToken('anthropic');

      // Create OAuthManager WITH settings loaded from disk (the fix!)
      // This simulates what createIsolatedRuntimeContext should do after the fix
      const managerWithSettings = new OAuthManager(tokenStore, settings);
      managerWithSettings.registerProvider(anthropicProvider);

      // When: getToken() is called
      const token = await managerWithSettings.getToken('anthropic');

      // Then: should return the existing token because settings are loaded
      expect(token).toBe(validToken.access_token);
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });

    /**
     * @requirement Issue #1317 Bug 1 Fix
     * @scenario OAuthManager created with settings should work
     * @given OAuthManager is created WITH LoadedSettings
     * @and OAuth is enabled for the provider
     * @and A valid token exists in the token store
     * @when getToken() is called
     * @then Should return the existing token
     */
    it('should return token when OAuthManager has settings with OAuth enabled', async () => {
      // Setup: valid token exists
      const validToken = tokenStore.simulateExternalToken('anthropic');

      // Create OAuthManager WITH settings (the correct path)
      const managerWithSettings = new OAuthManager(tokenStore, settings);
      managerWithSettings.registerProvider(anthropicProvider);

      // When: getToken() is called
      const token = await managerWithSettings.getToken('anthropic');

      // Then: should return the existing token
      expect(token).toBe(validToken.access_token);
      expect(anthropicProvider.initiateAuthCalled).toBe(false);
    });
  });

  describe('Bug 2: getToken() should attempt refresh on expired disk token before full re-auth', () => {
    /**
     * @requirement Issue #1317 Bug 2
     * @scenario Expired token with valid refresh_token after getOAuthToken returns null
     * @given An expired token exists on disk with a valid refresh_token
     * @and getOAuthToken() returns null because refresh failed once
     * @when getToken() hits the disk double-check
     * @then Should attempt to refresh the expired disk token before triggering full OAuth
     */
    it('should attempt refresh on expired disk token before triggering full re-auth', async () => {
      // Setup: expired token with valid refresh token
      const expiredToken: OAuthToken = {
        access_token: 'expired_token',
        refresh_token: 'valid_refresh_token',
        expiry: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', expiredToken);

      // Provider refresh fails first time (in getOAuthToken), succeeds second time (in getToken disk check)
      anthropicProvider.setRefreshBehavior('fail-then-succeed');

      const manager = new OAuthManager(tokenStore, settings);
      manager.registerProvider(anthropicProvider);

      // When: getToken() is called
      const token = await manager.getToken('anthropic');

      // Then: should get a refreshed token from the second refresh attempt
      expect(token).toMatch(/^refreshed_/);

      // And: full OAuth flow should NOT have been triggered
      expect(anthropicProvider.initiateAuthCalled).toBe(false);

      // And: refresh should have been called at least twice
      // (once in getOAuthToken which fails, once in getToken disk check which succeeds)
      expect(anthropicProvider.refreshCallCount).toBeGreaterThanOrEqual(2);
    });

    /**
     * @requirement Issue #1317 Bug 2
     * @scenario Expired token where refresh truly fails
     * @given An expired token exists on disk with a refresh_token
     * @and All refresh attempts fail
     * @when getToken() is called
     * @then Should fall through to full OAuth re-auth (not hang or error)
     */
    it('should fall through to full re-auth only when refresh also fails', async () => {
      // Setup: expired token with refresh token
      const expiredToken: OAuthToken = {
        access_token: 'expired_token',
        refresh_token: 'bad_refresh_token',
        expiry: Math.floor(Date.now() / 1000) - 100,
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', expiredToken);

      // Provider refresh ALWAYS fails
      anthropicProvider.setRefreshBehavior('fail');

      const manager = new OAuthManager(tokenStore, settings);
      manager.registerProvider(anthropicProvider);

      // When: getToken() is called - it will try refresh, fail, then try full OAuth
      const token = await manager.getToken('anthropic');

      // Then: full OAuth flow SHOULD have been triggered (refresh failed)
      expect(anthropicProvider.initiateAuthCalled).toBe(true);

      // And: should have received a fresh token from the OAuth flow
      expect(token).toMatch(/^fresh_token_/);
    });

    /**
     * @requirement Issue #1317 Bug 2
     * @scenario Expired token with NO refresh_token
     * @given An expired token exists on disk without a refresh_token
     * @and All refresh attempts fail (provider returns null)
     * @when getToken() is called
     * @then Should fall through to full OAuth (no refresh possible)
     * @and The disk-check refresh should be skipped since there is no refresh_token
     */
    it('should skip refresh attempt when expired disk token has no refresh_token', async () => {
      // Setup: expired token WITHOUT refresh token
      const expiredToken: OAuthToken = {
        access_token: 'expired_token',
        refresh_token: '', // Empty refresh token
        expiry: Math.floor(Date.now() / 1000) - 100,
        token_type: 'Bearer',
        scope: 'read write',
      };
      await tokenStore.saveToken('anthropic', expiredToken);

      // Refresh always fails — simulates provider that can't refresh without refresh_token
      anthropicProvider.setRefreshBehavior('fail');

      const manager = new OAuthManager(tokenStore, settings);
      manager.registerProvider(anthropicProvider);

      // When: getToken() is called
      const token = await manager.getToken('anthropic');

      // Then: full OAuth flow should be triggered (no valid refresh_token, refresh fails)
      expect(anthropicProvider.initiateAuthCalled).toBe(true);
      expect(token).toMatch(/^fresh_token_/);
    });
  });
});
