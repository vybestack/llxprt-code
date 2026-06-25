/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OAuthError,
  OAuthErrorType,
  OAuthErrorCategory,
  RetryHandler,
  type OAuthLogger,
} from '../oauth-errors.js';

/**
 * Security-focused behavioral tests for clear-text logging remediation.
 *
 * These tests assert that `OAuthError.toLogEntry()` genuinely sanitizes
 * free-form fields that may carry secrets (message, stack, technicalDetails,
 * originalError) while preserving non-sensitive structured classification
 * fields (type, category, provider, isRetryable, retryAfterMs, userMessage,
 * actionRequired).
 *
 * Addresses CodeQL alerts 154, 155, 158 (rule js/clear-text-logging).
 */
describe('OAuthError.toLogEntry() security redaction', () => {
  it('must not leak secrets embedded in the error message', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Bearer sk-secret-TOKEN-12345 was rejected',
    );

    const serialized = JSON.stringify(error.toLogEntry());

    expect(serialized).not.toContain('sk-secret-TOKEN-12345');
    expect(error.toLogEntry().message).toBe('[redacted]');
  });

  it('must not leak secret VALUES in technicalDetails while preserving KEYS', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Some error',
      {
        technicalDetails: {
          authorization: 'Bearer sk-secret-XYZ',
          clientSecret: 'abc123',
          safeNumber: 42,
          safeBool: true,
        },
      },
    );

    const serialized = JSON.stringify(error.toLogEntry());

    expect(serialized).not.toContain('sk-secret-XYZ');
    expect(serialized).not.toContain('abc123');

    // Keys are preserved for debuggability
    expect(serialized).toContain('authorization');
    expect(serialized).toContain('clientSecret');

    // Values are redacted
    const entry = error.toLogEntry();
    const details = entry.technicalDetails as Record<string, unknown>;
    expect(details.authorization).toBe('[redacted]');
    expect(details.clientSecret).toBe('[redacted]');
  });

  it('must not leak secrets in originalError.message or originalError.stack', () => {
    const originalError = new Error('Request failed with token=abc in body');
    originalError.stack = [
      'Error: Request failed with token=abc in body',
      '    at /Users/secret/path/token=abc/service.ts:42:5',
      '    at Object.<anonymous> (/app/index.ts:10:1)',
    ].join('\n');

    const error = new OAuthError(
      OAuthErrorType.STORAGE_ERROR,
      'test-provider',
      'Storage failed',
      { originalError },
    );

    const serialized = JSON.stringify(error.toLogEntry());

    expect(serialized).not.toContain('token=abc');
    expect(serialized).not.toContain('/Users/secret/path');

    const entry = error.toLogEntry();
    const orig = entry.originalError as Record<string, unknown>;
    // name is safe (structural), keep it
    expect(orig.name).toBe('Error');
    // message and stack must be redacted
    expect(orig.message).toBe('[redacted]');
    expect(orig.stack).toBe('[redacted]');
  });

  it('must not leak secrets in the top-level stack field', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
    );

    const entry = error.toLogEntry();

    expect(entry.stack).toBe('[redacted]');
    const serialized = JSON.stringify(entry);
    // The raw stack (which contains file paths etc.) must not appear
    expect(error.stack).toBeDefined();
    expect(serialized).not.toContain(error.stack);
  });

  it('must preserve non-sensitive structured classification fields', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
      {
        retryAfterMs: 1000,
        technicalDetails: { timeout: 5000 },
      },
    );

    const entry = error.toLogEntry();

    // These are all non-sensitive, generated/structured values
    expect(entry.type).toBe(OAuthErrorType.NETWORK_ERROR);
    expect(entry.category).toBe(OAuthErrorCategory.TRANSIENT);
    expect(entry.provider).toBe('test-provider');
    expect(entry.isRetryable).toBe(true);
    expect(entry.retryAfterMs).toBe(1000);
    expect(entry.userMessage).toBe(
      'Unable to connect to Test-provider. Please check your internet connection.',
    );
    expect(entry.actionRequired).toBe(
      'Check your internet connection and try again.',
    );
  });

  it('must handle null originalError gracefully', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
    );

    const entry = error.toLogEntry();

    expect(entry.originalError).toBeNull();
  });

  it('must handle empty technicalDetails gracefully', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
    );

    const entry = error.toLogEntry();

    // Empty object — no keys to preserve, still returns an object
    expect(entry.technicalDetails).toStrictEqual({});
  });

  it('must redact nested object values inside technicalDetails', () => {
    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Network failed',
      {
        technicalDetails: {
          headers: { Authorization: 'Bearer secret-nested-token' },
          safeKey: 'unsafe-value',
        },
      },
    );

    const serialized = JSON.stringify(error.toLogEntry());

    expect(serialized).not.toContain('secret-nested-token');
    expect(serialized).not.toContain('unsafe-value');
    // The top-level keys are preserved
    expect(serialized).toContain('headers');
    expect(serialized).toContain('safeKey');
  });
});

/**
 * Tests that the RetryHandler line-553 debug log uses a sanitized numeric
 * delay rather than directly embedding the tainted `delay` value from
 * `oauthError.retryAfterMs`.
 *
 * Addresses CodeQL alert 154.
 */
describe('RetryHandler sanitized delay logging', () => {
  it('must log a finite numeric delay, not a direct tainted property read', async () => {
    const captured: string[] = [];
    const fakeLogger: OAuthLogger = {
      debug: (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      },
      error: () => {},
    };

    const handler = new RetryHandler(
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        backoffMultiplier: 2,
        maxDelayMs: 1000,
        jitter: false,
      },
      fakeLogger,
    );

    let attempt = 0;
    const operation = async (): Promise<string> => {
      attempt++;
      if (attempt < 2) {
        // retryAfterMs comes from untrusted provider input (tainted source)
        throw new OAuthError(
          OAuthErrorType.NETWORK_ERROR,
          'test-provider',
          'Network failed',
          { retryAfterMs: 250 },
        );
      }
      return 'success';
    };

    // Use fake timers to avoid actual sleep delay
    vi.useFakeTimers();
    try {
      const promise = handler.executeWithRetry(operation, 'test-provider');
      await vi.advanceTimersByTimeAsync(300);
      const result = await promise;

      expect(result).toBe('success');
      expect(captured.length).toBeGreaterThanOrEqual(1);

      // The debug message must match the sanitized numeric pattern
      expect(captured[0]).toMatch(/retrying in \d+ms/);
      // Must NOT contain any non-numeric or sensitive artifact in the delay position
      expect(captured[0]).not.toMatch(/retrying in NaN/);
      expect(captured[0]).not.toMatch(/retrying in undefined/);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Integration: confirm that GracefulErrorHandler.wrapMethod and
 * handleGracefully pass sanitized entries to the logger (no secrets).
 *
 * Addresses CodeQL alerts 155 and 158.
 */
describe('GracefulErrorHandler sanitized log entry propagation', () => {
  it('handleGracefully must not leak secrets via toLogEntry to the logger', async () => {
    const capturedDebug: unknown[][] = [];
    const fakeLogger: OAuthLogger = {
      debug: (...args: unknown[]) => {
        capturedDebug.push(args);
      },
      error: () => {},
    };

    // Use a retry handler with 1 max attempt so it fails fast
    const retryHandler = new RetryHandler(
      {
        maxAttempts: 1,
        baseDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
        jitter: false,
      },
      fakeLogger,
    );

    const { GracefulErrorHandler } = await import('../oauth-errors.js');
    const handler = new GracefulErrorHandler(retryHandler, fakeLogger);

    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Bearer sk-leak-handle-secret',
      {
        technicalDetails: {
          authorization: 'Bearer sk-leak-handle-secret',
        },
      },
    );

    const operation = async (): Promise<string> => {
      throw error;
    };

    const result = await handler.handleGracefully(
      operation,
      'fallback',
      'test-provider',
    );

    expect(result).toBe('fallback');
    expect(capturedDebug.length).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(capturedDebug);
    expect(serialized).not.toContain('sk-leak-handle-secret');
  });

  it('wrapMethod must not leak secrets via toLogEntry to the logger', async () => {
    const capturedDebug: unknown[][] = [];
    const fakeLogger: OAuthLogger = {
      debug: (...args: unknown[]) => {
        capturedDebug.push(args);
      },
      error: () => {},
    };

    const retryHandler = new RetryHandler(
      {
        maxAttempts: 1,
        baseDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
        jitter: false,
      },
      fakeLogger,
    );

    const { GracefulErrorHandler } = await import('../oauth-errors.js');
    const handler = new GracefulErrorHandler(retryHandler, fakeLogger);

    const error = new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      'test-provider',
      'Bearer sk-leak-wrap-secret',
      {
        technicalDetails: {
          secret: 'sk-leak-wrap-secret',
        },
      },
    );

    const method = async (): Promise<string> => {
      throw error;
    };

    const wrapped = handler.wrapMethod(
      method,
      'test-provider',
      'testMethod',
      'fallback-value',
    );

    const result = await wrapped();

    expect(result).toBe('fallback-value');
    expect(capturedDebug.length).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(capturedDebug);
    expect(serialized).not.toContain('sk-leak-wrap-secret');
  });
});
