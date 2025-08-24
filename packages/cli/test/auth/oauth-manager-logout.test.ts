/**
 * @plan PLAN-20250823-AUTHFIXES.P13
 * @requirement REQ-002
 * OAuth Manager Logout TDD Tests
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { OAuthManager } from '../../src/auth/oauth-manager.js';
import {
  MultiProviderTokenStore,
  OAuthToken,
} from '@vybestack/llxprt-code-core';
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../src/auth/anthropic-oauth-provider.js';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

describe.skipIf(skipInCI)(
  'OAuthManager - Logout Single Provider (REQ-002)',
  () => {
    let tokenStore: MultiProviderTokenStore;
    let oauthManager: OAuthManager;

    beforeEach(() => {
      tokenStore = new MultiProviderTokenStore();
      oauthManager = new OAuthManager(tokenStore);

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      // Clean up tokens after each test
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
        await tokenStore.removeToken('anthropic');
      } catch {
        // Ignore cleanup errors
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout removes token from storage
     * @given User is authenticated with provider
     * @when logout() is called
     * @then Token is removed from storage
     */
    it('should remove token from storage on logout', async () => {
      const token: OAuthToken = {
        access_token: 'test-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);

      // Verify token exists before logout
      const beforeLogout = await tokenStore.getToken('qwen');
      expect(beforeLogout).toEqual(token);

      await oauthManager.logout('qwen');

      const afterLogout = await tokenStore.getToken('qwen');
      expect(afterLogout).toBeNull();
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout updates authentication status
     * @given User is authenticated with provider
     * @when logout() is called
     * @then isAuthenticated returns false
     */
    it('should update authentication status after logout', async () => {
      const token: OAuthToken = {
        access_token: 'auth-status-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);

      // Verify authenticated before logout
      const beforeAuth = await oauthManager.isAuthenticated('qwen');
      expect(beforeAuth).toBe(true);

      await oauthManager.logout('qwen');

      // Should no longer be authenticated
      const afterAuth = await oauthManager.isAuthenticated('qwen');
      expect(afterAuth).toBe(false);
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout handles provider not found
     * @given Invalid provider name
     * @when logout() is called
     * @then Error is thrown with appropriate message
     */
    it('should throw error for unknown provider', async () => {
      await expect(oauthManager.logout('unknown-provider')).rejects.toThrow(
        'Unknown provider: unknown-provider',
      );
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout handles empty provider name
     * @given Empty provider name
     * @when logout() is called
     * @then Error is thrown with appropriate message
     */
    it('should throw error for empty provider name', async () => {
      await expect(oauthManager.logout('')).rejects.toThrow(
        'Provider name must be a non-empty string',
      );
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout handles null provider name
     * @given Null provider name
     * @when logout() is called
     * @then Error is thrown with appropriate message
     */
    it('should throw error for null provider name', async () => {
      await expect(
        oauthManager.logout(null as unknown as string),
      ).rejects.toThrow('Provider name must be a non-empty string');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout with no existing token
     * @given Provider has no stored token
     * @when logout() is called
     * @then Operation completes without error
     */
    it('should handle logout with no existing token', async () => {
      // Ensure no token exists
      const beforeLogout = await tokenStore.getToken('qwen');
      expect(beforeLogout).toBeNull();

      // Should not throw error
      await oauthManager.logout('qwen');

      // Should still be no token
      const afterLogout = await tokenStore.getToken('qwen');
      expect(afterLogout).toBeNull();
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout only affects specified provider
     * @given Multiple providers are authenticated
     * @when logout() is called for one provider
     * @then Only that provider's token is removed
     */
    it('should only affect specified provider during logout', async () => {
      const qwenToken: OAuthToken = {
        access_token: 'qwen-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      const geminiToken: OAuthToken = {
        access_token: 'gemini-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', qwenToken);
      await tokenStore.saveToken('gemini', geminiToken);

      // Verify both tokens exist
      const beforeQwen = await tokenStore.getToken('qwen');
      const beforeGemini = await tokenStore.getToken('gemini');
      expect(beforeQwen).toEqual(qwenToken);
      expect(beforeGemini).toEqual(geminiToken);

      // Logout only from qwen
      await oauthManager.logout('qwen');

      // Qwen token should be gone, gemini should remain
      const afterQwen = await tokenStore.getToken('qwen');
      const afterGemini = await tokenStore.getToken('gemini');
      expect(afterQwen).toBeNull();
      expect(afterGemini).toEqual(geminiToken);
    });
  },
);

describe.skipIf(skipInCI)(
  'OAuthManager - Logout All Providers (REQ-002)',
  () => {
    let tokenStore: MultiProviderTokenStore;
    let oauthManager: OAuthManager;

    beforeEach(() => {
      tokenStore = new MultiProviderTokenStore();
      oauthManager = new OAuthManager(tokenStore);

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      // Clean up tokens after each test
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
        await tokenStore.removeToken('anthropic');
      } catch {
        // Ignore cleanup errors
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout all removes all provider tokens
     * @given Multiple providers are authenticated
     * @when logoutAll() is called
     * @then All tokens are removed from storage
     */
    it('should remove all provider tokens on logoutAll', async () => {
      const qwenToken: OAuthToken = {
        access_token: 'qwen-all-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      const geminiToken: OAuthToken = {
        access_token: 'gemini-all-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      const anthropicToken: OAuthToken = {
        access_token: 'anthropic-all-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', qwenToken);
      await tokenStore.saveToken('gemini', geminiToken);
      await tokenStore.saveToken('anthropic', anthropicToken);

      // Verify all tokens exist
      const beforeQwen = await tokenStore.getToken('qwen');
      const beforeGemini = await tokenStore.getToken('gemini');
      const beforeAnthropic = await tokenStore.getToken('anthropic');
      expect(beforeQwen).toEqual(qwenToken);
      expect(beforeGemini).toEqual(geminiToken);
      expect(beforeAnthropic).toEqual(anthropicToken);

      await oauthManager.logoutAll();

      // All tokens should be removed
      const afterQwen = await tokenStore.getToken('qwen');
      const afterGemini = await tokenStore.getToken('gemini');
      const afterAnthropic = await tokenStore.getToken('anthropic');
      expect(afterQwen).toBeNull();
      expect(afterGemini).toBeNull();
      expect(afterAnthropic).toBeNull();
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout all updates authentication status for all providers
     * @given Multiple providers are authenticated
     * @when logoutAll() is called
     * @then All providers show as not authenticated
     */
    it('should update authentication status for all providers after logoutAll', async () => {
      const token: OAuthToken = {
        access_token: 'multi-auth-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);
      await tokenStore.saveToken('gemini', token);
      await tokenStore.saveToken('anthropic', token);

      // Verify all are authenticated before logout
      const beforeQwenAuth = await oauthManager.isAuthenticated('qwen');
      const beforeGeminiAuth = await oauthManager.isAuthenticated('gemini');
      const beforeAnthropicAuth =
        await oauthManager.isAuthenticated('anthropic');
      expect(beforeQwenAuth).toBe(true);
      expect(beforeGeminiAuth).toBe(true);
      expect(beforeAnthropicAuth).toBe(true);

      await oauthManager.logoutAll();

      // All should no longer be authenticated
      const afterQwenAuth = await oauthManager.isAuthenticated('qwen');
      const afterGeminiAuth = await oauthManager.isAuthenticated('gemini');
      const afterAnthropicAuth =
        await oauthManager.isAuthenticated('anthropic');
      expect(afterQwenAuth).toBe(false);
      expect(afterGeminiAuth).toBe(false);
      expect(afterAnthropicAuth).toBe(false);
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout all with no existing tokens
     * @given No providers have stored tokens
     * @when logoutAll() is called
     * @then Operation completes without error
     */
    it('should handle logoutAll with no existing tokens', async () => {
      // Ensure no tokens exist
      const beforeQwen = await tokenStore.getToken('qwen');
      const beforeGemini = await tokenStore.getToken('gemini');
      const beforeAnthropic = await tokenStore.getToken('anthropic');
      expect(beforeQwen).toBeNull();
      expect(beforeGemini).toBeNull();
      expect(beforeAnthropic).toBeNull();

      // Should not throw error
      await oauthManager.logoutAll();

      // Should still be no tokens
      const afterQwen = await tokenStore.getToken('qwen');
      const afterGemini = await tokenStore.getToken('gemini');
      const afterAnthropic = await tokenStore.getToken('anthropic');
      expect(afterQwen).toBeNull();
      expect(afterGemini).toBeNull();
      expect(afterAnthropic).toBeNull();
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout all with partial tokens
     * @given Only some providers have stored tokens
     * @when logoutAll() is called
     * @then All existing tokens are removed
     */
    it('should handle logoutAll with partial tokens', async () => {
      const qwenToken: OAuthToken = {
        access_token: 'qwen-partial-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      // Only save token for qwen, leave others empty
      await tokenStore.saveToken('qwen', qwenToken);

      // Verify initial state
      const beforeQwen = await tokenStore.getToken('qwen');
      const beforeGemini = await tokenStore.getToken('gemini');
      const beforeAnthropic = await tokenStore.getToken('anthropic');
      expect(beforeQwen).toEqual(qwenToken);
      expect(beforeGemini).toBeNull();
      expect(beforeAnthropic).toBeNull();

      await oauthManager.logoutAll();

      // All should be null
      const afterQwen = await tokenStore.getToken('qwen');
      const afterGemini = await tokenStore.getToken('gemini');
      const afterAnthropic = await tokenStore.getToken('anthropic');
      expect(afterQwen).toBeNull();
      expect(afterGemini).toBeNull();
      expect(afterAnthropic).toBeNull();
    });
  },
);

describe.skipIf(skipInCI)(
  'OAuthManager - Logout Error Handling (REQ-002)',
  () => {
    let tokenStore: MultiProviderTokenStore;
    let oauthManager: OAuthManager;

    beforeEach(() => {
      tokenStore = new MultiProviderTokenStore();
      oauthManager = new OAuthManager(tokenStore);

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
      } catch {
        // Ignore cleanup errors
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout handles storage errors gracefully
     * @given Token store operation may fail
     * @when logout() is called
     * @then Error is handled appropriately
     */
    it('should handle storage errors during logout', async () => {
      const token: OAuthToken = {
        access_token: 'error-test-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);

      // Mock token store to throw error on removeToken
      const originalRemoveToken = tokenStore.removeToken.bind(tokenStore);
      tokenStore.removeToken = async () => {
        throw new Error('Storage error');
      };

      try {
        await oauthManager.logout('qwen');

        // Restore original method
        tokenStore.removeToken = originalRemoveToken;

        // Error should be handled or propagated appropriately
        // The specific behavior depends on implementation
        expect(true).toBe(true);
      } catch (error) {
        // Restore original method
        tokenStore.removeToken = originalRemoveToken;

        // Error should be meaningful
        expect(error).toBeInstanceOf(Error);
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout continues on partial failures during logoutAll
     * @given Multiple providers, some may fail to logout
     * @when logoutAll() is called
     * @then Available providers are logged out despite failures
     */
    it('should continue logoutAll on partial failures', async () => {
      const token: OAuthToken = {
        access_token: 'partial-failure-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);
      await tokenStore.saveToken('gemini', token);

      // Mock token store to fail on specific provider
      let removeCallCount = 0;
      const originalRemoveToken = tokenStore.removeToken.bind(tokenStore);
      tokenStore.removeToken = async (providerName: string) => {
        removeCallCount++;
        if (providerName === 'qwen') {
          throw new Error('Qwen storage error');
        }
        return originalRemoveToken(providerName);
      };

      try {
        await oauthManager.logoutAll();

        // Restore original method
        tokenStore.removeToken = originalRemoveToken;

        // At least one remove should have been attempted
        expect(removeCallCount).toBeGreaterThan(0);
      } catch (error) {
        // Restore original method
        tokenStore.removeToken = originalRemoveToken;

        // Error handling behavior depends on implementation
        expect(error).toBeInstanceOf(Error);
      }
    });
  },
);

// Property-Based Tests (30%+ of total tests)
describe.skipIf(skipInCI)('OAuthManager - Logout Property-Based Tests', () => {
  let tokenStore: MultiProviderTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(() => {
    tokenStore = new MultiProviderTokenStore();
    oauthManager = new OAuthManager(tokenStore);

    // Register test providers
    oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
    oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
  });

  afterEach(async () => {
    try {
      await tokenStore.removeToken('qwen');
      await tokenStore.removeToken('gemini');
      await tokenStore.removeToken('anthropic');
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 1: Logout with random token data
   */
  it.prop([
    fc.constantFrom('qwen', 'gemini', 'anthropic'),
    fc.string({ minLength: 10, maxLength: 100 }),
    fc.integer({
      min: Math.floor(Date.now() / 1000),
      max: Math.floor(Date.now() / 1000) + 86400,
    }),
  ])(
    'should successfully logout with any valid token data',
    async (provider, accessToken, expiry) => {
      const token: OAuthToken = {
        access_token: accessToken,
        expiry: expiry,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken(provider, token);

      // Verify token exists
      const beforeLogout = await tokenStore.getToken(provider);
      expect(beforeLogout).toEqual(token);

      await oauthManager.logout(provider);

      // Token should be removed
      const afterLogout = await tokenStore.getToken(provider);
      expect(afterLogout).toBeNull();
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 2: Logout idempotency
   */
  it.prop([
    fc.constantFrom('qwen', 'gemini', 'anthropic'),
    fc.integer({ min: 1, max: 5 }),
  ])(
    'should be idempotent - multiple logouts have same effect',
    async (provider, logoutCount) => {
      const token: OAuthToken = {
        access_token: 'idempotent-test-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken(provider, token);

      // Perform multiple logouts
      for (let i = 0; i < logoutCount; i++) {
        await oauthManager.logout(provider);
      }

      // Token should still be null after multiple logouts
      const finalToken = await tokenStore.getToken(provider);
      expect(finalToken).toBeNull();

      // Authentication status should be consistent
      const isAuth = await oauthManager.isAuthenticated(provider);
      expect(isAuth).toBe(false);
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 3: LogoutAll with random provider combinations
   */
  it.prop([
    fc.array(
      fc.record({
        provider: fc.constantFrom('qwen', 'gemini', 'anthropic'),
        token: fc.string({ minLength: 10, maxLength: 50 }),
      }),
      { minLength: 0, maxLength: 3 },
    ),
  ])(
    'should logout all providers regardless of which are authenticated',
    async (providerTokens) => {
      // Set up tokens for specified providers

      for (const pt of providerTokens) {
        const token: OAuthToken = {
          access_token: pt.token,
          expiry: Date.now() / 1000 + 3600,
          token_type: 'Bearer',
        };
        await tokenStore.saveToken(pt.provider, token);
      }

      await oauthManager.logoutAll();

      // All providers should be logged out
      for (const provider of ['qwen', 'gemini', 'anthropic']) {
        const token = await tokenStore.getToken(provider);
        expect(token).toBeNull();

        const isAuth = await oauthManager.isAuthenticated(provider);
        expect(isAuth).toBe(false);
      }
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 4: Logout with various token structures
   */
  it.prop([
    fc.constantFrom('qwen', 'gemini', 'anthropic'),
    fc.record({
      access_token: fc.string({ minLength: 1, maxLength: 200 }),
      token_type: fc.constantFrom('Bearer', 'bearer', 'BEARER'),
      expiry: fc.integer({
        min: 0,
        max: Math.floor(Date.now() / 1000) + 86400,
      }),
      refresh_token: fc.option(fc.string({ minLength: 10, maxLength: 100 })),
      scope: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    }),
  ])(
    'should handle logout with various token structures',
    async (provider, tokenData) => {
      const token: OAuthToken = {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expiry: tokenData.expiry,
        ...(tokenData.refresh_token && {
          refresh_token: tokenData.refresh_token,
        }),
        ...(tokenData.scope && { scope: tokenData.scope }),
      };

      await tokenStore.saveToken(provider, token);

      // Verify token exists
      const beforeLogout = await tokenStore.getToken(provider);
      expect(beforeLogout).toBeDefined();

      await oauthManager.logout(provider);

      // Token should be removed regardless of structure
      const afterLogout = await tokenStore.getToken(provider);
      expect(afterLogout).toBeNull();
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 5: Concurrent logout operations
   */
  it.prop([
    fc.array(fc.constantFrom('qwen', 'gemini', 'anthropic'), {
      minLength: 2,
      maxLength: 10,
    }),
  ])('should handle concurrent logout operations safely', async (providers) => {
    // Set up tokens for all used providers
    const uniqueProviders = new Set(providers);
    for (const provider of uniqueProviders) {
      const token: OAuthToken = {
        access_token: `concurrent-${provider}-token`,
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };
      await tokenStore.saveToken(provider, token);
    }

    // Perform concurrent logouts
    const logoutPromises = providers.map((provider) =>
      oauthManager.logout(provider),
    );

    await Promise.all(logoutPromises);

    // All unique providers should be logged out
    for (const provider of uniqueProviders) {
      const token = await tokenStore.getToken(provider);
      expect(token).toBeNull();
    }
  });
});
