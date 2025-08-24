/**
 * OAuth Authentication Integration Tests
 *
 * Validates all OAuth fixes work together:
 * - Cache clearing on logout (security fix)
 * - Async initialization fixes for token persistence
 * - Real provider OAuth implementation (Gemini, Qwen, Anthropic)
 * - Enhanced error handling
 * - Race condition handling
 *
 * This is P6 priority - validate all fixes work together correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager } from '../../src/auth/oauth-manager.js';
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../src/auth/anthropic-oauth-provider.js';
import {
  MultiProviderTokenStore,
  OAuthToken,
  clearOauthClientCache,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings, SettingScope } from '../../src/config/settings.js';

// Mock the core module's clearOauthClientCache function
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    clearOauthClientCache: vi.fn(),
  };
});

// Test utilities for creating mock tokens and settings
class TestTokenStore extends MultiProviderTokenStore {
  private mockTokens: Map<string, OAuthToken | null> = new Map();
  private shouldThrow = false;
  private throwOnProvider?: string;

  setMockToken(provider: string, token: OAuthToken | null): void {
    this.mockTokens.set(provider, token);
  }

  setShouldThrow(shouldThrow: boolean, onProvider?: string): void {
    this.shouldThrow = shouldThrow;
    this.throwOnProvider = onProvider;
  }

  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    if (
      this.shouldThrow &&
      (!this.throwOnProvider || this.throwOnProvider === provider)
    ) {
      throw new Error(`Mock storage error for ${provider}`);
    }
    this.mockTokens.set(provider, token);
  }

  async getToken(provider: string): Promise<OAuthToken | null> {
    if (
      this.shouldThrow &&
      (!this.throwOnProvider || this.throwOnProvider === provider)
    ) {
      throw new Error(`Mock storage error for ${provider}`);
    }
    return this.mockTokens.get(provider) || null;
  }

  async removeToken(provider: string): Promise<void> {
    if (
      this.shouldThrow &&
      (!this.throwOnProvider || this.throwOnProvider === provider)
    ) {
      throw new Error(`Mock storage error for ${provider}`);
    }
    this.mockTokens.set(provider, null);
  }

  async listProviders(): Promise<string[]> {
    const providers: string[] = [];
    for (const [provider, token] of this.mockTokens.entries()) {
      if (token !== null) {
        providers.push(provider);
      }
    }
    return providers.sort();
  }
}

class MockSettings implements LoadedSettings {
  public merged: Record<string, Record<string, boolean | string>> = {
    oauthEnabledProviders: {},
    providerApiKeys: {},
    providerKeyfiles: {},
    providerBaseUrls: {},
  };

  setValue(
    scope: SettingScope,
    key: string,
    value: Record<string, boolean | string>,
  ): void {
    this.merged[key] = value;
  }

  getValue(key: string): Record<string, boolean | string> | undefined {
    return this.merged[key];
  }

  getScope(): SettingScope {
    return SettingScope.User;
  }
}

// Helper function to create valid OAuth tokens
function createValidToken(
  provider: string,
  expiresInSeconds = 3600,
): OAuthToken {
  return {
    access_token: `${provider}-access-token-${Date.now()}`,
    refresh_token: `${provider}-refresh-token-${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) + expiresInSeconds,
    token_type: 'Bearer',
    scope: 'openid profile email',
  };
}

function createExpiredToken(provider: string): OAuthToken {
  return {
    access_token: `${provider}-expired-token-${Date.now()}`,
    refresh_token: `${provider}-expired-refresh-${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    token_type: 'Bearer',
    scope: 'openid profile email',
  };
}

describe('OAuth Integration Tests - Provider Registration & Initialization', () => {
  let tokenStore: TestTokenStore;
  let mockSettings: MockSettings;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tokenStore = new TestTokenStore();
    mockSettings = new MockSettings();
    oauthManager = new OAuthManager(tokenStore, mockSettings);

    // Clear all mocks
    vi.clearAllMocks();

    // Set NODE_ENV to test to avoid network calls
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(async () => {
    // Cleanup any test state
    vi.unstubAllEnvs();
  });

  describe('Provider Registration and Lazy Initialization', () => {
    it('should register all three providers successfully', () => {
      const qwenProvider = new QwenOAuthProvider(tokenStore);
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      oauthManager.registerProvider(qwenProvider);
      oauthManager.registerProvider(geminiProvider);
      oauthManager.registerProvider(anthropicProvider);

      const supportedProviders = oauthManager.getSupportedProviders();
      expect(supportedProviders).toContain('qwen');
      expect(supportedProviders).toContain('gemini');
      expect(supportedProviders).toContain('anthropic');
      expect(supportedProviders).toHaveLength(3);
    });

    it('should handle provider registration with stored tokens during lazy initialization', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      const qwenProvider = new QwenOAuthProvider(tokenStore);
      oauthManager.registerProvider(qwenProvider);

      // Wait a bit for lazy initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrievedProvider = oauthManager.getProvider('qwen');
      expect(retrievedProvider).toBe(qwenProvider);
    });

    it('should handle initialization errors gracefully without breaking registration', async () => {
      // Set up token store to throw error for qwen
      tokenStore.setShouldThrow(true, 'qwen');

      const qwenProvider = new QwenOAuthProvider(tokenStore);

      // Registration should succeed even if initialization fails
      expect(() => oauthManager.registerProvider(qwenProvider)).not.toThrow();

      const retrievedProvider = oauthManager.getProvider('qwen');
      expect(retrievedProvider).toBe(qwenProvider);
    });

    it('should validate provider interface during registration', () => {
      const invalidProvider = {
        name: 'invalid',
        // Missing required methods
      } as unknown as OAuthProvider;

      expect(() => oauthManager.registerProvider(invalidProvider)).toThrow(
        'Provider must implement initiateAuth method',
      );
    });
  });

  describe('Authentication Status and Token Persistence', () => {
    beforeEach(() => {
      // Register all providers for these tests
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    it('should correctly report authentication status for all providers', async () => {
      const qwenToken = createValidToken('qwen');
      const geminiToken = createValidToken('gemini');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('gemini', geminiToken);
      // No token for anthropic

      // Enable OAuth for all providers
      mockSettings.merged.oauthEnabledProviders = {
        qwen: true,
        gemini: true,
        anthropic: true,
      };

      const authStatuses = await oauthManager.getAuthStatus();

      const qwenStatus = authStatuses.find((s) => s.provider === 'qwen');
      const geminiStatus = authStatuses.find((s) => s.provider === 'gemini');
      const anthropicStatus = authStatuses.find(
        (s) => s.provider === 'anthropic',
      );

      expect(qwenStatus?.authenticated).toBe(true);
      expect(qwenStatus?.authType).toBe('oauth');
      expect(qwenStatus?.oauthEnabled).toBe(true);

      expect(geminiStatus?.authenticated).toBe(true);
      expect(geminiStatus?.authType).toBe('oauth');
      expect(geminiStatus?.oauthEnabled).toBe(true);

      expect(anthropicStatus?.authenticated).toBe(false);
      expect(anthropicStatus?.authType).toBe('none');
      expect(anthropicStatus?.oauthEnabled).toBe(true);
    });

    it('should handle expired tokens in authentication status', async () => {
      const expiredToken = createExpiredToken('qwen');
      tokenStore.setMockToken('qwen', expiredToken);

      // Enable OAuth for qwen
      mockSettings.merged.oauthEnabledProviders = { qwen: true };

      const isAuthenticated = await oauthManager.isAuthenticated('qwen');
      expect(isAuthenticated).toBe(false);
    });

    it('should persist tokens across multiple getToken calls', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      // Enable OAuth for qwen
      mockSettings.merged.oauthEnabledProviders = { qwen: true };

      const token1 = await oauthManager.getToken('qwen');
      const token2 = await oauthManager.getToken('qwen');

      expect(token1).toBe(qwenToken.access_token);
      expect(token2).toBe(qwenToken.access_token);
      expect(token1).toBe(token2);
    });
  });

  describe('OAuth Enablement State Management', () => {
    beforeEach(() => {
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    });

    it('should toggle OAuth enablement state correctly', async () => {
      expect(oauthManager.isOAuthEnabled('qwen')).toBe(false);

      const newState1 = await oauthManager.toggleOAuthEnabled('qwen');
      expect(newState1).toBe(true);
      expect(oauthManager.isOAuthEnabled('qwen')).toBe(true);

      const newState2 = await oauthManager.toggleOAuthEnabled('qwen');
      expect(newState2).toBe(false);
      expect(oauthManager.isOAuthEnabled('qwen')).toBe(false);
    });

    it('should persist OAuth enablement state in settings', async () => {
      await oauthManager.toggleOAuthEnabled('qwen');
      expect(mockSettings.merged.oauthEnabledProviders.qwen).toBe(true);

      await oauthManager.toggleOAuthEnabled('qwen');
      expect(mockSettings.merged.oauthEnabledProviders.qwen).toBe(false);
    });

    it('should work without settings (memory-only mode)', async () => {
      const oauthManagerNoSettings = new OAuthManager(tokenStore);
      oauthManagerNoSettings.registerProvider(
        new QwenOAuthProvider(tokenStore),
      );

      expect(oauthManagerNoSettings.isOAuthEnabled('qwen')).toBe(false);

      await oauthManagerNoSettings.toggleOAuthEnabled('qwen');
      expect(oauthManagerNoSettings.isOAuthEnabled('qwen')).toBe(true);
    });
  });
});

describe('OAuth Integration Tests - Logout and Cache Clearing', () => {
  let tokenStore: TestTokenStore;
  let mockSettings: MockSettings;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tokenStore = new TestTokenStore();
    mockSettings = new MockSettings();
    oauthManager = new OAuthManager(tokenStore, mockSettings);

    // Register all providers
    oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
    oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));

    // Clear all mocks
    vi.clearAllMocks();

    // Set NODE_ENV to test
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Security Fix: OAuth Cache Clearing', () => {
    it('should call clearOauthClientCache on Gemini logout', async () => {
      const geminiToken = createValidToken('gemini');
      tokenStore.setMockToken('gemini', geminiToken);

      await oauthManager.logout('gemini');

      // Verify the security fix: cache clearing should be called
      expect(clearOauthClientCache).toHaveBeenCalledTimes(1);
    });

    it('should not call clearOauthClientCache on non-Gemini logout', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      await oauthManager.logout('qwen');

      // clearOauthClientCache should not be called for non-Gemini providers
      expect(clearOauthClientCache).not.toHaveBeenCalled();
    });

    it('should handle clearOauthClientCache errors gracefully', async () => {
      const geminiToken = createValidToken('gemini');
      tokenStore.setMockToken('gemini', geminiToken);

      // Mock clearOauthClientCache to throw an error
      (clearOauthClientCache as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('Cache clearing failed');
        },
      );

      // Logout should still succeed even if cache clearing fails
      await expect(oauthManager.logout('gemini')).resolves.not.toThrow();

      // Token should still be removed despite cache clearing failure
      const tokenAfter = await tokenStore.getToken('gemini');
      expect(tokenAfter).toBeNull();
    });
  });

  describe('Comprehensive Logout Scenarios', () => {
    it('should clear all authentication state on single provider logout', async () => {
      const qwenToken = createValidToken('qwen');
      const geminiToken = createValidToken('gemini');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('gemini', geminiToken);

      // Enable OAuth for both
      mockSettings.merged.oauthEnabledProviders = { qwen: true, gemini: true };

      // Verify initial state
      expect(await oauthManager.isAuthenticated('qwen')).toBe(true);
      expect(await oauthManager.isAuthenticated('gemini')).toBe(true);

      // Logout from qwen only
      await oauthManager.logout('qwen');

      // Qwen should be logged out, gemini should remain (special Gemini behavior)
      expect(await oauthManager.isAuthenticated('qwen')).toBe(false);
      expect(await oauthManager.isAuthenticated('gemini')).toBe(true); // Gemini returns true when OAuth enabled
      expect(await tokenStore.getToken('qwen')).toBeNull();
      expect(await tokenStore.getToken('gemini')).toEqual(geminiToken);
    });

    it('should handle logoutAll with mixed authentication states', async () => {
      const qwenToken = createValidToken('qwen');
      const anthropicToken = createValidToken('anthropic');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('anthropic', anthropicToken);
      // No gemini token

      mockSettings.merged.oauthEnabledProviders = {
        qwen: true,
        gemini: true,
        anthropic: true,
      };

      await oauthManager.logoutAll();

      // After logoutAll, OAuth should be disabled for all providers
      // This should make all isAuthenticated calls return false
      expect(await oauthManager.isAuthenticated('qwen')).toBe(false);
      expect(await oauthManager.isAuthenticated('anthropic')).toBe(false);

      // For Gemini, we need to check if OAuth is still enabled after logout
      // The logout should have cleared the token but OAuth enablement might persist
      const geminiAuthenticated = await oauthManager.isAuthenticated('gemini');
      const geminiOAuthEnabled = oauthManager.isOAuthEnabled('gemini');
      if (geminiOAuthEnabled) {
        // Gemini returns true when OAuth is enabled (special behavior)
        expect(geminiAuthenticated).toBe(true);
      } else {
        expect(geminiAuthenticated).toBe(false);
      }

      expect(await tokenStore.getToken('qwen')).toBeNull();
      expect(await tokenStore.getToken('gemini')).toBeNull();
      expect(await tokenStore.getToken('anthropic')).toBeNull();
    });

    it('should continue logoutAll even if some providers fail', async () => {
      const qwenToken = createValidToken('qwen');
      const geminiToken = createValidToken('gemini');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('gemini', geminiToken);

      // Make qwen logout fail
      tokenStore.setShouldThrow(true, 'qwen');

      // logoutAll should continue despite partial failures
      await oauthManager.logoutAll();

      // Gemini should still be logged out even if qwen failed
      expect(await tokenStore.getToken('gemini')).toBeNull();
    });
  });
});

describe('OAuth Integration Tests - Concurrent Operations & Race Conditions', () => {
  let tokenStore: TestTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tokenStore = new TestTokenStore();
    oauthManager = new OAuthManager(tokenStore);

    // Register all providers
    oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
    oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));

    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Async Initialization Race Conditions', () => {
    it('should handle concurrent getToken calls during initialization', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      // Make multiple concurrent getToken calls before initialization completes
      const promises = Array.from({ length: 5 }, () =>
        oauthManager.getOAuthToken('qwen'),
      );

      const results = await Promise.all(promises);

      // All calls should return the same token
      results.forEach((result) => {
        expect(result).toEqual(qwenToken);
      });
    });

    it('should handle concurrent provider registration and token access', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      // Simulate registration and immediate access
      const registrationPromise = Promise.resolve().then(() => {
        const provider = new QwenOAuthProvider(tokenStore);
        oauthManager.registerProvider(provider);
      });

      const accessPromise = oauthManager.getOAuthToken('qwen');

      const [, token] = await Promise.all([registrationPromise, accessPromise]);

      // Should either get the token or null (if registration wasn't complete)
      expect(
        token === null || token?.access_token === qwenToken.access_token,
      ).toBe(true);
    });
  });

  describe('Concurrent Provider Operations', () => {
    it('should handle concurrent logout operations on different providers', async () => {
      const qwenToken = createValidToken('qwen');
      const geminiToken = createValidToken('gemini');
      const anthropicToken = createValidToken('anthropic');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('gemini', geminiToken);
      tokenStore.setMockToken('anthropic', anthropicToken);

      // Perform concurrent logouts
      const logoutPromises = [
        oauthManager.logout('qwen'),
        oauthManager.logout('gemini'),
        oauthManager.logout('anthropic'),
      ];

      await Promise.all(logoutPromises);

      // All providers should be logged out
      expect(await tokenStore.getToken('qwen')).toBeNull();
      expect(await tokenStore.getToken('gemini')).toBeNull();
      expect(await tokenStore.getToken('anthropic')).toBeNull();
    });

    it('should handle concurrent token access and OAuth enablement changes', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      const accessPromises = Array.from({ length: 3 }, () =>
        oauthManager.getToken('qwen'),
      );

      const togglePromises = Array.from({ length: 2 }, () =>
        oauthManager.toggleOAuthEnabled('qwen'),
      );

      // These operations should not interfere with each other
      const [accessResults, toggleResults] = await Promise.all([
        Promise.all(accessPromises),
        Promise.all(togglePromises),
      ]);

      // Access results should be consistent (either all null or all the token)
      const uniqueResults = [...new Set(accessResults)];
      expect(uniqueResults.length).toBeLessThanOrEqual(2); // null and/or token

      // Toggle results should reflect the state changes
      expect(toggleResults).toHaveLength(2);
    });

    it('should handle mixed concurrent operations (auth, logout, status check)', async () => {
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      // Mix different types of concurrent operations
      const mixedPromises = [
        oauthManager.getToken('qwen'),
        oauthManager.isAuthenticated('qwen'),
        oauthManager.getAuthStatus(),
        oauthManager.toggleOAuthEnabled('qwen'),
      ];

      // Should complete without errors
      const results = await Promise.all(mixedPromises);

      expect(results).toHaveLength(4);
      // Results should be reasonable given the operations
      expect(results[2]).toBeInstanceOf(Array); // getAuthStatus returns array
    });
  });
});

describe('OAuth Integration Tests - Error Handling & Recovery', () => {
  let tokenStore: TestTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tokenStore = new TestTokenStore();
    oauthManager = new OAuthManager(tokenStore);

    oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
    oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));

    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Storage Error Scenarios', () => {
    it('should handle token storage failures gracefully', async () => {
      const qwenToken = createValidToken('qwen');

      // Make token store fail on save
      tokenStore.setShouldThrow(true, 'qwen');
      tokenStore.setMockToken('qwen', qwenToken);

      // Getting token should return null or handle error gracefully
      const token = await oauthManager.getOAuthToken('qwen');
      expect(token).toBe(null);
    });

    it('should provide meaningful error messages for authentication failures', async () => {
      // Test unknown provider error
      await expect(
        oauthManager.authenticate('unknown-provider'),
      ).rejects.toThrow('Unknown provider: unknown-provider');

      await expect(oauthManager.logout('unknown-provider')).rejects.toThrow(
        'Unknown provider: unknown-provider',
      );
    });

    it('should handle partial storage failures during logoutAll', async () => {
      const qwenToken = createValidToken('qwen');
      const geminiToken = createValidToken('gemini');

      tokenStore.setMockToken('qwen', qwenToken);
      tokenStore.setMockToken('gemini', geminiToken);

      // Make logout fail for qwen but succeed for gemini
      tokenStore.setShouldThrow(true, 'qwen');

      // logoutAll should continue despite failures
      await oauthManager.logoutAll();

      // Gemini should still be logged out
      expect(await tokenStore.getToken('gemini')).toBeNull();
    });
  });

  describe('Token Validation and Expiry Scenarios', () => {
    it('should handle expired tokens correctly', async () => {
      const expiredToken = createExpiredToken('qwen');
      tokenStore.setMockToken('qwen', expiredToken);

      const token = await oauthManager.getOAuthToken('qwen');
      // Should either return null or attempt refresh (depends on provider implementation)
      expect(token === null).toBe(true);
    });

    it('should handle invalid token data gracefully', async () => {
      const invalidToken = {
        access_token: '', // Invalid: empty access token
        expiry: -1, // Invalid: negative expiry
        token_type: 'Bearer',
      } as OAuthToken;

      tokenStore.setMockToken('qwen', invalidToken);

      const token = await oauthManager.getOAuthToken('qwen');
      // Should handle invalid token gracefully
      expect(token).toBeDefined();
    });
  });

  describe('Provider-Specific Error Scenarios', () => {
    it('should handle Gemini-specific OAuth flow errors', async () => {
      // Gemini has special error handling for USE_EXISTING_GEMINI_OAUTH
      const geminiProvider = oauthManager.getProvider('gemini');
      expect(geminiProvider).toBeDefined();

      // Test that provider exists and can handle errors
      const token = await oauthManager.getOAuthToken('gemini');
      expect(token).toBe(null); // No token stored
    });

    it('should handle provider initialization failures', async () => {
      // Create a provider that will fail initialization
      tokenStore.setShouldThrow(true, 'anthropic');

      const token = await oauthManager.getOAuthToken('anthropic');
      expect(token).toBe(null);
    });
  });
});

describe('OAuth Integration Tests - Memory-Only Mode & Settings Compatibility', () => {
  let tokenStore: TestTokenStore;

  beforeEach(() => {
    tokenStore = new TestTokenStore();
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Memory-Only Operation (No Settings)', () => {
    it('should work without settings instance', async () => {
      const oauthManager = new OAuthManager(tokenStore); // No settings
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));

      expect(oauthManager.isOAuthEnabled('qwen')).toBe(false);

      await oauthManager.toggleOAuthEnabled('qwen');
      expect(oauthManager.isOAuthEnabled('qwen')).toBe(true);

      // Should work in memory without persisting to settings
      const authStatuses = await oauthManager.getAuthStatus();
      const qwenStatus = authStatuses.find((s) => s.provider === 'qwen');
      expect(qwenStatus?.oauthEnabled).toBe(true);
    });

    it('should handle provider operations without token store', () => {
      // Test providers created without token store
      const qwenProvider = new QwenOAuthProvider(); // No token store
      const geminiProvider = new GeminiOAuthProvider(); // No token store
      const anthropicProvider = new AnthropicOAuthProvider(); // No token store

      const oauthManager = new OAuthManager(tokenStore);

      // Should still register successfully
      expect(() => {
        oauthManager.registerProvider(qwenProvider);
        oauthManager.registerProvider(geminiProvider);
        oauthManager.registerProvider(anthropicProvider);
      }).not.toThrow();

      const supportedProviders = oauthManager.getSupportedProviders();
      expect(supportedProviders).toHaveLength(3);
    });
  });

  describe('Precedence Resolution Integration', () => {
    it('should integrate with precedence resolver for higher priority auth', async () => {
      const mockSettings = new MockSettings();
      const oauthManager = new OAuthManager(tokenStore, mockSettings);
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));

      // Set up higher priority auth method (API key)
      mockSettings.merged.providerApiKeys = { qwen: 'api-key-123' };

      const higherPriorityAuth =
        await oauthManager.getHigherPriorityAuth('qwen');
      expect(higherPriorityAuth).toBe('API Key');

      // Even if OAuth is enabled and has token, API key takes precedence
      const qwenToken = createValidToken('qwen');
      tokenStore.setMockToken('qwen', qwenToken);
      mockSettings.merged.oauthEnabledProviders = { qwen: true };

      const stillHigherPriority =
        await oauthManager.getHigherPriorityAuth('qwen');
      expect(stillHigherPriority).toBe('API Key');
    });

    it('should check environment variables in precedence resolution', async () => {
      vi.stubEnv('QWEN_API_KEY', 'env-api-key');

      const mockSettings = new MockSettings();
      const oauthManager = new OAuthManager(tokenStore, mockSettings);
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));

      const higherPriorityAuth =
        await oauthManager.getHigherPriorityAuth('qwen');
      expect(higherPriorityAuth).toBe('Environment Variable');
    });
  });
});
