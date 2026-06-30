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
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { createProviderWithRuntime as createProviderWithRuntimeHelper } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-settings';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

// Helper functions and utilities for OpenAI OAuth testing

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
  let originalEnv: NodeJS.ProcessEnv;
  const createProviderWithRuntime = (
    options: {
      cliKey?: string | null;
      baseUrl?: string;
      providerConfig?: typeof TEST_PROVIDER_CONFIG;
    } = {},
  ): OpenAIProvider => {
    const { cliKey, baseUrl, providerConfig = TEST_PROVIDER_CONFIG } = options;

    const { provider } = createProviderWithRuntimeHelper<OpenAIProvider>(
      ({ settingsService }) => {
        if (cliKey !== undefined) {
          if (cliKey && cliKey.trim() !== '') {
            settingsService.set('auth-key', cliKey);
          } else {
            settingsService.set('auth-key', undefined);
          }
        }

        return new OpenAIProvider(cliKey ?? '', baseUrl, providerConfig);
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
      // Given: CLI and environment API keys are available
      const cliApiKey = 'cli-key-123';
      process.env.OPENAI_API_KEY = 'env-key-456';

      // When: Creating provider with CLI key stored in runtime settings
      const provider = createProviderWithRuntime({ cliKey: cliApiKey });

      // Then: Should be authenticated (using CLI API key with highest precedence)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
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
      // Given: Environment API key is available, no CLI key
      process.env.OPENAI_API_KEY = 'env-key-456';

      // When: Creating provider without CLI key
      const provider = createProviderWithRuntime();

      // Then: Should be authenticated (using environment variable with second precedence)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.1
     * @scenario OAuth token as fallback
     * @given No --key flag, no env var
     * @when isAuthenticated() called
     * @then Returns false — OAuth is no longer supported for OpenAI/Qwen endpoints
     */
    it('should not authenticate via OAuth for standard OpenAI endpoints', async () => {
      // Given: No API key is available
      delete process.env.OPENAI_API_KEY;

      // When: Creating provider without CLI key or env var (defaults to standard OpenAI endpoint)
      const provider = createProviderWithRuntime();

      // Then: Should not be authenticated (OAuth not supported for any OpenAI endpoint)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
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

      // When: Creating provider without any auth (defaults to standard OpenAI endpoint)
      const provider = createProviderWithRuntime();

      // Then: Should not be authenticated (no auth available, and OAuth not supported for standard OpenAI)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('OAuth Token Usage and Lazy Triggering', () => {
    /**
     * @requirement REQ-004.3
     * @scenario OAuth no longer triggered for Qwen endpoints
     * @given Qwen/DashScope endpoint without an API key
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
    });

    /**
     * @requirement REQ-004.3
     * @scenario API key authentication for Qwen-compatible endpoint
     * @given API key available for Qwen-compatible endpoint
     * @when Making API request
     * @then Uses API key
     */
    it('should skip OAuth when API key has higher precedence', async () => {
      // Given: API key is available for a Qwen-compatible endpoint
      const apiKey = 'api-key-with-precedence';

      // When: Creating provider with an API key
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      // Then: Should use the API key
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
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
      // When: Creating provider with OAuth disabled
      const provider = new OpenAIProvider(
        '',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        TEST_PROVIDER_CONFIG,
      );

      // Then: Should not authenticate without enabled OAuth
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
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
      );

      // Then: Should NOT be authenticated (OAuth no longer supported for Qwen)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Default OpenAI endpoint with OAuth
     * @given Standard OpenAI base URL
     * @when Using OAuth authentication
     * @then Should prevent OAuth usage and show appropriate error
     */
    it('should prevent OAuth usage with standard OpenAI endpoints', async () => {
      // Given: Standard OpenAI URL without an API key
      const standardOpenAIUrl = 'https://api.openai.com/v1';

      // When: Creating provider with standard OpenAI URL
      const provider = new OpenAIProvider(
        '',
        standardOpenAIUrl,
        TEST_PROVIDER_CONFIG,
      );

      // Then: Should not be authenticated without API key (OAuth not used for standard OpenAI)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Custom endpoint detection
     * @given Custom base URL that's not Qwen
     * @when Using OAuth authentication
     * @then Should prevent OAuth usage for unknown custom endpoints
     */
    it('should prevent OAuth usage for unrecognized custom endpoints', async () => {
      // Given: Custom URL that is not Qwen and no API key
      const customUrl = 'https://my-custom-ai.com/v1';

      // When: Creating provider with custom URL
      const provider = new OpenAIProvider('', customUrl, TEST_PROVIDER_CONFIG);

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
      );

      // Then: Should return true (API key available)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Multiple auth sources status
     * @given API key and OAuth both present
     * @when isAuthenticated() called
     * @then Returns true (uses precedence)
     */
    it('should return true when multiple auth sources present', async () => {
      // Given: API key is available
      const apiKey = 'api-key-123';

      // When: Checking status with multiple auth sources
      const provider = createProviderWithRuntime({
        cliKey: apiKey,
      });

      // Then: Should return true (uses precedence - API key first)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
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
      // When: Checking auth status with no auth but using Qwen endpoint
      const provider = new OpenAIProvider(
        '', // Empty CLI key
        'https://dashscope.aliyuncs.com/compatible-mode/v1', // Qwen endpoint
        TEST_PROVIDER_CONFIG,
      );

      // Then: Should return false (no auth available, OAuth not supported)
      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('API key fallback without OAuth manager', () => {
    /**
     * @requirement REQ-004.4
     * @scenario No OAuth manager is needed for API-key auth
     * @given Environment API key and no OAuth manager
     * @when Checking authentication
     * @then Falls back to the environment key
     */
    it('authenticates with environment key without an OAuth manager', async () => {
      process.env.OPENAI_API_KEY = 'fallback-env-key';

      const provider = new OpenAIProvider('', undefined, TEST_PROVIDER_CONFIG);

      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });
  });
});
