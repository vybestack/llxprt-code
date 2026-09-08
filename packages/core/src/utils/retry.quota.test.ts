/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Retry error classification, abort handling, and RetryableQuotaError tests.
 * Split from retry.test.ts for max-lines compliance.
 */

import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  retryWithBackoff,
  isRetryableError,
  isNetworkTransientError,
} from './retry.js';
import { setSimulate429 } from './testUtils.js';
import { RetryableQuotaError } from './googleQuotaErrors.js';
import type { GoogleApiError } from './googleErrors.js';
import { DebugLogger } from '../debug/index.js';

/** Structural error carrying an HTTP status (replaces ApiError usage). */
function statusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

/**
 * Builds a mock that throws `errorFactory()` for the first `failures` calls and
 * then returns `successValue`. The error is freshly built on every call.
 */
function rejectingTimes<T>(
  failures: number,
  errorFactory: () => Error,
  successValue: T,
): ReturnType<typeof vi.fn> {
  let attempts = 0;
  return vi.fn(async (): Promise<T> => {
    attempts++;
    if (attempts <= failures) {
      throw errorFactory();
    }
    return successValue;
  });
}

/**
 * Builds a mock that throws a fresh RetryableQuotaError wrapping
 * `googleError` (with the given retryDelaySeconds) for `failures` calls and
 * then returns `successValue`.
 */
function rejectingQuotaTimes(
  failures: number,
  googleError: GoogleApiError,
  message: string,
  retryDelaySeconds: number | undefined,
  successValue: string,
): ReturnType<typeof vi.fn> {
  return rejectingTimes(
    failures,
    () => new RetryableQuotaError(message, googleError, retryDelaySeconds),
    successValue,
  );
}

function hasLazyDebugRetryAfterMessage(
  calls: ReadonlyArray<readonly unknown[]>,
  delayMs: number,
): boolean {
  const delayLabel = `Retrying after ${delayMs}ms`;
  return calls.some((call) => {
    const message = call[0];
    return (
      typeof message === 'function' && String(message()).includes(delayLabel)
    );
  });
}

function hasDirectConsoleRetryAfterMessage(
  calls: ReadonlyArray<readonly unknown[]>,
  delayMs: number,
): boolean {
  const delayLabel = `Retrying after ${delayMs}ms`;
  return calls.some((call) => {
    const message = call[0];
    return typeof message === 'string' && message.includes(delayLabel);
  });
}

/**
 * Searches captured DebugLogger warning calls for a rendered message that reports a
 * failed attempt and the exhaustion of the retry budget.
 */
function hasMaxAttemptsMessage(calls: unknown[][]): boolean {
  return calls.some((call) => {
    const messageFn = call[0];
    if (typeof messageFn === 'function') {
      const message = String(messageFn());
      return (
        message.includes('Attempt 2 failed') &&
        message.includes('Max attempts reached')
      );
    }
    return false;
  });
}

/**
 * @plan PLAN-20250219-GMERGE021.R13.P02
 * @requirement REQ-R13-003 Unit tests for retry precedence
 */
describe('isRetryableError', () => {
  it('should retry network error code (ETIMEDOUT)', () => {
    const error = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry network error code in nested .cause chain', () => {
    const innerError = Object.assign(new Error('Socket hang up'), {
      code: 'ECONNRESET',
    });
    const outerError = new Error('Fetch failed', { cause: innerError });
    expect(isRetryableError(outerError)).toBe(true);
  });

  it('should retry generic "fetch failed" (centralized transient detection)', () => {
    const error = new Error('fetch failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('should never retry 400 error', () => {
    const error = statusError('Bad Request', 400);
    expect(isRetryableError(error)).toBe(false);
  });

  it('should retry 503 error', () => {
    const error = statusError('Service Unavailable', 503);
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry 429 error', () => {
    const error = statusError('Too Many Requests', 429);
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry 503 generic error with status property', () => {
    const error = Object.assign(new Error('Service Unavailable'), {
      status: 503,
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry network error with ECONNRESET code', () => {
    const error = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry network error with UND_ERR_SOCKET code', () => {
    const error = Object.assign(new Error('undici socket error'), {
      code: 'UND_ERR_SOCKET',
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should NOT retry non-network, non-HTTP errors', () => {
    const error = new Error('Some random error');
    expect(isRetryableError(error)).toBe(false);
  });

  it('should retry network codes with "fetch failed" message', () => {
    const error = Object.assign(new Error('fetch failed due to ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    expect(isRetryableError(error)).toBe(true);
  });

  it('ENOTFOUND is retryable', () => {
    const error = Object.assign(
      new Error('getaddrinfo ENOTFOUND example.com'),
      {
        code: 'ENOTFOUND',
      },
    );
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry Windows DOMException TimeoutError (issue #2557)', () => {
    const error = new DOMException('The operation timed out.', 'TimeoutError');
    expect(isRetryableError(error)).toBe(true);
  });
});

describe('isNetworkTransientError', () => {
  it('returns true for a bare TypeError("fetch failed") with no cause', () => {
    const error = new TypeError('fetch failed');
    expect(isNetworkTransientError(error)).toBe(true);
  });

  it('returns true for a TypeError("fetch failed") with an undici cause (UND_ERR_SOCKET)', () => {
    const cause = Object.assign(new Error('Socket error'), {
      code: 'UND_ERR_SOCKET',
    });
    const error = new TypeError('fetch failed', { cause });
    expect(isNetworkTransientError(error)).toBe(true);
  });

  it('returns false for a non-transient error', () => {
    const error = new Error('some random error');
    expect(isNetworkTransientError(error)).toBe(false);
  });

  it('returns true for DOMException TimeoutError "The operation timed out." (Windows API timeout, issue #2557)', () => {
    const error = new DOMException('The operation timed out.', 'TimeoutError');
    expect(isNetworkTransientError(error)).toBe(true);
  });

  it('returns true for a bare Error with the exact Windows timeout message (issue #2557)', () => {
    const error = new Error('The operation timed out.');
    expect(isNetworkTransientError(error)).toBe(true);
  });

  it('returns true for case-insensitive "OPERATION TIMED OUT" message', () => {
    const error = new Error('OPERATION TIMED OUT');
    expect(isNetworkTransientError(error)).toBe(true);
  });

  it('returns false for a non-timeout DOMException (issue #2557 regression guard)', () => {
    const error = new DOMException('invalid syntax', 'SyntaxError');
    expect(isNetworkTransientError(error)).toBe(false);
  });
});

describe('retryWithBackoff abort handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pre-aborted signal does not call fn', async () => {
    const mockFn = vi.fn(async () => 'success');
    const abortController = new AbortController();
    abortController.abort();

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      signal: abortController.signal,
    });

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(mockFn).not.toHaveBeenCalled();
  });
});

describe('RetryableQuotaError with exponential backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should use exponential backoff when RetryableQuotaError has undefined retryDelayMs', async () => {
    const mockGoogleApiError: GoogleApiError = {
      code: 429,
      message: 'Generic quota error',
      details: [],
    };

    const delays: number[] = [];

    const mockFn = rejectingQuotaTimes(
      3,
      mockGoogleApiError,
      'Quota exceeded',
      undefined, // undefined retryDelaySeconds
      'success',
    );

    // Mock delay to capture actual delay values and advance time
    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      delays.push(ms);
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    // Wait for all timers to complete
    await runAllTimersAsync();
    await promise;

    expect(mockFn).toHaveBeenCalledTimes(4);
    expect(delays.length).toBe(3);

    // Verify first retry delay is around 5000ms ±30% (3500-6500ms)
    expect(delays[0]).toBeGreaterThanOrEqual(3500);
    expect(delays[0]).toBeLessThanOrEqual(6500);

    // Verify second retry delay is around 10000ms ±30% (7000-13000ms)
    expect(delays[1]).toBeGreaterThanOrEqual(7000);
    expect(delays[1]).toBeLessThanOrEqual(13000);

    // Verify third retry delay is around 20000ms ±30% (14000-26000ms)
    expect(delays[2]).toBeGreaterThanOrEqual(14000);
    expect(delays[2]).toBeLessThanOrEqual(26000);

    // Verify delays never exceed 30000ms (max cap)
    delays.forEach((delay) => {
      expect(delay).toBeLessThanOrEqual(30000);
    });
  });

  it('should use explicit retryDelayMs when defined, bypassing exponential backoff', async () => {
    const mockGoogleApiError: GoogleApiError = {
      code: 429,
      message: 'Quota with specific delay',
      details: [],
    };

    const delays: number[] = [];

    const mockFn = rejectingQuotaTimes(
      2,
      mockGoogleApiError,
      'Quota exceeded',
      10, // 10 seconds
      'success',
    );

    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      delays.push(ms);
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    await runAllTimersAsync();
    await promise;

    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(delays.length).toBe(2);

    // Verify both delays are exactly 10000ms (no jitter, no exponential growth)
    expect(delays[0]).toBe(10000);
    expect(delays[1]).toBe(10000);
  });

  it('should call debugLogger.warn when max attempts reached with undefined retryDelayMs', async () => {
    const mockGoogleApiError: GoogleApiError = {
      code: 429,
      message: 'Persistent quota error',
      details: [],
    };

    const debugLoggerWarnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const mockFn = vi.fn(async () => {
      throw new RetryableQuotaError(
        'Persistent quota error',
        mockGoogleApiError,
        undefined,
      );
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    }).catch((error) => error); // Expected to throw - catch it to prevent unhandled rejection

    await runAllTimersAsync();
    const error = await promise;

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(RetryableQuotaError);

    // Verify debugLogger.warn was called with message about max attempts reached
    expect(debugLoggerWarnSpy).toHaveBeenCalledWith(expect.any(Function));

    // Get the actual logged message by calling the function
    const warnCalls = debugLoggerWarnSpy.mock.calls;
    expect(hasMaxAttemptsMessage(warnCalls)).toBe(true);
  });

  it('should use debugLogger.warn instead of console.warn for explicit retryDelayMs', async () => {
    const mockGoogleApiError: GoogleApiError = {
      code: 429,
      message: 'Quota with delay',
      details: [],
    };

    const debugLoggerWarnSpy = vi.spyOn(DebugLogger.prototype, 'warn');
    const consoleWarnSpy = vi.spyOn(console, 'warn');

    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const mockFn = rejectingQuotaTimes(
      1,
      mockGoogleApiError,
      'Quota with delay',
      10, // 10 seconds
      'success',
    );

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    await runAllTimersAsync();
    await promise;

    expect(mockFn).toHaveBeenCalledTimes(2);

    // Verify debugLogger.warn was called (not console.warn)
    expect(debugLoggerWarnSpy).toHaveBeenCalled();

    // Get the actual logged message - check all warn calls
    const warnCalls = debugLoggerWarnSpy.mock.calls;
    expect(hasLazyDebugRetryAfterMessage(warnCalls, 10000)).toBe(true);

    // Verify console.warn was NOT called for this specific retry message
    // (console.warn might be called for other reasons, so we check it wasn't called with our specific message)
    const consoleWarnCalls = consoleWarnSpy.mock.calls;
    expect(hasDirectConsoleRetryAfterMessage(consoleWarnCalls, 10000)).toBe(
      false,
    );
  });
});

describe('retryWithBackoff Windows timeout retry (issue #2557)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries a DOMException TimeoutError and succeeds when a later attempt succeeds', async () => {
    const mockFn = rejectingTimes(
      2,
      () => new DOMException('The operation timed out.', 'TimeoutError'),
      'success',
    );

    // Settle the promise into a tagged outcome up front. The fake-timer drain
    // below is what actually runs the retry loop, so a rejection would
    // otherwise surface while the promise still has no handler attached.
    const outcome = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await runAllTimersAsync();

    expect(await outcome).toStrictEqual({ ok: true, value: 'success' });
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('throws the original DOMException when the retry budget is exhausted (issue #2557)', async () => {
    const mockFn = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    }).catch((error) => error);

    await runAllTimersAsync();
    const error = await promise;

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
    expect((error as Error).message).toContain('The operation timed out');
  });
});
