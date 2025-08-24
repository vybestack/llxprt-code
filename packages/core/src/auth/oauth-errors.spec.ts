/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  OAuthError,
  OAuthErrorFactory,
  OAuthErrorType,
  OAuthErrorCategory,
  RetryHandler,
  GracefulErrorHandler,
  DEFAULT_RETRY_CONFIG,
} from './oauth-errors.js';

describe('OAuthError', () => {
  it('should create error with proper classification', () => {
    const error = new OAuthError(
      OAuthErrorType.AUTHENTICATION_REQUIRED,
      'test-provider',
      'Test error message',
    );

    expect(error.name).toBe('OAuthError');
    expect(error.type).toBe(OAuthErrorType.AUTHENTICATION_REQUIRED);
    expect(error.provider).toBe('test-provider');
    expect(error.category).toBe(OAuthErrorCategory.USER_ACTION_REQUIRED);
    expect(error.isRetryable).toBe(false);
    expect(error.userMessage).toBe(
      'You need to sign in to Test-provider to continue.',
    );
    expect(error.actionRequired).toBe(
      "Run 'llxprt auth login test-provider' to sign in again.",
    );
  });

  it('should categorize network errors as transient and retryable', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network connection failed',
    );

    expect(error.category).toBe(OAuthErrorCategory.TRANSIENT);
    expect(error.isRetryable).toBe(true);
    expect(error.userMessage).toBe(
      'Unable to connect to Test-provider. Please check your internet connection.',
    );
    expect(error.actionRequired).toBe(
      'Check your internet connection and try again.',
    );
  });

  it('should categorize storage errors as system and non-retryable', () => {
    const error = new OAuthError(
      OAuthErrorType.STORAGE_ERROR,
      'test-provider',
      'Failed to write file',
    );

    expect(error.category).toBe(OAuthErrorCategory.SYSTEM);
    expect(error.isRetryable).toBe(false);
    expect(error.userMessage).toBe(
      'Unable to save Test-provider authentication data. Please check file permissions.',
    );
    expect(error.actionRequired).toBe(
      'Check that you have write permissions to ~/.llxprt directory.',
    );
  });

  it('should categorize security violations as critical', () => {
    const error = new OAuthError(
      OAuthErrorType.SECURITY_VIOLATION,
      'test-provider',
      'Token signature invalid',
    );

    expect(error.category).toBe(OAuthErrorCategory.CRITICAL);
    expect(error.isRetryable).toBe(false);
    expect(error.userMessage).toBe(
      'Test-provider authentication failed due to a security issue.',
    );
    expect(error.actionRequired).toBe(
      'Contact support if this problem persists.',
    );
  });

  it('should include technical details and original error', () => {
    const originalError = new Error('Original error message');
    const technicalDetails = { operation: 'test', code: 'ENOENT' };

    const error = new OAuthError(
      OAuthErrorType.STORAGE_ERROR,
      'test-provider',
      'Storage failed',
      {
        originalError,
        technicalDetails,
      },
    );

    expect(error.originalError).toBe(originalError);
    expect(error.technicalDetails).toEqual(technicalDetails);
  });

  it('should create proper log entry', () => {
    const originalError = new Error('Original error');
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
      {
        originalError,
        technicalDetails: { timeout: 5000 },
        retryAfterMs: 1000,
      },
    );

    const logEntry = error.toLogEntry();

    expect(logEntry).toEqual({
      type: OAuthErrorType.NETWORK_ERROR,
      category: OAuthErrorCategory.TRANSIENT,
      provider: 'test-provider',
      isRetryable: true,
      retryAfterMs: 1000,
      message: 'Network failed',
      userMessage:
        'Unable to connect to Test-provider. Please check your internet connection.',
      actionRequired: 'Check your internet connection and try again.',
      technicalDetails: { timeout: 5000 },
      stack: error.stack,
      originalError: {
        name: 'Error',
        message: 'Original error',
        stack: originalError.stack,
      },
    });
  });
});

describe('OAuthErrorFactory', () => {
  it('should create authentication required error', () => {
    const error = OAuthErrorFactory.authenticationRequired('test-provider', {
      reason: 'expired',
    });

    expect(error.type).toBe(OAuthErrorType.AUTHENTICATION_REQUIRED);
    expect(error.provider).toBe('test-provider');
    expect(error.technicalDetails).toEqual({ reason: 'expired' });
  });

  it('should create authorization expired error', () => {
    const error = OAuthErrorFactory.authorizationExpired('test-provider');

    expect(error.type).toBe(OAuthErrorType.AUTHORIZATION_EXPIRED);
    expect(error.provider).toBe('test-provider');
  });

  it('should create network error with retry delay', () => {
    const originalError = new Error('Connection refused');
    const error = OAuthErrorFactory.networkError(
      'test-provider',
      originalError,
      { host: 'api.test.com' },
    );

    expect(error.type).toBe(OAuthErrorType.NETWORK_ERROR);
    expect(error.provider).toBe('test-provider');
    expect(error.originalError).toBe(originalError);
    expect(error.retryAfterMs).toBe(1000);
    expect(error.technicalDetails).toEqual({ host: 'api.test.com' });
  });

  it('should create rate limited error with custom retry delay', () => {
    const error = OAuthErrorFactory.rateLimited('test-provider', 120, {
      limit: 100,
    });

    expect(error.type).toBe(OAuthErrorType.RATE_LIMITED);
    expect(error.provider).toBe('test-provider');
    expect(error.retryAfterMs).toBe(120000); // 120 seconds in milliseconds
    expect(error.technicalDetails).toEqual({ limit: 100 });
  });

  it('should create storage error', () => {
    const originalError = new Error('EACCES: permission denied');
    const error = OAuthErrorFactory.storageError(
      'test-provider',
      originalError,
      { path: '/restricted' },
    );

    expect(error.type).toBe(OAuthErrorType.STORAGE_ERROR);
    expect(error.provider).toBe('test-provider');
    expect(error.originalError).toBe(originalError);
    expect(error.technicalDetails).toEqual({ path: '/restricted' });
  });

  it('should create corrupted data error', () => {
    const error = OAuthErrorFactory.corruptedData('test-provider', {
      file: 'tokens.json',
    });

    expect(error.type).toBe(OAuthErrorType.CORRUPTED_DATA);
    expect(error.provider).toBe('test-provider');
    expect(error.technicalDetails).toEqual({ file: 'tokens.json' });
  });

  describe('fromUnknown', () => {
    it('should classify network errors correctly', () => {
      const networkError = new Error('Connection timed out');
      networkError.code = 'ENOTFOUND';

      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        networkError,
      );

      expect(error.type).toBe(OAuthErrorType.NETWORK_ERROR);
      expect(error.originalError).toBe(networkError);
    });

    it('should classify timeout errors correctly', () => {
      const timeoutError = new Error('Request timeout exceeded');

      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        timeoutError,
      );

      expect(error.type).toBe(OAuthErrorType.TIMEOUT);
      expect(error.originalError).toBe(timeoutError);
    });

    it('should classify permission errors correctly', () => {
      const permissionError = new Error('Access denied');
      permissionError.code = 'EACCES';

      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        permissionError,
      );

      expect(error.type).toBe(OAuthErrorType.FILE_PERMISSIONS);
      expect(error.originalError).toBe(permissionError);
    });

    it('should classify unauthorized errors correctly', () => {
      const authError = new Error('Unauthorized access - invalid_grant');

      const error = OAuthErrorFactory.fromUnknown('test-provider', authError);

      expect(error.type).toBe(OAuthErrorType.AUTHORIZATION_EXPIRED);
      expect(error.originalError).toBe(authError);
    });

    it('should classify rate limit errors correctly', () => {
      const rateLimitError = new Error(
        'Too many requests - rate limit exceeded',
      );

      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        rateLimitError,
      );

      expect(error.type).toBe(OAuthErrorType.RATE_LIMITED);
      expect(error.originalError).toBe(rateLimitError);
    });

    it('should handle string errors', () => {
      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        'String error message',
      );

      expect(error.type).toBe(OAuthErrorType.UNKNOWN);
      expect(error.message).toBe('String error message');
      expect(error.originalError).toBeNull();
    });

    it('should handle non-Error objects', () => {
      const error = OAuthErrorFactory.fromUnknown('test-provider', {
        code: 500,
        message: 'Server error',
      });

      expect(error.type).toBe(OAuthErrorType.UNKNOWN);
      expect(error.message).toBe('[object Object]');
      expect(error.originalError).toBeNull();
    });

    it('should include context in error message', () => {
      const error = OAuthErrorFactory.fromUnknown(
        'test-provider',
        'Test error',
        'operation context',
      );

      expect(error.message).toBe('operation context: Test error');
      expect(error.technicalDetails.context).toBe('operation context');
    });
  });
});

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;

  beforeEach(() => {
    retryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelayMs: 100,
      backoffMultiplier: 2,
      maxDelayMs: 1000,
      jitter: false, // Disable jitter for predictable tests
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retryHandler.executeWithRetry(
      operation,
      'test-provider',
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.skip('should retry transient errors with exponential backoff', async () => {
    // Use a retry handler with no delay to avoid timing issues
    const testRetryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelayMs: 0,
      backoffMultiplier: 1,
      maxDelayMs: 0,
      jitter: false,
    });

    let attempts = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw OAuthErrorFactory.networkError('test-provider');
      }
      return 'success';
    });

    const result = await testRetryHandler.executeWithRetry(
      operation,
      'test-provider',
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should not retry non-transient errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(
        OAuthErrorFactory.authenticationRequired('test-provider'),
      );

    await expect(
      retryHandler.executeWithRetry(operation, 'test-provider'),
    ).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should respect specific retry delays from errors', async () => {
    let attempts = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw OAuthErrorFactory.rateLimited('test-provider', 2); // 2 second delay
      }
      return 'success';
    });

    const executePromise = retryHandler.executeWithRetry(
      operation,
      'test-provider',
    );

    // Fast-forward through the specific delay
    await vi.advanceTimersByTimeAsync(2000);

    const result = await executePromise;

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.skip('should fail after max attempts', async () => {
    // Use a retry handler with no delay to avoid timing issues
    const testRetryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelayMs: 0,
      backoffMultiplier: 1,
      maxDelayMs: 0,
      jitter: false,
    });

    const operation = vi
      .fn()
      .mockRejectedValue(OAuthErrorFactory.networkError('test-provider'));

    await expect(
      testRetryHandler.executeWithRetry(operation, 'test-provider'),
    ).rejects.toThrow('Network error');
    expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should convert non-OAuth errors to OAuth errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Generic error'));

    await expect(
      retryHandler.executeWithRetry(operation, 'test-provider'),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('should apply jitter when enabled', () => {
    const retryHandlerWithJitter = new RetryHandler({
      ...DEFAULT_RETRY_CONFIG,
      jitter: true,
    });

    const operation = vi
      .fn()
      .mockRejectedValue(OAuthErrorFactory.networkError('test-provider'));

    // We can't easily test the exact jitter values, but we can verify it doesn't crash
    expect(() => {
      retryHandlerWithJitter
        .executeWithRetry(operation, 'test-provider')
        .catch(() => {});
    }).not.toThrow();
  });
});

describe('GracefulErrorHandler', () => {
  let gracefulHandler: GracefulErrorHandler;
  let mockRetryHandler: RetryHandler;

  beforeEach(() => {
    mockRetryHandler = new RetryHandler({
      maxAttempts: 1,
      baseDelayMs: 0,
      backoffMultiplier: 1,
      maxDelayMs: 0,
      jitter: false,
    });
    gracefulHandler = new GracefulErrorHandler(mockRetryHandler);
  });

  describe('handleGracefully', () => {
    it('should return result on success', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await gracefulHandler.handleGracefully(
        operation,
        'fallback',
        'test-provider',
      );

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should return fallback value on non-critical errors', async () => {
      const operation = vi
        .fn()
        .mockRejectedValue(OAuthErrorFactory.networkError('test-provider'));

      const result = await gracefulHandler.handleGracefully(
        operation,
        'fallback',
        'test-provider',
      );

      expect(result).toBe('fallback');
    });

    it('should call fallback function on non-critical errors', async () => {
      const operation = vi
        .fn()
        .mockRejectedValue(OAuthErrorFactory.storageError('test-provider'));
      const fallbackFn = vi.fn().mockReturnValue('computed-fallback');

      const result = await gracefulHandler.handleGracefully(
        operation,
        fallbackFn,
        'test-provider',
      );

      expect(result).toBe('computed-fallback');
      expect(fallbackFn).toHaveBeenCalledTimes(1);
    });

    it('should throw critical errors without using fallback', async () => {
      const operation = vi
        .fn()
        .mockRejectedValue(
          new OAuthError(
            OAuthErrorType.SECURITY_VIOLATION,
            'test-provider',
            'Critical error',
          ),
        );

      await expect(
        gracefulHandler.handleGracefully(
          operation,
          'fallback',
          'test-provider',
        ),
      ).rejects.toThrow('Critical error');
    });

    it('should convert unknown errors to OAuth errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Unknown error'));

      const result = await gracefulHandler.handleGracefully(
        operation,
        'fallback',
        'test-provider',
      );

      expect(result).toBe('fallback');
    });
  });

  describe('wrapMethod', () => {
    it('should return wrapped method that handles errors gracefully', async () => {
      const originalMethod = vi.fn().mockResolvedValue('success');
      const wrappedMethod = gracefulHandler.wrapMethod(
        originalMethod,
        'test-provider',
        'testMethod',
      );

      const result = await wrappedMethod('arg1', 'arg2');

      expect(result).toBe('success');
      expect(originalMethod).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should show user-friendly messages for user-actionable errors', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const originalMethod = vi
        .fn()
        .mockRejectedValue(
          OAuthErrorFactory.authenticationRequired('test-provider'),
        );

      const wrappedMethod = gracefulHandler.wrapMethod(
        originalMethod,
        'test-provider',
        'testMethod',
      );

      await expect(wrappedMethod()).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'You need to sign in to Test-provider to continue.',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Action required: Run 'llxprt auth login test-provider' to sign in again.",
      );

      consoleSpy.mockRestore();
    });

    it('should use fallback for non-critical errors', async () => {
      const originalMethod = vi
        .fn()
        .mockRejectedValue(OAuthErrorFactory.networkError('test-provider'));
      const fallbackFn = vi.fn().mockReturnValue('fallback-result');

      const wrappedMethod = gracefulHandler.wrapMethod(
        originalMethod,
        'test-provider',
        'testMethod',
        fallbackFn,
      );

      const result = await wrappedMethod('arg');

      expect(result).toBe('fallback-result');
      expect(fallbackFn).toHaveBeenCalledWith('arg');
    });

    it('should not use fallback for critical errors', async () => {
      const originalMethod = vi
        .fn()
        .mockRejectedValue(
          new OAuthError(
            OAuthErrorType.SECURITY_VIOLATION,
            'test-provider',
            'Critical error',
          ),
        );

      const wrappedMethod = gracefulHandler.wrapMethod(
        originalMethod,
        'test-provider',
        'testMethod',
        'fallback',
      );

      await expect(wrappedMethod()).rejects.toThrow('Critical error');
    });
  });
});

describe('Integration Tests', () => {
  it('should handle complex error scenarios gracefully', async () => {
    const gracefulHandler = new GracefulErrorHandler();
    let attempts = 0;

    const simulateComplexOperation = async (): Promise<string> => {
      attempts++;

      switch (attempts) {
        case 1:
          throw OAuthErrorFactory.networkError('test-provider'); // Should retry
        case 2:
          throw OAuthErrorFactory.rateLimited('test-provider', 1); // Should retry with delay
        case 3:
          return 'success';
        default:
          throw new Error('Unexpected attempt');
      }
    };

    vi.useFakeTimers();

    const resultPromise = gracefulHandler.handleGracefully(
      simulateComplexOperation,
      'fallback',
      'test-provider',
      'complexOperation',
    );

    // Advance through the retry delays
    await vi.advanceTimersByTimeAsync(1000); // Network error retry
    await vi.advanceTimersByTimeAsync(1000); // Rate limit delay

    const result = await resultPromise;

    expect(result).toBe('success');
    expect(attempts).toBe(3);

    vi.useRealTimers();
  });

  it('should provide comprehensive error information for debugging', () => {
    const originalError = new Error('Request timeout exceeded');

    const error = OAuthErrorFactory.fromUnknown(
      'anthropic',
      originalError,
      'token refresh',
    );

    const logEntry = error.toLogEntry();

    expect(logEntry).toMatchObject({
      type: OAuthErrorType.TIMEOUT,
      category: OAuthErrorCategory.TRANSIENT,
      provider: 'anthropic',
      isRetryable: true,
      userMessage: 'Connection to Anthropic timed out. Please try again.',
      actionRequired: 'Wait a few minutes and try again.',
      technicalDetails: {
        context: 'token refresh',
        originalErrorType: 'object',
      },
      originalError: {
        name: 'Error',
        message: 'Request timeout exceeded',
      },
    });
  });
});
