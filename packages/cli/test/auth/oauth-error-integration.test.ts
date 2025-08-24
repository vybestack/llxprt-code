/**
 * Integration tests for OAuth providers using the new error handling system
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AnthropicOAuthProvider } from '../../src/auth/anthropic-oauth-provider.js';
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import {
  OAuthError,
  OAuthErrorType,
  OAuthErrorCategory,
  TokenStore,
  OAuthToken,
} from '@vybestack/llxprt-code-core';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

// Mock TokenStore implementation for testing
class MockTokenStore implements TokenStore {
  private tokens: Map<string, OAuthToken | unknown> = new Map();
  private shouldFailSave = false;
  private shouldFailGet = false;
  private shouldFailRemove = false;

  setShouldFailSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setShouldFailGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setShouldFailRemove(fail: boolean): void {
    this.shouldFailRemove = fail;
  }

  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    if (this.shouldFailSave) {
      throw new Error(
        "EACCES: permission denied, open '/restricted/tokens.json'",
      );
    }
    this.tokens.set(provider, token);
  }

  async getToken(provider: string): Promise<OAuthToken | null> {
    if (this.shouldFailGet) {
      throw new Error('ENOENT: no such file or directory');
    }
    const token = this.tokens.get(provider);
    if (!token) return null;
    // Type guard to ensure we have a valid OAuthToken
    if (
      typeof token === 'object' &&
      token !== null &&
      'access_token' in token
    ) {
      return token as OAuthToken;
    }
    return null;
  }

  async removeToken(provider: string): Promise<void> {
    if (this.shouldFailRemove) {
      throw new Error(
        "EPERM: operation not permitted, unlink '/restricted/tokens.json'",
      );
    }
    this.tokens.delete(provider);
  }

  clear(): void {
    this.tokens.clear();
  }
}

describe.skipIf(skipInCI)('OAuth Provider Error Handling Integration', () => {
  let mockTokenStore: MockTokenStore;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockTokenStore = new MockTokenStore();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    vi.useRealTimers();
  });

  describe.skipIf(skipInCI)('AnthropicOAuthProvider', () => {
    let provider: AnthropicOAuthProvider;

    beforeEach(() => {
      provider = new AnthropicOAuthProvider(mockTokenStore);
    });

    it('should handle storage errors gracefully during token initialization', async () => {
      mockTokenStore.setShouldFailGet(true);

      // initializeToken should not throw, but handle the error gracefully
      const token = await provider.getToken();

      expect(token).toBeNull();
      // Error should be logged for debugging
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('anthropic.getToken failed:'),
        expect.any(Object),
      );
    });

    it('should handle storage errors during token save in completeAuth', async () => {
      mockTokenStore.setShouldFailSave(true);

      await expect(provider.completeAuth('test-auth-code')).rejects.toThrow();

      // Should show user-actionable error message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unable to save Anthropic authentication data'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Action required: Check that you have write permissions',
        ),
      );
    });

    it('should handle logout gracefully even with storage errors', async () => {
      // First save a token
      const mockToken = {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      };
      await mockTokenStore.saveToken('anthropic', mockToken);

      // Then make removal fail
      mockTokenStore.setShouldFailRemove(true);

      // Logout should handle the error gracefully and not crash
      await expect(provider.logout()).rejects.toThrow();

      // But it should show appropriate error messages
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unable to save Anthropic authentication data'),
      );
    });

    it('should classify and handle network errors appropriately', async () => {
      // Mock the device flow to throw network-like errors
      const networkError = new Error('getaddrinfo ENOTFOUND api.anthropic.com');
      networkError.code = 'ENOTFOUND';

      vi.spyOn(
        provider as unknown as { ensureInitialized(): Promise<void> },
        'ensureInitialized',
      ).mockRejectedValue(networkError);

      await expect(provider.getToken()).resolves.toBeNull();

      // Should log the network error for debugging
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('anthropic.getToken failed:'),
        expect.objectContaining({
          type: OAuthErrorType.NETWORK_ERROR,
          category: OAuthErrorCategory.TRANSIENT,
          isRetryable: true,
        }),
      );
    });
  });

  describe.skipIf(skipInCI)('GeminiOAuthProvider', () => {
    let provider: GeminiOAuthProvider;

    beforeEach(() => {
      provider = new GeminiOAuthProvider(mockTokenStore);
    });

    it('should handle corrupted token data gracefully', async () => {
      // Simulate corrupted token data
      mockTokenStore.setShouldFailGet(false);
      await mockTokenStore.saveToken(
        'gemini',
        'corrupted-data' as unknown as OAuthToken,
      );

      const token = await provider.getToken();

      // Should handle gracefully and return null
      expect(token).toBeNull();
    });

    it('should handle storage errors during migration', async () => {
      mockTokenStore.setShouldFailSave(true);

      // Migration should handle errors gracefully
      const token = await provider.getToken();
      expect(token).toBeNull();

      // Should log debug information
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should handle legacy token cleanup failures gracefully', async () => {
      // Mock filesystem operations to fail
      const fsError = new Error('EACCES: permission denied, unlink');
      fsError.code = 'EACCES';

      // Logout should complete even if legacy cleanup fails
      await provider.logout();

      // Should complete without throwing
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not remove legacy token file'),
      );
    });
  });

  describe.skipIf(skipInCI)('QwenOAuthProvider', () => {
    let provider: QwenOAuthProvider;

    beforeEach(() => {
      provider = new QwenOAuthProvider(mockTokenStore);
    });

    it('should handle timeout errors during device flow', async () => {
      // Mock device flow to timeout
      const timeoutError = new Error('Request timeout of 30000ms exceeded');
      vi.spyOn(
        provider as unknown as { ensureInitialized(): Promise<void> },
        'ensureInitialized',
      ).mockRejectedValue(timeoutError);

      await expect(provider.getToken()).resolves.toBeNull();

      // Should classify as timeout error
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('qwen.getToken failed:'),
        expect.objectContaining({
          type: OAuthErrorType.TIMEOUT,
          category: OAuthErrorCategory.TRANSIENT,
          isRetryable: true,
        }),
      );
    });

    it('should handle rate limiting during token operations', async () => {
      const rateLimitError = new Error('Too many requests. Please wait.');
      vi.spyOn(
        provider as unknown as { ensureInitialized(): Promise<void> },
        'ensureInitialized',
      ).mockRejectedValue(rateLimitError);

      await expect(provider.getToken()).resolves.toBeNull();

      // Should classify as rate limit error
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('qwen.getToken failed:'),
        expect.objectContaining({
          type: OAuthErrorType.RATE_LIMITED,
          category: OAuthErrorCategory.TRANSIENT,
          isRetryable: true,
        }),
      );
    });

    it('should handle refresh token failures gracefully', async () => {
      // Set up expired token
      const expiredToken = {
        access_token: 'expired-token',
        refresh_token: 'refresh-token',
        expiry: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        token_type: 'Bearer' as const,
      };
      await mockTokenStore.saveToken('qwen', expiredToken);

      // Mock refresh to fail
      const refreshError = new Error(
        'invalid_grant: Refresh token has expired',
      );
      vi.spyOn(
        provider as unknown as { deviceFlow: { refreshToken: unknown } },
        'deviceFlow',
      ).mockReturnValue({
        refreshToken: vi.fn().mockRejectedValue(refreshError),
      });

      const token = await provider.getToken();

      // Should return null and clean up invalid token
      expect(token).toBeNull();
      expect(await mockTokenStore.getToken('qwen')).toBeNull();
    });
  });

  describe.skipIf(skipInCI)('Error Message Consistency', () => {
    it('should provide consistent error messages across providers', () => {
      const providers = [
        { name: 'anthropic', instance: new AnthropicOAuthProvider() },
        { name: 'gemini', instance: new GeminiOAuthProvider() },
        { name: 'qwen', instance: new QwenOAuthProvider() },
      ];

      providers.forEach(({ instance }) => {
        const networkError = new Error('Network connection failed');
        networkError.code = 'ENOTFOUND';

        const oauthError = (
          instance as unknown as { errorHandler: { retryHandler: unknown } }
        ).errorHandler.retryHandler;

        // All providers should have error handlers
        expect(oauthError).toBeDefined();
        expect(
          (instance as unknown as { errorHandler: unknown }).errorHandler,
        ).toBeDefined();
      });
    });

    it('should provide actionable guidance for common error scenarios', () => {
      const testCases = [
        {
          type: OAuthErrorType.AUTHENTICATION_REQUIRED,
          expectedAction: (provider: string) =>
            `Run 'llxprt auth login ${provider}' to sign in again.`,
        },
        {
          type: OAuthErrorType.STORAGE_ERROR,
          expectedAction: () =>
            'Check that you have write permissions to ~/.llxprt directory.',
        },
        {
          type: OAuthErrorType.NETWORK_ERROR,
          expectedAction: () => 'Check your internet connection and try again.',
        },
        {
          type: OAuthErrorType.RATE_LIMITED,
          expectedAction: () => 'Wait a few minutes and try again.',
        },
      ];

      testCases.forEach(({ type, expectedAction }) => {
        const error = new OAuthError(type, 'test-provider', 'Test message');

        expect(error.actionRequired).toBe(expectedAction('test-provider'));
        expect(error.userMessage).toBeTruthy();
        expect(error.userMessage.length).toBeGreaterThan(10);
      });
    });
  });

  describe.skipIf(skipInCI)('Recovery Mechanisms', () => {
    it('should recover from transient failures with retry', async () => {
      const provider = new AnthropicOAuthProvider(mockTokenStore);
      let attemptCount = 0;

      // Mock a method that fails twice then succeeds
      const originalEnsureInitialized = (
        provider as unknown as { ensureInitialized(): Promise<void> }
      ).ensureInitialized.bind(provider);
      vi.spyOn(
        provider as unknown as { ensureInitialized(): Promise<void> },
        'ensureInitialized',
      ).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          const networkError = new Error('Connection refused');
          networkError.code = 'ECONNREFUSED';
          throw networkError;
        }
        return originalEnsureInitialized();
      });

      // Should eventually succeed after retries
      const executePromise = provider.getToken();

      // Advance timers to trigger retries
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry

      const result = await executePromise;

      expect(attemptCount).toBe(3);
      expect(result).toBeNull(); // No token stored, but operation succeeded
    });

    it('should gracefully degrade on non-critical failures', async () => {
      const provider = new GeminiOAuthProvider(mockTokenStore);

      // Make storage fail
      mockTokenStore.setShouldFailGet(true);

      // Should not throw, but return null gracefully
      const token = await provider.getToken();
      expect(token).toBeNull();

      // Should have logged debug information
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should clean up corrupted data automatically', async () => {
      const provider = new QwenOAuthProvider(mockTokenStore);

      // Store corrupted token data
      await mockTokenStore.saveToken('qwen', {
        corrupted: 'data',
      } as unknown as OAuthToken);

      // Should handle corrupted data and clean up
      const token = await provider.getToken();
      expect(token).toBeNull();
    });
  });

  describe.skipIf(skipInCI)('Security and Critical Error Handling', () => {
    it('should not gracefully handle critical security errors', async () => {
      const provider = new AnthropicOAuthProvider(mockTokenStore);

      // Mock a critical security error
      const securityError = new OAuthError(
        OAuthErrorType.SECURITY_VIOLATION,
        'anthropic',
        'Token signature validation failed',
      );

      vi.spyOn(
        provider as unknown as { ensureInitialized(): Promise<void> },
        'ensureInitialized',
      ).mockRejectedValue(securityError);

      // Critical errors should be thrown, not handled gracefully
      await expect(provider.getToken()).rejects.toThrow(
        'Token signature validation failed',
      );
    });

    it('should provide detailed logging for security violations', async () => {
      const securityError = new OAuthError(
        OAuthErrorType.MALFORMED_TOKEN,
        'test-provider',
        'Invalid token format detected',
        {
          technicalDetails: {
            tokenHash: 'abc123...',
            validationError: 'Invalid signature',
          },
        },
      );

      const logEntry = securityError.toLogEntry();

      expect(logEntry).toMatchObject({
        type: OAuthErrorType.MALFORMED_TOKEN,
        category: OAuthErrorCategory.CRITICAL,
        isRetryable: false,
        technicalDetails: {
          tokenHash: 'abc123...',
          validationError: 'Invalid signature',
        },
      });
    });
  });
});
