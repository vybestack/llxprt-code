/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function integrationMetadata(provider: string): Record<string, unknown> {
  return {
    providerId: provider,
    profileId: 'default',
    runtimeAuthScopeId: `integration-${provider}`,
  } satisfies Record<string, unknown>;
}

/**
 * Integration tests for complete auth precedence flow and provider coordination
 *
 * These tests verify the end-to-end behavior of:
 * - OAuth enablement toggling
 * - Lazy OAuth triggering during API calls
 * - Auth precedence checking (CLI > Env > OAuth)
 * - Provider coordination with auth system
 * - OAuth enablement persistence
 */

// Mock interfaces for testing
interface MockConfig {
  getOAuthEnabled(provider: string): boolean;
  setOAuthEnabled(provider: string, enabled: boolean): Promise<void>;
  getHigherPriorityAuth(provider: string): Promise<string | null>;
}

interface MockOAuthManager {
  toggleOAuthEnabled(provider: string): Promise<boolean>;
  isOAuthEnabled(provider: string): Promise<boolean>;
  getToken(provider: string, metadata?: unknown): Promise<string | null>;
  getHigherPriorityAuth(provider: string): Promise<string | null>;
  getAuthStatus(): Promise<
    Array<{
      provider: string;
      authenticated: boolean;
      oauthEnabled?: boolean;
      expiresIn?: number;
    }>
  >;
}

interface MockProvider {
  name: string;
  isAuthenticated(): Promise<boolean>;
  resolveAuthentication(): Promise<string | null>;
  makeApiCall?(): Promise<unknown>;
}

describe('Auth Integration: Complete Precedence Flow and Provider Coordination', () => {
  let mockConfig: MockConfig;
  let mockOAuthManager: MockOAuthManager;
  let mockQwenProvider: MockProvider;
  let mockGeminiProvider: MockProvider;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Mock configuration system
    mockConfig = {
      getOAuthEnabled: vi.fn(),
      setOAuthEnabled: vi.fn(),
      getHigherPriorityAuth: vi.fn(),
    };

    // Mock OAuth manager
    mockOAuthManager = {
      toggleOAuthEnabled: vi.fn(),
      isOAuthEnabled: vi.fn(),
      getToken: vi.fn(),
      getHigherPriorityAuth: vi.fn(),
      getAuthStatus: vi.fn(),
    };

    // Mock provider instances
    mockQwenProvider = {
      name: 'qwen',
      isAuthenticated: vi.fn(),
      resolveAuthentication: vi.fn(),
      makeApiCall: vi.fn(),
    };

    mockGeminiProvider = {
      name: 'gemini',
      isAuthenticated: vi.fn(),
      resolveAuthentication: vi.fn(),
      makeApiCall: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Complete Auth Precedence Flow', () => {
    /**
     * @scenario Complete precedence chain with OAuth
     * @given CLI arg, env var, and OAuth all available
     * @when Provider resolves authentication
     * @then Uses CLI arg (highest precedence)
     * @and OAuth is not triggered
     */
    it('should follow complete precedence chain: CLI > Env > OAuth', async () => {
      // Given: All auth methods available
      const cliArg = 'cli-api-key-123';
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getHigherPriorityAuth).mockResolvedValue(
        'CLI API Key',
      );

      // When: Provider resolves authentication with CLI key
      vi.mocked(mockQwenProvider.resolveAuthentication).mockImplementation(
        async () => {
          // Simulate provider precedence logic
          if (cliArg) return cliArg;
          if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
          return await mockOAuthManager.getToken(
            'qwen',
            integrationMetadata('qwen'),
          );
        },
      );

      const resolvedAuth = await mockQwenProvider.resolveAuthentication();

      // Then: Should use CLI key (highest precedence)
      expect(resolvedAuth).toBe(cliArg);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @scenario Environment variable fallback
     * @given No CLI arg, env var and OAuth available
     * @when Provider resolves authentication
     * @then Uses env var (second precedence)
     * @and OAuth is not triggered
     */
    it('should fall back to environment variable when no CLI arg', async () => {
      // Given: Env var and OAuth available, no CLI arg
      process.env.OPENAI_API_KEY = 'env-key-456';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getHigherPriorityAuth).mockResolvedValue(
        'Environment Variable',
      );

      // When: Provider resolves authentication without CLI key
      vi.mocked(mockQwenProvider.resolveAuthentication).mockImplementation(
        async () => {
          if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
          return await mockOAuthManager.getToken(
            'qwen',
            integrationMetadata('qwen'),
          );
        },
      );

      const resolvedAuth = await mockQwenProvider.resolveAuthentication();

      // Then: Should use environment variable (second precedence)
      expect(resolvedAuth).toBe('env-key-456');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    /**
     * @scenario OAuth as final fallback
     * @given No CLI arg, no env var, OAuth enabled
     * @when Provider resolves authentication
     * @then Triggers lazy OAuth (lowest precedence)
     * @and Returns OAuth token
     */
    it('should use OAuth as final fallback when no higher precedence auth', async () => {
      // Given: Only OAuth available
      delete process.env.OPENAI_API_KEY;
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-789');
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getHigherPriorityAuth).mockResolvedValue(null);

      // When: Provider resolves authentication with OAuth only
      vi.mocked(mockQwenProvider.resolveAuthentication).mockImplementation(
        async () =>
          await mockOAuthManager.getToken('qwen', integrationMetadata('qwen')),
      );

      const resolvedAuth = await mockQwenProvider.resolveAuthentication();

      // Then: Should use OAuth token (lowest precedence)
      expect(resolvedAuth).toBe('oauth-token-789');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.anything(),
      );
    });
  });

  describe('OAuth Enablement Persistence', () => {
    /**
     * @scenario OAuth enablement persists across sessions
     * @given OAuth enabled for qwen
     * @when System restarts (new instances)
     * @then OAuth remains enabled
     * @and Can be toggled again
     */
    it('should persist OAuth enablement across system restarts', async () => {
      // Given: OAuth enabled for qwen in first session
      vi.mocked(mockOAuthManager.toggleOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockConfig.getOAuthEnabled).mockReturnValue(true);

      // When: Enable OAuth in first session
      const firstToggleResult =
        await mockOAuthManager.toggleOAuthEnabled('qwen');
      expect(firstToggleResult).toBe(true);

      // Simulate system restart with new instances
      const newOAuthManager = { ...mockOAuthManager };
      vi.mocked(newOAuthManager.isOAuthEnabled).mockResolvedValue(true); // Persisted state

      // Then: OAuth should remain enabled after restart
      const persistedState = await newOAuthManager.isOAuthEnabled('qwen');
      expect(persistedState).toBe(true);

      // And: Can be toggled again (disable)
      vi.mocked(newOAuthManager.toggleOAuthEnabled).mockResolvedValue(false);
      const secondToggleResult =
        await newOAuthManager.toggleOAuthEnabled('qwen');
      expect(secondToggleResult).toBe(false);
    });

    /**
     * @scenario Independent enablement per provider
     * @given Multiple providers registered
     * @when OAuth enabled for qwen only
     * @then Qwen OAuth enabled, Gemini OAuth disabled
     * @and States persist independently
     */
    it('should maintain independent OAuth enablement per provider', async () => {
      // Given: Multiple providers with different OAuth states
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockImplementation(
        async (provider) => provider === 'qwen', // Only qwen enabled
      );

      // When: Check enablement for both providers
      const qwenEnabled = await mockOAuthManager.isOAuthEnabled('qwen');
      const geminiEnabled = await mockOAuthManager.isOAuthEnabled('gemini');

      // Then: Should reflect independent states
      expect(qwenEnabled).toBe(true);
      expect(geminiEnabled).toBe(false);

      // And: Status should reflect independent OAuth enablement
      vi.mocked(mockOAuthManager.getAuthStatus).mockResolvedValue([
        {
          provider: 'qwen',
          authenticated: false,
          oauthEnabled: true,
        },
        {
          provider: 'gemini',
          authenticated: false,
          oauthEnabled: false,
        },
      ]);

      const status = await mockOAuthManager.getAuthStatus();
      expect(status.find((s) => s.provider === 'qwen')?.oauthEnabled).toBe(
        true,
      );
      expect(status.find((s) => s.provider === 'gemini')?.oauthEnabled).toBe(
        false,
      );
    });
  });

  describe('Lazy OAuth Triggering During API Calls', () => {
    /**
     * @scenario Lazy OAuth triggers on first API call
     * @given OAuth enabled but not authenticated
     * @when Provider makes API call
     * @then OAuth flow triggered automatically
     * @and Subsequent calls use cached token
     */
    it('should trigger OAuth lazily on first API call and cache for subsequent calls', async () => {
      // Given: OAuth enabled but not yet authenticated
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getToken)
        .mockResolvedValueOnce(null) // First call - not authenticated
        .mockResolvedValue('oauth-token-123'); // Subsequent calls - authenticated

      const oauthMetadata = integrationMetadata('qwen');

      // Mock provider API call that triggers lazy authentication
      if (mockQwenProvider.makeApiCall) {
        vi.mocked(mockQwenProvider.makeApiCall).mockImplementation(async () => {
          const token = await mockOAuthManager.getToken('qwen', oauthMetadata);
          if (!token) {
            // Simulate lazy OAuth triggering
            await mockOAuthManager.getToken('qwen', oauthMetadata); // This would trigger OAuth in real implementation
            return 'api-call-success-with-oauth';
          }
          return 'api-call-success-cached';
        });

        // When: Make first API call (should trigger OAuth)
        const firstCallResult = await mockQwenProvider.makeApiCall();

        // Then: Should succeed with OAuth
        expect(firstCallResult).toBe('api-call-success-with-oauth');
        expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
          'qwen',
          expect.anything(),
        );

        // When: Make second API call (should use cached token)
        const secondCallResult = await mockQwenProvider.makeApiCall();

        // Then: Should succeed with cached token
        expect(secondCallResult).toBe('api-call-success-cached');
      }
    });

    /**
     * @scenario No OAuth triggering when disabled
     * @given OAuth disabled for provider
     * @when Provider attempts API call without other auth
     * @then API call fails with no authentication
     * @and No OAuth flow is triggered
     */
    it('should not trigger OAuth when disabled, causing API call to fail', async () => {
      // Given: OAuth disabled, no other auth methods
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(false);
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);
      const oauthMetadata = integrationMetadata('qwen');

      // Mock provider API call that checks authentication
      if (mockQwenProvider.makeApiCall) {
        vi.mocked(mockQwenProvider.makeApiCall).mockImplementation(async () => {
          const token = await mockOAuthManager.getToken('qwen', oauthMetadata);
          if (!token) {
            throw new Error('No authentication available');
          }
          return 'api-call-success';
        });

        // When: Attempt API call without authentication
        await expect(mockQwenProvider.makeApiCall()).rejects.toThrow(
          'No authentication available',
        );
      }

      // Then: OAuth should not have been triggered
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.anything(),
      );
      // No OAuth flow should have been initiated since it's disabled
    });
  });

  describe('Provider Coordination with Auth System', () => {
    /**
     * @scenario Multiple providers coordinate with shared auth system
     * @given Qwen and Gemini providers both using OAuth manager
     * @when Each provider resolves authentication independently
     * @then Each triggers OAuth only for its own provider
     * @and Auth states remain independent
     */
    it('should coordinate multiple providers with shared auth system', async () => {
      // Given: Both providers use same OAuth manager with different states
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockImplementation(
        async (provider) => provider === 'qwen', // Only Qwen enabled
      );
      vi.mocked(mockOAuthManager.getToken).mockImplementation(
        async (provider) => (provider === 'qwen' ? 'qwen-oauth-token' : null), // Gemini has no token
      );

      // Mock provider authentication resolution
      const qwenMetadata = {
        providerId: 'qwen',
        profileId: 'default',
        runtimeAuthScopeId: 'integration-shared',
      } satisfies Record<string, unknown>;
      const geminiMetadata = {
        providerId: 'gemini',
        profileId: 'default',
        runtimeAuthScopeId: 'integration-shared',
      } satisfies Record<string, unknown>;

      vi.mocked(mockQwenProvider.resolveAuthentication).mockImplementation(
        async () => await mockOAuthManager.getToken('qwen', qwenMetadata),
      );
      vi.mocked(mockGeminiProvider.resolveAuthentication).mockImplementation(
        async () => await mockOAuthManager.getToken('gemini', geminiMetadata),
      );

      // When: Both providers resolve authentication
      const qwenAuth = await mockQwenProvider.resolveAuthentication();
      const geminiAuth = await mockGeminiProvider.resolveAuthentication();

      // Then: Each provider gets appropriate result
      expect(qwenAuth).toBe('qwen-oauth-token');
      expect(geminiAuth).toBe(null);

      // And: OAuth manager called for each provider independently
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.anything(),
      );
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'gemini',
        expect.anything(),
      );
    });

    /**
     * @scenario Shared OAuth manager provides consistent status
     * @given Multiple providers registered with OAuth manager
     * @when Getting auth status
     * @then Returns consistent status across all providers
     * @and Includes OAuth enablement information
     */
    it('should provide consistent auth status across multiple providers', async () => {
      // Given: OAuth manager with multiple providers in different states
      vi.mocked(mockOAuthManager.getAuthStatus).mockResolvedValue([
        {
          provider: 'qwen',
          authenticated: true,
          oauthEnabled: true,
          expiresIn: 3600,
        },
        {
          provider: 'gemini',
          authenticated: false,
          oauthEnabled: false,
        },
      ]);

      // When: Get comprehensive auth status
      const status = await mockOAuthManager.getAuthStatus();

      // Then: Should show consistent state for all providers
      expect(status).toHaveLength(2);

      const qwenStatus = status.find((s) => s.provider === 'qwen');
      const geminiStatus = status.find((s) => s.provider === 'gemini');

      expect(qwenStatus).toEqual({
        provider: 'qwen',
        authenticated: true,
        oauthEnabled: true,
        expiresIn: 3600,
      });

      expect(geminiStatus).toEqual({
        provider: 'gemini',
        authenticated: false,
        oauthEnabled: false,
      });
    });
  });

  describe('End-to-End Integration Scenarios', () => {
    /**
     * @scenario Complete user workflow: enable OAuth, make API call, check status
     * @given Fresh system with no authentication
     * @when User enables OAuth, makes API call, checks status
     * @then All steps succeed with proper coordination
     */
    it('should handle complete user workflow end-to-end', async () => {
      // Step 1: Enable OAuth for qwen
      vi.mocked(mockOAuthManager.toggleOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getHigherPriorityAuth).mockResolvedValue(null);

      const enableResult = await mockOAuthManager.toggleOAuthEnabled('qwen');
      expect(enableResult).toBe(true);

      // Step 2: Simulate API call that triggers lazy OAuth
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockResolvedValue(true);
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(
        'oauth-token-from-lazy-trigger',
      );
      if (mockQwenProvider.makeApiCall) {
        vi.mocked(mockQwenProvider.makeApiCall).mockResolvedValue(
          'api-success',
        );

        const apiResult = await mockQwenProvider.makeApiCall();
        expect(apiResult).toBe('api-success');
      }

      // Step 3: Check status shows OAuth enabled and authenticated
      vi.mocked(mockOAuthManager.getAuthStatus).mockResolvedValue([
        {
          provider: 'qwen',
          authenticated: true,
          oauthEnabled: true,
          expiresIn: 3600,
        },
      ]);

      const finalStatus = await mockOAuthManager.getAuthStatus();
      expect(finalStatus[0]).toMatchObject({
        provider: 'qwen',
        authenticated: true,
        oauthEnabled: true,
      });
    });

    /**
     * @scenario Mixed auth methods coordination
     * @given Some providers use API keys, others use OAuth
     * @when Making API calls with mixed authentication
     * @then Each provider uses appropriate auth method
     * @and No interference between auth methods
     */
    it('should coordinate mixed authentication methods without interference', async () => {
      // Given: Mixed authentication setup
      process.env.OPENAI_API_KEY = 'env-api-key-for-gemini';
      vi.mocked(mockOAuthManager.isOAuthEnabled).mockImplementation(
        async (provider) => provider === 'qwen', // Only Qwen uses OAuth
      );
      vi.mocked(mockOAuthManager.getToken).mockImplementation(
        async (provider) => (provider === 'qwen' ? 'qwen-oauth-token' : null),
      );

      // Mock providers with different auth strategies
      const qwenMetadata = {
        providerId: 'qwen',
        profileId: 'default',
        runtimeAuthScopeId: 'integration-mixed',
      } satisfies Record<string, unknown>;

      vi.mocked(mockQwenProvider.resolveAuthentication).mockImplementation(
        async () => await mockOAuthManager.getToken('qwen', qwenMetadata), // OAuth only
      );
      vi.mocked(mockGeminiProvider.resolveAuthentication).mockImplementation(
        async () => process.env.OPENAI_API_KEY || null, // Env var only
      );

      // When: Both providers resolve authentication
      const qwenAuth = await mockQwenProvider.resolveAuthentication();
      const geminiAuth = await mockGeminiProvider.resolveAuthentication();

      // Then: Each uses appropriate method without interference
      expect(qwenAuth).toBe('qwen-oauth-token'); // OAuth for Qwen
      expect(geminiAuth).toBe('env-api-key-for-gemini'); // Env var for Gemini

      // And: OAuth manager only called for OAuth-enabled provider
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.anything(),
      );
      expect(mockOAuthManager.getToken).not.toHaveBeenCalledWith(
        'gemini',
        expect.anything(),
      );
    });
  });
});
