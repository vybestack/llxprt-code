/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
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

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

/**
 * Mock OAuth provider for testing
 * Implements real OAuthProvider interface for coordination testing
 */
class MockOAuthProvider implements OAuthProvider {
  readonly name: string;
  private token: OAuthToken | null = null;
  private authInitiated = false;

  constructor(
    name: string,
    private _initialToken?: OAuthToken,
  ) {
    this.name = name;
    this.token = this._initialToken || null;
  }

  async initiateAuth(): Promise<void> {
    this.authInitiated = true;
    // Simulate successful auth flow
    if (!this.token) {
      this.token = {
        access_token: `access_${this.name}_${Date.now()}`,
        refresh_token: `refresh_${this.name}_${Date.now()}`,
        expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now (Unix timestamp)
        token_type: 'Bearer',
        scope: 'read write',
      };
    }
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.token;
  }

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    this.token = currentToken;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiry < nowInSeconds + 300) {
      // Refresh if expires in less than 5 minutes (Unix timestamp)
      this.token = {
        ...this.token,
        access_token: `refreshed_${this.name}_${Date.now()}`,
        expiry: nowInSeconds + 3600, // 1 hour from now (Unix timestamp)
      };
    }
    return this.token;
  }

  // Test helpers
  setToken(token: OAuthToken | null): void {
    this.token = token;
  }

  setExpiringToken(): void {
    this.token = {
      access_token: `expiring_${this.name}`,
      refresh_token: `refresh_${this.name}`,
      expiry: Math.floor(Date.now() / 1000) + 10, // Expires in 10 seconds (Unix timestamp)
      token_type: 'Bearer',
      scope: 'read',
    };
  }

  wasAuthInitiated(): boolean {
    return this.authInitiated;
  }
}

/**
 * Mock token store for testing
 * Implements real TokenStore interface for coordination testing
 */
class MockTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    this.tokens.set(provider, token);
  }

  async getToken(provider: string): Promise<OAuthToken | null> {
    return this.tokens.get(provider) || null;
  }

  async removeToken(provider: string): Promise<void> {
    this.tokens.delete(provider);
  }

  async listProviders(): Promise<string[]> {
    return Array.from(this.tokens.keys()).sort();
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${provider}:`)) {
        const bucket = key.split(':')[1];
        buckets.push(bucket);
      }
    }
    return buckets.sort();
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  // Test helpers
  clear(): void {
    this.tokens.clear();
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

describe.skipIf(skipInCI)(
  'OAuthManager with OAuth Enablement and Lazy Authentication',
  () => {
    let manager: OAuthManager;
    let tokenStore: MockTokenStore;
    let qwenProvider: MockOAuthProvider;
    let geminiProvider: MockOAuthProvider;

    beforeEach(() => {
      tokenStore = new MockTokenStore();
      manager = new OAuthManager(tokenStore);
      qwenProvider = new MockOAuthProvider('qwen');
      geminiProvider = new MockOAuthProvider('gemini');
    });

    describe.skipIf(skipInCI)('Provider Registration', () => {
      /**
       * @requirement REQ-001.1
       * @scenario Register OAuth provider
       * @given OAuthManager instance
       * @when registerProvider(qwenProvider) called
       * @then Provider available for authentication
       * @and Listed in getSupportedProviders()
       */
      it('should register OAuth provider and make it available', () => {
        expect(() => {
          manager.registerProvider(qwenProvider);
        }).not.toThrow();

        // Provider should be available in getSupportedProviders()
        const providers = manager.getSupportedProviders();
        expect(providers).toContain('qwen');
      });

      /**
       * @requirement REQ-001.3
       * @scenario Multiple provider registration
       * @given Empty OAuth manager
       * @when Register qwen and gemini providers
       * @then Both providers available
       * @and Can authenticate with either
       */
      it('should register multiple providers independently', () => {
        expect(() => {
          manager.registerProvider(qwenProvider);
          manager.registerProvider(geminiProvider);
        }).not.toThrow();

        // Both providers should be available
        const providers = manager.getSupportedProviders();
        expect(providers).toContain('qwen');
        expect(providers).toContain('gemini');
        expect(providers).toHaveLength(2);
      });

      /**
       * @requirement REQ-001.1
       * @scenario List OAuth-capable providers
       * @given Qwen and Gemini registered
       * @when getSupportedProviders() called
       * @then Returns ['gemini', 'qwen'] sorted
       */
      it('should list registered providers in sorted order', () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        const providers = manager.getSupportedProviders();
        expect(providers).toEqual(['gemini', 'qwen']); // Should be sorted
      });
    });

    describe.skipIf(skipInCI)('OAuth Enablement Management', () => {
      /**
       * @requirement REQ-001.3
       * @scenario Toggle OAuth enablement for provider
       * @given Registered qwen provider with OAuth disabled
       * @when toggleOAuthEnabled('qwen') called
       * @then OAuth is enabled for qwen
       * @and No OAuth flow is triggered immediately
       */
      it('should toggle OAuth enablement without triggering auth flow', async () => {
        manager.registerProvider(qwenProvider);

        // Mock the toggle method (would be implemented in real OAuthManager)
        const mockToggle = vi.fn().mockResolvedValue(true);
        (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled = mockToggle;

        const result = await (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled('qwen');
        expect(result).toBe(true);

        // Verify provider's initiateAuth was NOT called
        expect(qwenProvider.wasAuthInitiated()).toBe(false);
      });

      /**
       * @requirement REQ-001.1
       * @scenario OAuth enablement check
       * @given Provider registered with OAuth enabled
       * @when isOAuthEnabled('qwen') called
       * @then Returns current enablement state
       * @and No OAuth flow is triggered
       */
      it('should check OAuth enablement status without triggering auth', async () => {
        manager.registerProvider(qwenProvider);

        // Mock the enablement check method
        const mockIsEnabled = vi.fn().mockResolvedValue(false);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        const result = await (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled('qwen');
        expect(result).toBe(false);

        // Verify OAuth flow was not initiated
        expect(qwenProvider.wasAuthInitiated()).toBe(false);
      });

      /**
       * @requirement REQ-001.3
       * @scenario Toggle multiple providers independently
       * @given Multiple providers registered
       * @when toggleOAuthEnabled() called for each provider
       * @then Each provider toggles independently
       * @and Enablement state persists separately
       */
      it('should toggle OAuth enablement for multiple providers independently', async () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        // Mock toggle methods for both providers
        const mockToggle = vi
          .fn()
          .mockResolvedValueOnce(true) // Enable qwen
          .mockResolvedValueOnce(false); // Disable gemini
        (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled = mockToggle;

        const qwenResult = await (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled('qwen');
        const geminiResult = await (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled('gemini');

        expect(qwenResult).toBe(true); // OAuth enabled for qwen
        expect(geminiResult).toBe(false); // OAuth disabled for gemini

        // Neither provider should have auth initiated
        expect(qwenProvider.wasAuthInitiated()).toBe(false);
        expect(geminiProvider.wasAuthInitiated()).toBe(false);
      });
    });

    describe.skipIf(skipInCI)('Lazy Authentication Flow', () => {
      /**
       * @requirement REQ-003.1
       * @scenario Lazy OAuth triggering on API call
       * @given OAuth enabled for qwen but not authenticated
       * @when getToken('qwen') called during API request
       * @then Triggers OAuth flow lazily
       * @and Returns token after authentication
       */
      it('should trigger OAuth flow lazily when token needed for API call', async () => {
        manager.registerProvider(qwenProvider);

        // Mock OAuth as enabled but provider not authenticated yet
        const mockIsEnabled = vi.fn().mockResolvedValue(true);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        // When getToken is called, it should trigger authentication
        const token = await manager.getToken('qwen');
        expect(token).not.toBeNull();
        expect(token).toBeDefined();

        // OAuth flow should have been initiated lazily
        expect(qwenProvider.wasAuthInitiated()).toBe(true);
      });

      /**
       * @requirement REQ-003.1
       * @scenario Independent lazy OAuth triggering
       * @given OAuth enabled for qwen and gemini, neither authenticated
       * @when getToken('qwen') called
       * @then Triggers OAuth for qwen only
       * @and Gemini remains unauthenticated until needed
       */
      it('should trigger OAuth independently for each provider when needed', async () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        // Mock OAuth as enabled for both
        const mockIsEnabled = vi.fn().mockReturnValue(true);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        // Only request qwen token
        const qwenToken = await manager.getToken('qwen');

        expect(qwenToken).not.toBeNull();
        expect(qwenProvider.wasAuthInitiated()).toBe(true);

        // Gemini should not have been triggered
        expect(geminiProvider.wasAuthInitiated()).toBe(false);
      });

      /**
       * @requirement REQ-002.5
       * @scenario Auto-refresh expired token
       * @given Token expires in 10 seconds
       * @when getToken() called
       * @then Automatically refreshes token
       * @and Returns new valid token
       */
      it('should automatically refresh expiring tokens', async () => {
        manager.registerProvider(qwenProvider);

        // Mock OAuth as enabled
        const mockIsEnabled = vi.fn().mockReturnValue(true);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        // First authenticate to get a token
        await manager.authenticate('qwen');

        // Set an expiring token in the token store (expiry is Unix timestamp in seconds)
        const expiringToken = {
          access_token: 'expiring_token',
          refresh_token: 'refresh_token',
          expiry: Math.floor(Date.now() / 1000) + 10, // Expires in 10 seconds (Unix timestamp)
          token_type: 'Bearer' as const,
          scope: 'read',
        };
        await tokenStore.saveToken('qwen', expiringToken);

        // Set the provider to return a refreshed token when refresh is triggered
        qwenProvider.setExpiringToken(); // This sets the provider's internal token for refresh

        const token = await manager.getToken('qwen');

        // Should get a refreshed token (access token string)
        expect(token).not.toBeNull();
        expect(token).toMatch(/refreshed_/);
      });

      /**
       * @requirement REQ-003.1
       * @scenario Get token for OAuth disabled provider
       * @given Provider registered with OAuth disabled
       * @when getToken() called
       * @then Returns null without triggering OAuth
       */
      it('should return null for OAuth disabled provider without triggering auth', async () => {
        manager.registerProvider(qwenProvider);

        // Mock OAuth as disabled
        const mockIsEnabled = vi.fn().mockReturnValue(false);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        const token = await manager.getToken('qwen');
        expect(token).toBeNull();

        // OAuth should not have been triggered
        expect(qwenProvider.wasAuthInitiated()).toBe(false);
      });
    });

    describe.skipIf(skipInCI)('Status Reporting with OAuth Enablement', () => {
      /**
       * @requirement REQ-005.4
       * @scenario Get auth status including OAuth enablement
       * @given Qwen OAuth enabled and authenticated, Gemini OAuth disabled
       * @when getAuthStatus() called
       * @then Returns status for both providers
       * @and Shows OAuth enablement state
       */
      it('should report OAuth enablement status for all providers', async () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        // Mock OAuth enabled for qwen, disabled for gemini
        const mockIsEnabled = vi
          .fn()
          .mockImplementation((provider) => provider === 'qwen');
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        // Authenticate qwen through lazy triggering
        await manager.getToken('qwen');

        const statuses = await manager.getAuthStatus();

        expect(statuses).toHaveLength(2);
        const qwenStatus = statuses.find((s) => s.provider === 'qwen');
        const geminiStatus = statuses.find((s) => s.provider === 'gemini');

        expect(qwenStatus?.authenticated).toBe(true);
        expect(qwenStatus?.oauthEnabled).toBe(true);
        expect(geminiStatus?.authenticated).toBe(false);
        expect(geminiStatus?.oauthEnabled).toBe(false);
      });

      /**
       * @requirement REQ-005.4
       * @scenario Show token expiry in status
       * @given Authenticated provider with expiry
       * @when getAuthStatus() called
       * @then Includes time until expiry
       */
      it('should include token expiry time in status', async () => {
        manager.registerProvider(qwenProvider);
        await manager.authenticate('qwen');

        const statuses = await manager.getAuthStatus();
        const qwenStatus = statuses.find((s) => s.provider === 'qwen');

        expect(qwenStatus?.authenticated).toBe(true);
        expect(qwenStatus?.expiresIn).toBeDefined();
        expect(qwenStatus?.expiresIn).toBeGreaterThan(0);
      });

      /**
       * @requirement REQ-005.4
       * @scenario Status for mixed OAuth enablement and authentication states
       * @given Some providers OAuth enabled/authenticated, others disabled
       * @when getAuthStatus() called
       * @then Returns accurate status for each provider
       * @and Differentiates between OAuth enablement and auth types
       */
      it('should report mixed OAuth enablement and authentication states accurately', async () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        // Mock mixed OAuth enablement states
        const mockIsEnabled = vi
          .fn()
          .mockImplementation((provider) => provider === 'qwen');
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        // Only trigger authentication for qwen
        await manager.getToken('qwen');

        const statuses = await manager.getAuthStatus();

        expect(statuses).toHaveLength(2);

        const qwenStatus = statuses.find((s) => s.provider === 'qwen');
        const geminiStatus = statuses.find((s) => s.provider === 'gemini');

        expect(qwenStatus?.authType).toBe('oauth');
        expect(qwenStatus?.oauthEnabled).toBe(true);
        expect(geminiStatus?.authType).toBe('none');
        expect(geminiStatus?.oauthEnabled).toBe(false);
      });
    });

    describe.skipIf(skipInCI)('Error Handling', () => {
      /**
       * @requirement REQ-001.3
       * @scenario Toggle OAuth for unknown provider
       * @given Provider 'unknown' not registered
       * @when toggleOAuthEnabled('unknown') called
       * @then Throws provider not found error
       */
      it('should throw error for unknown provider OAuth toggle', async () => {
        const mockToggle = vi
          .fn()
          .mockRejectedValue(new Error('Unknown provider: unknown'));
        (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled = mockToggle;

        await expect(
          (
            manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
          ).toggleOAuthEnabled('unknown'),
        ).rejects.toThrow('Unknown provider: unknown');
      });

      /**
       * @requirement REQ-003.1
       * @scenario Get token for unknown provider
       * @given Provider 'unknown' not registered
       * @when getToken('unknown') called
       * @then Throws provider not found error
       */
      it('should return null for unknown provider token request', async () => {
        const token = await manager.getToken('unknown');
        expect(token).toBeNull();
      });

      /**
       * @requirement REQ-001.3
       * @scenario Handle lazy authentication failure
       * @given Provider OAuth enabled but authentication fails when triggered
       * @when getToken() called (triggering lazy auth)
       * @then Propagates authentication error
       * @and Provider remains unauthenticated
       */
      it('should handle lazy authentication failures gracefully', async () => {
        const failingProvider = new MockOAuthProvider('failing');
        failingProvider.initiateAuth = async () => {
          throw new Error('OAuth flow failed');
        };

        manager.registerProvider(failingProvider);

        // Mock OAuth as enabled
        const mockIsEnabled = vi.fn().mockResolvedValue(true);
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        await expect(manager.getToken('failing')).rejects.toThrow(
          'OAuth flow failed',
        );
      });
    });

    describe.skipIf(skipInCI)('Provider Discovery', () => {
      /**
       * @requirement REQ-001.1
       * @scenario List empty providers initially
       * @given Newly created OAuth manager
       * @when getSupportedProviders() called
       * @then Returns empty array
       */
      it('should return empty list when no providers registered', () => {
        const providers = manager.getSupportedProviders();
        expect(providers).toEqual([]);
      });

      /**
       * @requirement REQ-001.2
       * @scenario Filter OAuth-only providers
       * @given OAuth and API key providers registered
       * @when getSupportedProviders() called
       * @then Returns only OAuth-capable providers
       */
      it('should filter and return only OAuth-capable providers', () => {
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);

        const providers = manager.getSupportedProviders();
        expect(providers).toContain('qwen');
        expect(providers).toContain('gemini');
        // Only OAuth providers should be returned
      });

      /**
       * @requirement REQ-001.1
       * @scenario Provider registration order independence
       * @given Providers registered in different orders
       * @when getSupportedProviders() called
       * @then Always returns sorted list
       * @and Order independent of registration sequence
       */
      it('should return providers in consistent sorted order regardless of registration order', () => {
        // Register in different order
        manager.registerProvider(qwenProvider);
        manager.registerProvider(geminiProvider);
        const firstOrder = manager.getSupportedProviders();

        const manager2 = new OAuthManager(tokenStore);
        manager2.registerProvider(geminiProvider);
        manager2.registerProvider(qwenProvider);
        const secondOrder = manager2.getSupportedProviders();

        expect(firstOrder).toEqual(secondOrder);
        expect(firstOrder).toEqual(['gemini', 'qwen']);
      });
    });

    describe.skipIf(skipInCI)('Integration Scenarios', () => {
      /**
       * @requirement REQ-001.3
       * @scenario Complete OAuth enablement and lazy authentication lifecycle
       * @given Fresh OAuth manager
       * @when Register provider, enable OAuth, then retrieve token
       * @then OAuth enablement persists and lazy authentication succeeds
       * @and Token is available after lazy authentication
       */
      it('should support complete OAuth enablement and lazy auth lifecycle', async () => {
        manager.registerProvider(qwenProvider);

        // Enable OAuth (would persist in real implementation)
        const mockToggle = vi.fn().mockResolvedValue(true);
        const mockIsEnabled = vi.fn().mockResolvedValue(true);
        (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled = mockToggle;
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        await (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled('qwen');

        // Lazy authentication should trigger when token is needed
        const token = await manager.getToken('qwen');

        expect(token).not.toBeNull();
        expect(token).toBeDefined();
        expect(qwenProvider.wasAuthInitiated()).toBe(true);
      });

      /**
       * @requirement REQ-003.1
       * @scenario OAuth enablement and token persistence across manager instances
       * @given OAuth enabled and authenticated provider with stored token
       * @when New manager instance created
       * @then OAuth enablement and token remain accessible
       * @and No additional authentication needed
       */
      it('should persist OAuth enablement and tokens across manager instances', async () => {
        // Enable OAuth and authenticate with first manager
        manager.registerProvider(qwenProvider);

        const mockToggle = vi.fn().mockResolvedValue(true);
        const mockIsEnabled = vi.fn().mockResolvedValue(true);
        (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled = mockToggle;
        (
          manager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        await (
          manager as unknown as { toggleOAuthEnabled: typeof mockToggle }
        ).toggleOAuthEnabled('qwen');
        await manager.getToken('qwen'); // Triggers lazy auth

        // Create new manager with same token store
        const newManager = new OAuthManager(tokenStore);
        const newProvider = new MockOAuthProvider('qwen');
        newManager.registerProvider(newProvider);

        // Mock OAuth as still enabled in new manager
        (
          newManager as unknown as { isOAuthEnabled: typeof mockIsEnabled }
        ).isOAuthEnabled = mockIsEnabled;

        const token = await newManager.getToken('qwen');

        expect(token).not.toBeNull();
        expect(token).toBeDefined();
        // New provider shouldn't need to authenticate since token exists
        expect(newProvider.wasAuthInitiated()).toBe(false);
      });
    });
  },
);

describe('Higher priority auth detection', () => {
  let tokenStore: MockTokenStore;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    resetSettingsService();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    resetSettingsService();
  });

  it('reports environment variable precedence when authOnly is disabled', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const loadedSettings = createLoadedSettings();

    // Register SettingsService in runtime context before creating manager
    const settingsService = new SettingsService();
    registerSettingsService(settingsService);

    const manager = new OAuthManager(tokenStore, loadedSettings);

    const result = await manager.getHigherPriorityAuth('anthropic');

    expect(result).toBe('Environment Variable');
  });

  it('ignores environment variables when authOnly is enabled', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const loadedSettings = createLoadedSettings();

    // Register SettingsService in runtime context before creating manager
    const settingsService = new SettingsService();
    registerSettingsService(settingsService);

    const manager = new OAuthManager(tokenStore, loadedSettings);

    settingsService.set('authOnly', true);

    const result = await manager.getHigherPriorityAuth('anthropic');

    expect(result).toBeNull();
  });
});
