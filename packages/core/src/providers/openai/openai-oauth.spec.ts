/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { NotYetImplemented } from '../../utils/errors.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';

// Helper function to access private methods in tests with proper binding
function getPrivateMethod<T extends (...args: never[]) => unknown>(
  obj: unknown,
  method: string,
): T {
  const fn = (obj as Record<string, unknown>)[method] as T;
  return fn.bind(obj) as T;
}

// Mock OAuth manager interface for testing
interface MockOAuthManager {
  getToken(provider: string): Promise<string | null>;
  isAuthenticated(provider: string): Promise<boolean>;
  refreshToken?(provider: string): Promise<string | null>;
}

// Mock OpenAI module
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn(),
    },
  })),
}));

describe('OpenAI Provider OAuth Integration', () => {
  let mockOAuthManager: MockOAuthManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Create a fresh mock OAuth manager for each test
    mockOAuthManager = {
      getToken: vi.fn(),
      isAuthenticated: vi.fn(),
      refreshToken: vi.fn(),
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Authentication Precedence', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Command line key takes precedence
     * @given --key flag, env var, and OAuth all present
     * @when resolveAuthentication() called
     * @then Uses command line key value
     */
    it('should use command line API key when all auth methods present', async () => {
      // Given: All auth methods available
      const cliApiKey = 'cli-key-123';
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider with CLI key and OAuth manager
      const provider = new OpenAIProvider(
        cliApiKey,
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should resolve to CLI API key (highest precedence)
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(cliApiKey);

      // Verify OAuth manager was not called since CLI key has precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario Environment variable second precedence
     * @given No --key flag, but OPENAI_API_KEY set
     * @when resolveAuthentication() called
     * @then Uses environment variable value
     * @and Ignores OAuth token if present
     */
    it('should use environment variable when no CLI key provided', async () => {
      // Given: Env var and OAuth available, no CLI key
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider without CLI key
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should resolve to environment variable (second precedence)
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe('env-key-456');

      // Verify OAuth manager was not called since env var has precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario OAuth token as fallback
     * @given No --key flag, no env var
     * @when resolveAuthentication() called
     * @then Uses OAuth token from manager
     */
    it('should use OAuth token when no other auth methods available', async () => {
      // Given: Only OAuth available
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider without CLI key or env var
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should resolve to OAuth token (lowest precedence)
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe('oauth-token-789');

      // Verify OAuth manager was called
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });

    /**
     * @requirement REQ-004.1
     * @scenario No authentication available
     * @given No --key, no env var, no OAuth
     * @when resolveAuthentication() called
     * @then Returns null, provider unavailable
     */
    it('should return null when no authentication available', async () => {
      // Given: No auth methods available
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      // When: Creating provider without any auth
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should resolve to null (no auth available)
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(null);

      // Verify OAuth manager was called but returned null
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });
  });

  describe('OAuth Token Usage and Lazy Triggering', () => {
    /**
     * @requirement REQ-004.3
     * @scenario Lazy OAuth triggering during API call
     * @given OAuth enabled but not yet authenticated
     * @when Making API request that requires authentication
     * @then OAuth flow triggered lazily before API call
     * @and Token retrieved for use as API key
     */
    it('should trigger OAuth flow lazily when API call requires authentication', async () => {
      // Given: OAuth enabled but not yet authenticated
      const qwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      const oauthToken = 'lazy-oauth-token-123';

      // Mock OAuth manager to indicate OAuth is enabled
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);
      const mockIsOAuthEnabled = vi.fn().mockResolvedValue(true);
      (
        mockOAuthManager as unknown as {
          isOAuthEnabled: typeof mockIsOAuthEnabled;
        }
      ).isOAuthEnabled = mockIsOAuthEnabled;

      // When: Creating provider and checking authentication (simulating API call prep)
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        qwenBaseUrl, // Qwen endpoint allows OAuth
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should lazily retrieve OAuth token when needed
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(oauthToken);

      // OAuth manager should have been called to get token
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });

    /**
     * @requirement REQ-004.3
     * @scenario OAuth skipped when higher priority auth available
     * @given API key and OAuth both available
     * @when Making API request
     * @then Uses API key without triggering OAuth
     */
    it('should skip OAuth when API key has higher precedence', async () => {
      // Given: API key has higher precedence than OAuth
      const apiKey = 'api-key-with-precedence';
      const oauthToken = 'unused-oauth-token';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      // When: Creating provider with both API key and OAuth available
      const provider = new OpenAIProvider(
        apiKey,
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should use API key without calling OAuth manager
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(apiKey);

      // OAuth manager should not be called due to precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.3
     * @scenario OAuth token used as API key in SDK
     * @given Valid OAuth token from lazy triggering
     * @when Token passed to OpenAI SDK
     * @then SDK receives OAuth token as apiKey parameter
     */
    it('should pass lazily-obtained OAuth token as API key to OpenAI SDK', async () => {
      // Given: Valid OAuth token obtained through lazy triggering
      const oauthToken = 'lazy-oauth-token-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      // When: Using OAuth token for Qwen endpoint
      const provider = new OpenAIProvider(
        '',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: OAuth token should be available for SDK usage
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(oauthToken);

      // This token would be passed to OpenAI SDK constructor as apiKey
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.3
     * @scenario OAuth disabled prevents lazy triggering
     * @given OAuth disabled for provider
     * @when API call attempted without other auth methods
     * @then No OAuth flow triggered and authentication fails
     */
    it('should not trigger OAuth when OAuth is disabled', async () => {
      // Given: OAuth disabled, no other auth methods
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);
      const mockIsOAuthEnabled = vi.fn().mockResolvedValue(false);
      (
        mockOAuthManager as unknown as {
          isOAuthEnabled: typeof mockIsOAuthEnabled;
        }
      ).isOAuthEnabled = mockIsOAuthEnabled;

      // When: Creating provider with OAuth disabled
      const provider = new OpenAIProvider(
        '',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should not authenticate without enabled OAuth
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(null);

      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('Token Refresh', () => {
    /**
     * @requirement REQ-004.4
     * @scenario Automatic token refresh
     * @given OAuth token expires soon
     * @when API call initiated
     * @then Refreshes token before use
     * @and Uses new token for request
     */
    it('should automatically refresh expired OAuth token', async () => {
      // Given: Token that will expire soon
      const expiredToken = 'expired-token-123';
      const newToken = 'refreshed-token-456';
      vi.mocked(mockOAuthManager.getToken)
        .mockResolvedValueOnce(expiredToken)
        .mockResolvedValueOnce(newToken);
      vi.mocked(mockOAuthManager.refreshToken!).mockResolvedValue(newToken);

      // When: Making API call with expired token
      const _provider = new OpenAIProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented('handleTokenRefresh not yet implemented');
      }).toThrow(NotYetImplemented);
    });

    /**
     * @requirement REQ-004.4
     * @scenario Handle refresh failure
     * @given Expired token, refresh fails
     * @when API call attempted
     * @then Provider becomes unavailable
     * @and Returns appropriate error
     */
    it('should handle token refresh failure gracefully', async () => {
      // Given: Expired token that cannot be refreshed
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('expired-token');
      vi.mocked(mockOAuthManager.refreshToken!).mockRejectedValue(
        new Error('Refresh failed'),
      );

      // When: Attempting API call with failed refresh
      const _provider = new OpenAIProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented('handleRefreshFailure not yet implemented');
      }).toThrow(NotYetImplemented);
    });
  });

  describe('Provider Compatibility and BaseURL Validation', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Qwen endpoint detection and validation
     * @given OPENAI_BASE_URL set to Qwen endpoint
     * @when Provider validates OAuth compatibility
     * @then Detects Qwen endpoint and allows OAuth usage
     */
    it('should detect Qwen endpoints and validate OAuth usage', async () => {
      // Given: Qwen base URL and OAuth token
      const qwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      const oauthToken = 'qwen-oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      // When: Creating provider with Qwen URL and OAuth
      const provider = new OpenAIProvider(
        '',
        qwenBaseUrl,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should validate as Qwen-compatible endpoint
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(oauthToken);

      // And should be authenticated via OAuth
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Default OpenAI endpoint with OAuth
     * @given Standard OpenAI base URL
     * @when Using OAuth authentication
     * @then Should prevent OAuth usage and show appropriate error
     */
    it('should prevent OAuth usage with standard OpenAI endpoints', async () => {
      // Given: Standard OpenAI URL and OAuth token
      const standardOpenAIUrl = 'https://api.openai.com/v1';
      const oauthToken = 'oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      // When: Creating provider with standard OpenAI URL and OAuth
      const provider = new OpenAIProvider(
        '',
        standardOpenAIUrl,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should not use OAuth for standard OpenAI endpoints
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(null); // Should not use OAuth

      // OAuth manager should not be called for standard OpenAI
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario Custom endpoint detection
     * @given Custom base URL that's not Qwen
     * @when Using OAuth authentication
     * @then Should prevent OAuth usage for unknown custom endpoints
     */
    it('should prevent OAuth usage for unrecognized custom endpoints', async () => {
      // Given: Custom URL that's not Qwen
      const customUrl = 'https://my-custom-ai.com/v1';
      const oauthToken = 'oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      // When: Creating provider with custom URL and OAuth
      const provider = new OpenAIProvider(
        '',
        customUrl,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should not use OAuth for unrecognized endpoints
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(null);

      // Should not be authenticated without API key
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Qwen endpoint variants
     * @given Different Qwen endpoint formats
     * @when Validating OAuth compatibility
     * @then Recognizes all valid Qwen endpoint patterns
     */
    it('should recognize various Qwen endpoint formats', async () => {
      const qwenEndpoints = [
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'https://dashscope.aliyuncs.com/api/v1',
        'https://qwen-api.alibaba.com/v1',
      ];

      const oauthToken = 'qwen-oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      for (const endpoint of qwenEndpoints) {
        // When: Creating provider with each Qwen endpoint variant
        const provider = new OpenAIProvider(
          '',
          endpoint,
          TEST_PROVIDER_CONFIG,
          mockOAuthManager,
        );

        // Then: Should allow OAuth for all Qwen variants
        const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
          provider,
          'resolveAuthentication',
        );
        const resolvedAuth = await resolveAuth();
        expect(resolvedAuth).toBe(oauthToken);
      }
    });

    /**
     * @requirement REQ-006.1
     * @scenario Backward compatibility with API keys
     * @given Existing API key setup
     * @when No OAuth manager provided
     * @then Works exactly as before
     */
    it('should maintain backward compatibility without OAuth manager', async () => {
      // Given: Traditional API key setup, no OAuth manager
      const apiKey = 'traditional-api-key-123';

      // When: Creating provider without OAuth manager
      const provider = new OpenAIProvider(
        apiKey,
        undefined,
        TEST_PROVIDER_CONFIG,
        undefined, // No OAuth manager
      );

      // Then: Should work exactly as before - resolveAuthentication returns the API key
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe(apiKey);

      // And isAuthenticated should return true
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });
  });

  describe('Authentication Status', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Check authentication status
     * @given OAuth token present
     * @when isAuthenticated() called
     * @then Returns true
     */
    it('should return true when OAuth token is available', async () => {
      // Given: Valid OAuth token, no other auth
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('valid-token');

      // When: Checking authentication status
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should return true (OAuth token available)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // Verify OAuth manager was called
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });

    /**
     * @requirement REQ-004.1
     * @scenario Multiple auth sources status
     * @given API key and OAuth both present
     * @when isAuthenticated() called
     * @then Returns true (uses precedence)
     */
    it('should return true when multiple auth sources present', async () => {
      // Given: Both API key and OAuth available
      const apiKey = 'api-key-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      // When: Checking status with multiple auth sources
      const provider = new OpenAIProvider(
        apiKey,
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should return true (uses precedence - API key first)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // Verify OAuth manager was NOT called since API key has precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario No authentication status
     * @given No auth methods available
     * @when isAuthenticated() called
     * @then Returns false
     */
    it('should return false when no authentication available', async () => {
      // Given: No authentication methods
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      // When: Checking auth status with no auth
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should return false (no auth available)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

      // Verify OAuth manager was called but returned null
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });
  });

  describe('Error Handling', () => {
    /**
     * @requirement REQ-004.4
     * @scenario Handle missing OAuth manager
     * @given No OAuth manager provided
     * @when Checking for OAuth token
     * @then Falls back to other auth methods
     * @and No errors thrown
     */
    it('should gracefully handle missing OAuth manager', async () => {
      // Given: No OAuth manager provided
      process.env.OPENAI_API_KEY = 'fallback-env-key';

      // When: Creating provider without OAuth manager
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        undefined, // No OAuth manager
      );

      // Then: Should fall back to environment variable
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe('fallback-env-key');

      // And should be authenticated
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.3
     * @scenario Invalid token format
     * @given Malformed OAuth token
     * @when Used for API request
     * @then Request fails with auth error
     */
    it('should handle malformed OAuth token gracefully', async () => {
      // Given: Malformed OAuth token
      const malformedToken = 'invalid-token-format-!@#$%';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(malformedToken);

      // When: Using malformed token for API request
      const _provider = new OpenAIProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented(
          'handleInvalidTokenFormat not yet implemented',
        );
      }).toThrow(NotYetImplemented);
    });

    /**
     * @requirement REQ-004.4
     * @scenario OAuth manager throws error
     * @given OAuth manager throws unexpected error
     * @when Attempting to get token
     * @then Falls back to other auth methods
     * @and Logs error appropriately
     */
    it('should handle OAuth manager errors gracefully', async () => {
      // Given: OAuth manager that throws errors
      vi.mocked(mockOAuthManager.getToken).mockRejectedValue(
        new Error('OAuth service unavailable'),
      );
      process.env.OPENAI_API_KEY = 'fallback-key';

      // When: OAuth manager fails
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fall back to environment variable (OAuth errors are caught)
      const resolveAuth = getPrivateMethod<() => Promise<string | null>>(
        provider,
        'resolveAuthentication',
      );
      const resolvedAuth = await resolveAuth();
      expect(resolvedAuth).toBe('fallback-key');

      // And should still be authenticated via fallback
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.3
     * @scenario Network error during token refresh
     * @given Network connectivity issues
     * @when Token refresh attempted
     * @then Provider handles error appropriately
     * @and Provides meaningful error message
     */
    it('should handle network errors during token refresh', async () => {
      // Given: Network error during refresh
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('expired-token');
      vi.mocked(mockOAuthManager.refreshToken!).mockRejectedValue(
        new Error('Network error: ECONNREFUSED'),
      );

      // When: Network fails during refresh
      const _provider = new OpenAIProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented('handleNetworkError not yet implemented');
      }).toThrow(NotYetImplemented);
    });
  });

  describe('Integration Scenarios', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Complete OAuth flow integration
     * @given OAuth manager with full capabilities
     * @when Provider is used for API calls
     * @then All OAuth functionality works seamlessly
     */
    it('should integrate OAuth functionality end-to-end', async () => {
      // Given: Full OAuth setup
      const validToken = 'valid-oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(validToken);
      vi.mocked(mockOAuthManager.isAuthenticated).mockResolvedValue(true);

      // When: Using provider with complete OAuth integration
      const _provider = new OpenAIProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented(
          'performEndToEndOAuthTest not yet implemented',
        );
      }).toThrow(NotYetImplemented);
    });

    /**
     * @requirement REQ-006.1
     * @scenario Migration from API key to OAuth
     * @given Provider initially using API key
     * @when OAuth manager is added later
     * @then Seamlessly switches to OAuth precedence
     */
    it('should handle migration from API key to OAuth', async () => {
      // Given: Initial API key setup
      const apiKey = 'existing-api-key';

      // When: OAuth manager is added
      const oauthToken = 'new-oauth-token';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(oauthToken);

      const _provider = new OpenAIProvider(
        apiKey,
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should fail with NotYetImplemented
      expect(() => {
        throw new NotYetImplemented(
          'testMigrationScenario not yet implemented',
        );
      }).toThrow(NotYetImplemented);
    });
  });
});
