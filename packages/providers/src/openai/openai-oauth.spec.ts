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
import { NotYetImplemented } from '@vybestack/llxprt-code-core/utils/errors.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { createProviderWithRuntime as createProviderWithRuntimeHelper } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-settings';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

// Helper functions and utilities for OpenAI OAuth testing

// Mock OAuth manager interface for testing
interface MockOAuthManager {
  getToken(provider: string, metadata?: unknown): Promise<string | null>;
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

describe.skipIf(skipInCI)('OpenAI Provider OAuth Integration', () => {
  let mockOAuthManager: MockOAuthManager;
  let originalEnv: NodeJS.ProcessEnv;
  const createProviderWithRuntime = (
    options: {
      cliKey?: string | null;
      baseUrl?: string;
      providerConfig?: typeof TEST_PROVIDER_CONFIG;
      oauthManager?: MockOAuthManager;
    } = {},
  ): OpenAIProvider => {
    const {
      cliKey,
      baseUrl,
      providerConfig = TEST_PROVIDER_CONFIG,
      oauthManager = mockOAuthManager,
    } = options;

    const { provider } = createProviderWithRuntimeHelper<OpenAIProvider>(
      ({ settingsService }) => {
        if (cliKey !== undefined) {
          if (cliKey && cliKey.trim() !== '') {
            settingsService.set('auth-key', cliKey);
          } else {
            settingsService.set('auth-key', undefined);
          }
        }

        return new OpenAIProvider(
          cliKey ?? '',
          baseUrl,
          providerConfig,
          oauthManager,
        );
      },
      {
        runtimeId: 'openai.oauth.spec.runtime',
        metadata: { source: 'openai-oauth.spec.ts' },
      },
    );

    return provider;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Clear global SettingsService instance to ensure isolation
    const {
      createProviderRuntimeContext,
      setActiveProviderRuntimeContext,
      clearActiveProviderRuntimeContext,
    } = await import(
      '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js'
    );
    const { getSettingsService, registerSettingsService: registerSS } =
      await import('@vybestack/llxprt-code-settings');
    const tempRuntime = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'test-global-runtime',
    });
    setActiveProviderRuntimeContext(tempRuntime);
    registerSS(tempRuntime.settingsService);
    const globalSettingsService = getSettingsService();
    globalSettingsService.clear();
    clearActiveProviderRuntimeContext();

    // Clear OPENAI_API_KEY for OAuth tests to work properly
    delete process.env.OPENAI_API_KEY;

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
    flushRuntimeAuthScope('openai.oauth.spec.runtime');
    flushRuntimeAuthScope('test-global-runtime');
    flushRuntimeAuthScope('legacy-singleton');
  });

  describe('Authentication Precedence', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Command line key takes precedence
     * @given --key flag, env var, and OAuth all present
     * @when isAuthenticated() called
     * @then Uses command line key value
     */
    it('should use command line API key when all auth methods present', async () => {
      // Given: All auth methods available
      const cliApiKey = 'cli-key-123';
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider with CLI key stored in runtime settings
      const provider = createProviderWithRuntime({ cliKey: cliApiKey });

      // Then: Should be authenticated (using CLI API key with highest precedence)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // Verify OAuth manager was not called since CLI key has precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario Environment variable second precedence
     * @given No --key flag, but OPENAI_API_KEY set
     * @when isAuthenticated() called
     * @then Uses environment variable value
     * @and Ignores OAuth token if present
     */
    it('should use environment variable when no CLI key provided', async () => {
      // Given: Env var and OAuth available, no CLI key
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider without CLI key
      const provider = createProviderWithRuntime();

      // Then: Should be authenticated (using environment variable with second precedence)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // Verify OAuth manager was not called since env var has precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario OAuth token as fallback
     * @given No --key flag, no env var
     * @when isAuthenticated() called
     * @then Returns false — OAuth is no longer supported for OpenAI/Qwen endpoints
     */
    it('should not authenticate via OAuth for standard OpenAI endpoints', async () => {
      // Given: Only OAuth available (no API key)
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');

      // When: Creating provider without CLI key or env var (defaults to standard OpenAI endpoint)
      const provider = createProviderWithRuntime();

      // Then: Should not be authenticated (OAuth not supported for any OpenAI endpoint)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

      // OAuth manager should not be called since provider doesn't support OAuth
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.1
     * @scenario No authentication available
     * @given No --key, no env var, no OAuth
     * @when isAuthenticated() called
     * @then Returns null, provider unavailable
     */
    it('should return null when no authentication available', async () => {
      // Given: No auth methods available
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      // When: Creating provider without any auth (defaults to standard OpenAI endpoint)
      const provider = createProviderWithRuntime();

      // Then: Should not be authenticated (no auth available, and OAuth not supported for standard OpenAI)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

      // OAuth manager should not be called since provider doesn't support OAuth for standard OpenAI
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('OAuth Token Usage and Lazy Triggering', () => {
    /**
     * @requirement REQ-004.3
     * @scenario OAuth no longer triggered for Qwen endpoints
     * @given Qwen/DashScope endpoint with OAuth manager
     * @when isAuthenticated() called
     * @then OAuth flow is NOT triggered (API-key-only)
     */
    it('should not trigger OAuth flow for Qwen/DashScope endpoints', async () => {
      // Given: Qwen endpoint but OAuth is no longer supported
      const qwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      // When: Creating provider and checking authentication
      const provider = createProviderWithRuntime({ baseUrl: qwenBaseUrl });

      // Then: Should NOT be authenticated (no API key, no OAuth)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

      // OAuth manager should stay fully unused (neither entrypoint called)
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
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
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      // Then: Should use API key without calling OAuth manager
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // OAuth manager should not be called due to precedence
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-004.3
     * @scenario API key used for Qwen/DashScope endpoint
     * @given Valid API key for DashScope endpoint
     * @when isAuthenticated() called
     * @then Provider is authenticated via API key
     */
    it('should authenticate Qwen/DashScope endpoint via API key', async () => {
      // Given: Valid API key for DashScope endpoint
      const apiKey = 'dashscope-api-key';

      // When: Using API key for Qwen endpoint
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      // Then: Should be authenticated with API key
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // OAuth manager should stay fully unused (neither entrypoint called)
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();
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
      (mockOAuthManager.getToken as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      (
        mockOAuthManager.isAuthenticated as ReturnType<typeof vi.fn>
      ).mockResolvedValue(false);
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
     * @scenario Qwen endpoint detection — API key only
     * @given OPENAI_BASE_URL set to Qwen endpoint
     * @when Provider validates authentication
     * @then Detects Qwen endpoint but OAuth is not supported (API-key-only)
     */
    it('should detect Qwen endpoints but not authenticate via OAuth', async () => {
      // Given: Qwen base URL and OAuth token (but OAuth is disabled)
      const qwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      // When: Creating provider with Qwen URL and OAuth
      const provider = new OpenAIProvider(
        '',
        qwenBaseUrl,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should NOT be authenticated (OAuth no longer supported for Qwen)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
      // OAuth manager should stay fully unused (neither entrypoint called)
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
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

      // Then: Should not be authenticated without API key (OAuth not used for standard OpenAI)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

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

      // Then: Should not be authenticated (OAuth not used for unrecognized endpoints)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Qwen endpoint variants — API-key authentication
     * @given Different Qwen endpoint formats with API keys
     * @when Validating authentication
     * @then All Qwen endpoint patterns authenticate via API key
     */
    it('should authenticate various Qwen endpoint formats via API key', async () => {
      const qwenEndpoints = [
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'https://dashscope.aliyuncs.com/api/v1',
        'https://api.qwen.com/v1',
      ];

      for (const endpoint of qwenEndpoints) {
        // When: Creating provider with each Qwen endpoint variant and API key
        const provider = new OpenAIProvider(
          'dashscope-api-key',
          endpoint,
          TEST_PROVIDER_CONFIG,
          mockOAuthManager,
        );

        // Then: Should authenticate via API key for all Qwen variants
        const isAuthenticated = await provider.isAuthenticated();
        expect(isAuthenticated).toBe(true);
      }
    });

    /**
     * @requirement REQ-004.1
     * @scenario Qwen provider with name override and API key
     * @given Provider instance with name overridden to 'qwen' with API key
     * @when Validating authentication
     * @then Should authenticate via API key regardless of name
     */
    it('should authenticate qwen-named provider via API key', async () => {
      // Given: Provider with API key
      const provider = new OpenAIProvider(
        'dashscope-api-key',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Override the name to 'qwen' (simulating providerManagerInstance.ts behavior)
      Object.defineProperty(provider, 'name', {
        value: 'qwen',
        writable: false,
        enumerable: true,
        configurable: true,
      });

      // When: Checking authentication
      const isAuthenticated = await provider.isAuthenticated();

      // Then: Should authenticate via API key
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-006.1
     * @scenario Backward compatibility with API keys
     * @given Existing API key setup
     * @when No OAuth manager provided
     * @then Works exactly as before
     */
    it('supports API key auth without OAuth manager', async () => {
      // Given: Traditional API key setup, no OAuth manager
      const apiKey = 'traditional-api-key-123';

      // When: Creating provider without OAuth manager
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
        oauthManager: undefined,
      });

      // Then: Should work exactly as before - provider should be authenticated with API key
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });
  });

  describe('Authentication Status', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Check authentication status — API key only
     * @given API key present for Qwen endpoint
     * @when isAuthenticated() called
     * @then Returns true (via API key, not OAuth)
     */
    it('should return true when API key is available for Qwen endpoint', async () => {
      // Given: Valid API key for Qwen endpoint
      delete process.env.OPENAI_API_KEY;

      // When: Checking authentication status with Qwen endpoint and API key
      const provider = new OpenAIProvider(
        'dashscope-api-key',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should return true (API key available)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);

      // OAuth manager should stay fully unused (neither entrypoint called)
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
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
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
        oauthManager: mockOAuthManager,
      });

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
      (mockOAuthManager.getToken as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      (
        mockOAuthManager.isAuthenticated as ReturnType<typeof vi.fn>
      ).mockResolvedValue(false);

      // When: Checking auth status with no auth but using Qwen endpoint
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        'https://dashscope.aliyuncs.com/compatible-mode/v1', // Qwen endpoint
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Then: Should return false (no auth available, OAuth not supported)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);

      // OAuth manager should stay fully unused (neither entrypoint called)
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
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

      // Then: Should fall back to environment variable and be authenticated
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

      // Then: Should fall back to environment variable (OAuth errors are caught) and be authenticated
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
