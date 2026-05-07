/* eslint-disable no-console */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Retry error classification, abort handling, and RetryableQuotaError tests.
 * Split from retry.test.ts for max-lines compliance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@google/genai';
import { retryWithBackoff, isRetryableError } from './retry.js';
import { setSimulate429 } from './testUtils.js';
import { RetryableQuotaError } from './googleQuotaErrors.js';
import type { GoogleApiError } from './googleErrors.js';
import { DebugLogger } from '../debug/index.js';

/**
 * @plan PLAN-20250219-GMERGE021.R13.P02
 * @requirement REQ-R13-003 Unit tests for retry precedence
 */
describe('isRetryableError', () => {
  it('should retry network error code regardless of retryFetchErrors=false', () => {
    const error = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
    });
    expect(isRetryableError(error, false)).toBe(true);
  });

  it('should retry network error code regardless of retryFetchErrors=true', () => {
    const error = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
    });
    expect(isRetryableError(error, true)).toBe(true);
  });

  it('should retry network error code in nested .cause chain', () => {
    const innerError = Object.assign(new Error('Socket hang up'), {
      code: 'ECONNRESET',
    });
    const outerError = new Error('Fetch failed', { cause: innerError });
    expect(isRetryableError(outerError, false)).toBe(true);
  });

  it('should NOT retry generic "fetch failed" when retryFetchErrors=false', () => {
    const error = new Error('fetch failed');
    expect(isRetryableError(error, false)).toBe(false);
  });

  it('should retry generic "fetch failed" when retryFetchErrors=true', () => {
    const error = new Error('fetch failed');
    expect(isRetryableError(error, true)).toBe(true);
  });

  it('should never retry 400 ApiError', () => {
    const error = new ApiError({ message: 'Bad Request', status: 400 });
    expect(isRetryableError(error, false)).toBe(false);
    expect(isRetryableError(error, true)).toBe(false);
  });

  it('should retry 503 ApiError', () => {
    const error = new ApiError({ message: 'Service Unavailable', status: 503 });
    expect(isRetryableError(error, false)).toBe(true);
    expect(isRetryableError(error, true)).toBe(true);
  });

  it('should retry 429 ApiError', () => {
    const error = new ApiError({ message: 'Too Many Requests', status: 429 });
    expect(isRetryableError(error, false)).toBe(true);
    expect(isRetryableError(error, true)).toBe(true);
  });

  it('should retry 503 generic error with status property', () => {
    const error = Object.assign(new Error('Service Unavailable'), {
      status: 503,
    });
    expect(isRetryableError(error, false)).toBe(true);
  });

  it('should retry network error with ECONNRESET code', () => {
    const error = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    expect(isRetryableError(error, false)).toBe(true);
  });

  it('should retry network error with UND_ERR_SOCKET code', () => {
    const error = Object.assign(new Error('undici socket error'), {
      code: 'UND_ERR_SOCKET',
    });
    expect(isRetryableError(error, false)).toBe(true);
  });

  it('should NOT retry non-network, non-HTTP errors', () => {
    const error = new Error('Some random error');
    expect(isRetryableError(error, false)).toBe(false);
    expect(isRetryableError(error, true)).toBe(false);
  });

  it('should prioritize network codes over retryFetchErrors gate', () => {
    // Create an error that has both a network code AND "fetch failed" message
    // Network code should win (always retry), even if retryFetchErrors=false
    const error = Object.assign(new Error('fetch failed due to ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    expect(isRetryableError(error, false)).toBe(true);
  });

  it('ENOTFOUND is retryable', () => {
    const error = Object.assign(
      new Error('getaddrinfo ENOTFOUND example.com'),
      {
        code: 'ENOTFOUND',
      },
    );
    expect(isRetryableError(error, false)).toBe(true);
    expect(isRetryableError(error, true)).toBe(true);
  });
});

describe('retryWithBackoff abort handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    console.warn = vi.fn();
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

    let attemptCount = 0;
    const delays: number[] = [];

    // Mock delay to capture actual delay values and advance time
    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      delays.push(ms);
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const mockFn = vi.fn(async () => {
      attemptCount++;
      if (attemptCount <= 3) {
        // Create RetryableQuotaError with undefined retryDelayMs
        throw new RetryableQuotaError(
          'Quota exceeded',
          mockGoogleApiError,
          undefined, // undefined retryDelaySeconds
        );
      }
      return 'success';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    // Wait for all timers to complete
    await vi.runAllTimersAsync();
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

    let attemptCount = 0;
    const delays: number[] = [];

    const delayModule = await import('./delay.js');
    vi.spyOn(delayModule, 'delay').mockImplementation(async (ms: number) => {
      delays.push(ms);
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });

    const mockFn = vi.fn(async () => {
      attemptCount++;
      if (attemptCount <= 2) {
        // Create RetryableQuotaError with explicit retryDelayMs=10000 (10 seconds)
        throw new RetryableQuotaError(
          'Quota exceeded',
          mockGoogleApiError,
          10, // 10 seconds
        );
      }
      return 'success';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    await vi.runAllTimersAsync();
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

    await vi.runAllTimersAsync();
    const error = await promise;

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(RetryableQuotaError);

    // Verify debugLogger.warn was called with message about max attempts reached
    expect(debugLoggerWarnSpy).toHaveBeenCalledWith(expect.any(Function));

    // Get the actual logged message by calling the function
    const warnCalls = debugLoggerWarnSpy.mock.calls;
    let foundMaxAttemptsMessage = false;
    for (const call of warnCalls) {
      const messageFn = call[0];
      if (typeof messageFn === 'function') {
        const message = messageFn();
        if (
          message.includes('Attempt 2 failed') &&
          message.includes('Max attempts reached')
        ) {
          foundMaxAttemptsMessage = true;
          break;
        }
      }
    }
    expect(foundMaxAttemptsMessage).toBe(true);
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

    let attemptCount = 0;
    const mockFn = vi.fn(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new RetryableQuotaError(
          'Quota with delay',
          mockGoogleApiError,
          10, // 10 seconds
        );
      }
      return 'success';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(mockFn).toHaveBeenCalledTimes(2);

    // Verify debugLogger.warn was called (not console.warn)
    expect(debugLoggerWarnSpy).toHaveBeenCalled();

    // Get the actual logged message - check all warn calls
    const warnCalls = debugLoggerWarnSpy.mock.calls;
    let foundRetryMessage = false;
    for (const call of warnCalls) {
      const messageFn = call[0];
      if (typeof messageFn === 'function') {
        const message = messageFn();
        // Look for the message with attempt number and retry delay
        if (
          message.includes('failed') &&
          message.includes('Retrying after 10000ms')
        ) {
          foundRetryMessage = true;
          break;
        }
      }
    }
    expect(foundRetryMessage).toBe(true);

    // Verify console.warn was NOT called for this specific retry message
    // (console.warn might be called for other reasons, so we check it wasn't called with our specific message)
    const consoleWarnCalls = consoleWarnSpy.mock.calls;
    let foundConsoleWarnRetryMessage = false;
    for (const call of consoleWarnCalls) {
      const message = String(call[0] ?? '');
      if (message.includes('Retrying after 10000ms')) {
        foundConsoleWarnRetryMessage = true;
        break;
      }
    }
    expect(foundConsoleWarnRetryMessage).toBe(false);
  });
});
