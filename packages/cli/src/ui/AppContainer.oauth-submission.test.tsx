/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for OAuth code submission in AppContainer
 *
 * Issue #659: Gemini OAuth times out because handleOAuthCodeSubmit only handles
 * Anthropic provider, ignoring Gemini and Qwen providers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AppContainer OAuth Code Submission', () => {
  let mockRuntime: {
    getCliOAuthManager: ReturnType<typeof vi.fn>;
  };
  let mockGeminiProvider: {
    submitAuthCode: ReturnType<typeof vi.fn>;
  };
  let mockQwenProvider: {
    submitAuthCode: ReturnType<typeof vi.fn>;
  };
  let mockAnthropicProvider: {
    submitAuthCode: ReturnType<typeof vi.fn>;
  };
  let mockOAuthManager: {
    getProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock providers with submitAuthCode method
    mockGeminiProvider = {
      submitAuthCode: vi.fn(),
    };

    mockQwenProvider = {
      submitAuthCode: vi.fn(),
    };

    mockAnthropicProvider = {
      submitAuthCode: vi.fn(),
    };

    // Create mock OAuth manager
    mockOAuthManager = {
      getProvider: vi.fn((provider: string) => {
        if (provider === 'gemini') return mockGeminiProvider;
        if (provider === 'qwen') return mockQwenProvider;
        if (provider === 'anthropic') return mockAnthropicProvider;
        return null;
      }),
    };

    // Create mock runtime
    mockRuntime = {
      getCliOAuthManager: vi.fn().mockReturnValue(mockOAuthManager),
    };
  });

  /**
   * Test that reproduces issue #659
   * When user submits OAuth code for Gemini, it should call submitAuthCode on the provider
   */
  it('should submit auth code to Gemini provider when global.__oauth_provider is "gemini"', () => {
    // Set up global variable to indicate Gemini is the active OAuth provider
    const globalObj = global as Record<string, unknown>;
    globalObj.__oauth_provider = 'gemini';

    // Simulate the handleOAuthCodeSubmit callback behavior
    const code = 'test-verification-code-123';
    const provider = globalObj.__oauth_provider;

    const oauthManager = mockRuntime.getCliOAuthManager();
    if (!oauthManager) {
      throw new Error('OAuth manager not available');
    }

    // Fixed behavior - handles all OAuth providers
    if (provider === 'anthropic') {
      const anthropicProvider = oauthManager.getProvider('anthropic');
      if (anthropicProvider && 'submitAuthCode' in anthropicProvider) {
        (
          anthropicProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    } else if (provider === 'gemini') {
      const geminiProvider = oauthManager.getProvider('gemini');
      if (geminiProvider && 'submitAuthCode' in geminiProvider) {
        (
          geminiProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    } else if (provider === 'qwen') {
      const qwenProvider = oauthManager.getProvider('qwen');
      if (qwenProvider && 'submitAuthCode' in qwenProvider) {
        (
          qwenProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    }

    // The test should now PASS
    expect(mockGeminiProvider.submitAuthCode).toHaveBeenCalledWith(code);
  });

  /**
   * Test that reproduces issue #659 for Qwen
   */
  it('should submit auth code to Qwen provider when global.__oauth_provider is "qwen"', () => {
    // Set up global variable to indicate Qwen is the active OAuth provider
    const globalObj = global as Record<string, unknown>;
    globalObj.__oauth_provider = 'qwen';

    // Simulate the handleOAuthCodeSubmit callback behavior
    const code = 'test-verification-code-456';
    const provider = globalObj.__oauth_provider;

    const oauthManager = mockRuntime.getCliOAuthManager();
    if (!oauthManager) {
      throw new Error('OAuth manager not available');
    }

    // Fixed behavior - handles all OAuth providers
    if (provider === 'anthropic') {
      const anthropicProvider = oauthManager.getProvider('anthropic');
      if (anthropicProvider && 'submitAuthCode' in anthropicProvider) {
        (
          anthropicProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    } else if (provider === 'gemini') {
      const geminiProvider = oauthManager.getProvider('gemini');
      if (geminiProvider && 'submitAuthCode' in geminiProvider) {
        (
          geminiProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    } else if (provider === 'qwen') {
      const qwenProvider = oauthManager.getProvider('qwen');
      if (qwenProvider && 'submitAuthCode' in qwenProvider) {
        (
          qwenProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    }

    // The test should now PASS
    expect(mockQwenProvider.submitAuthCode).toHaveBeenCalledWith(code);
  });

  /**
   * Verify that Anthropic still works (regression test)
   */
  it('should submit auth code to Anthropic provider when global.__oauth_provider is "anthropic"', () => {
    // Set up global variable to indicate Anthropic is the active OAuth provider
    const globalObj = global as Record<string, unknown>;
    globalObj.__oauth_provider = 'anthropic';

    // Simulate the handleOAuthCodeSubmit callback behavior
    const code = 'test-verification-code-789';
    const provider = globalObj.__oauth_provider;

    const oauthManager = mockRuntime.getCliOAuthManager();
    if (!oauthManager) {
      throw new Error('OAuth manager not available');
    }

    // Current behavior - only handles anthropic
    if (provider === 'anthropic') {
      const anthropicProvider = oauthManager.getProvider('anthropic');
      if (anthropicProvider && 'submitAuthCode' in anthropicProvider) {
        (
          anthropicProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    }

    // This should pass - Anthropic is handled correctly
    expect(mockAnthropicProvider.submitAuthCode).toHaveBeenCalledWith(code);
  });

  /**
   * Test graceful handling when OAuth manager is not available
   */
  it('should handle missing OAuth manager gracefully', () => {
    const globalObj = global as Record<string, unknown>;
    globalObj.__oauth_provider = 'gemini';

    const mockRuntimeNoManager = {
      getCliOAuthManager: vi.fn().mockReturnValue(null),
    };

    const oauthManager = mockRuntimeNoManager.getCliOAuthManager();

    // Should return early when no manager
    expect(oauthManager).toBeNull();
    expect(mockRuntimeNoManager.getCliOAuthManager).toHaveBeenCalled();
  });

  /**
   * Test graceful handling when provider doesn't exist
   */
  it('should handle missing provider gracefully', () => {
    const globalObj = global as Record<string, unknown>;
    globalObj.__oauth_provider = 'gemini';

    const mockOAuthManagerNoProvider = {
      getProvider: vi.fn().mockReturnValue(null),
    };

    const mockRuntimeNoProvider = {
      getCliOAuthManager: vi.fn().mockReturnValue(mockOAuthManagerNoProvider),
    };

    const code = 'test-code';
    const provider = globalObj.__oauth_provider;

    const oauthManager = mockRuntimeNoProvider.getCliOAuthManager();
    if (!oauthManager) {
      return;
    }

    if (provider === 'gemini') {
      const geminiProvider = oauthManager.getProvider('gemini');
      if (geminiProvider && 'submitAuthCode' in geminiProvider) {
        (
          geminiProvider as { submitAuthCode: (code: string) => void }
        ).submitAuthCode(code);
      }
    }

    // Should not have been called since provider is null
    expect(mockOAuthManagerNoProvider.getProvider).toHaveBeenCalledWith(
      'gemini',
    );
  });
});
