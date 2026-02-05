/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@google/genai';
import type { HttpError } from './retry.js';
import { retryWithBackoff } from './retry.js';
import { setSimulate429 } from './testUtils.js';

// Helper to create a mock function that fails a certain number of times
const createFailingFunction = (
  failures: number,
  successValue: string = 'success',
) => {
  let attempts = 0;
  return vi.fn(async () => {
    attempts++;
    if (attempts <= failures) {
      // Simulate a retryable error
      const error: HttpError = new Error(`Simulated error attempt ${attempts}`);
      error.status = 500; // Simulate a server error
      throw error;
    }
    return successValue;
  });
};

// Custom error for testing non-retryable conditions
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Disable 429 simulation for tests
    setSimulate429(false);
    // Suppress unhandled promise rejection warnings for tests that expect errors
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should return the result on the first attempt if successful', async () => {
    const mockFn = createFailingFunction(0);
    const result = await retryWithBackoff(mockFn);
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed if failures are within maxAttempts', async () => {
    const mockFn = createFailingFunction(2);
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    await vi.runAllTimersAsync(); // Ensure all delays and retries complete

    const result = await promise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw an error if all attempts fail', async () => {
    const mockFn = createFailingFunction(3);

    // 1. Start the retryable operation, which returns a promise.
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    // 2. Run timers and await expectation in parallel.
    await Promise.all([
      expect(promise).rejects.toThrow('Simulated error attempt 3'),
      vi.runAllTimersAsync(),
    ]);

    // 3. Finally, assert the number of calls.
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should default to 5 maxAttempts if no options are provided', async () => {
    // This function will fail more than 5 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn);

    // Expect it to fail with the error from the 5th attempt.
    await Promise.all([
      expect(promise).rejects.toThrow('Simulated error attempt 5'),
      vi.runAllTimersAsync(),
    ]);

    expect(mockFn).toHaveBeenCalledTimes(5);
  });

  it('should default to 5 maxAttempts if options.maxAttempts is undefined', async () => {
    // This function will fail more than 5 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn, { maxAttempts: undefined });

    // Expect it to fail with the error from the 5th attempt.
    await Promise.all([
      expect(promise).rejects.toThrow('Simulated error attempt 5'),
      vi.runAllTimersAsync(),
    ]);

    expect(mockFn).toHaveBeenCalledTimes(5);
  });

  it('should not retry if shouldRetry returns false', async () => {
    const mockFn = vi.fn(async () => {
      throw new NonRetryableError('Non-retryable error');
    });
    const shouldRetryOnError = (error: Error) =>
      !(error instanceof NonRetryableError);

    const promise = retryWithBackoff(mockFn, {
      shouldRetryOnError,
      initialDelayMs: 10,
    });

    await expect(promise).rejects.toThrow('Non-retryable error');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if maxAttempts is not a positive number', async () => {
    const mockFn = createFailingFunction(1);

    // Test with 0
    await expect(retryWithBackoff(mockFn, { maxAttempts: 0 })).rejects.toThrow(
      'maxAttempts must be a positive number.',
    );

    // The function should not be called at all if validation fails
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should use default shouldRetry if not provided, retrying on ApiError 429', async () => {
    const mockFn = vi.fn(async () => {
      throw new ApiError({ message: 'Too Many Requests', status: 429 });
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    await Promise.all([
      expect(promise).rejects.toThrow('Too Many Requests'),
      vi.runAllTimersAsync(),
    ]);

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should use default shouldRetry if not provided, not retrying on ApiError 400', async () => {
    const mockFn = vi.fn(async () => {
      throw new ApiError({ message: 'Bad Request', status: 400 });
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });
    await expect(promise).rejects.toThrow('Bad Request');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should use default shouldRetry if not provided, retrying on generic error with status 429', async () => {
    const mockFn = vi.fn(async () => {
      const error = Object.assign(new Error('Too Many Requests'), {
        status: 429,
      });
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    // Run timers and await expectation in parallel.
    await Promise.all([
      expect(promise).rejects.toThrow('Too Many Requests'),
      vi.runAllTimersAsync(),
    ]);

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should use default shouldRetry if not provided, not retrying on generic error with status 400', async () => {
    const mockFn = vi.fn(async () => {
      const error = Object.assign(new Error('Bad Request'), { status: 400 });
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });
    await expect(promise).rejects.toThrow('Bad Request');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxDelayMs', async () => {
    const mockFn = createFailingFunction(3);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 250, // Max delay is less than 100 * 2 * 2 = 400
    });

    await vi.advanceTimersByTimeAsync(1000); // Advance well past all delays
    await promise;

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);

    // Delays should be around initial, initial*2, maxDelay (due to cap)
    // Jitter makes exact assertion hard, so we check ranges / caps
    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(100 * 0.7);
    expect(delays[0]).toBeLessThanOrEqual(100 * 1.3);
    expect(delays[1]).toBeGreaterThanOrEqual(200 * 0.7);
    expect(delays[1]).toBeLessThanOrEqual(200 * 1.3);
    // The third delay should be capped by maxDelayMs (250ms), accounting for jitter
    expect(delays[2]).toBeGreaterThanOrEqual(250 * 0.7);
    expect(delays[2]).toBeLessThanOrEqual(250 * 1.3);
  });

  it('should handle jitter correctly, ensuring varied delays', async () => {
    let mockFn = createFailingFunction(5);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // Run retryWithBackoff multiple times to observe jitter
    const runRetry = () =>
      retryWithBackoff(mockFn, {
        maxAttempts: 2, // Only one retry, so one delay
        initialDelayMs: 100,
        maxDelayMs: 1000,
      });

    // We expect rejections as mockFn fails 5 times
    const promise1 = runRetry();
    // Run timers and await expectation in parallel.
    await Promise.all([
      expect(promise1).rejects.toThrow(),
      vi.runAllTimersAsync(),
    ]);

    const firstDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );
    setTimeoutSpy.mockClear(); // Clear calls for the next run

    // Reset mockFn to reset its internal attempt counter for the next run
    mockFn = createFailingFunction(5); // Re-initialize with 5 failures

    const promise2 = runRetry();
    // Run timers and await expectation in parallel.
    await Promise.all([
      expect(promise2).rejects.toThrow(),
      vi.runAllTimersAsync(),
    ]);

    const secondDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );

    // Check that the delays are not exactly the same due to jitter
    // This is a probabilistic test, but with +/-30% jitter, it's highly likely they differ.
    // Verify delays were captured
    expect(firstDelaySet.length).toBeGreaterThan(0);
    expect(secondDelaySet.length).toBeGreaterThan(0);
    // Check the first delay of each set
    expect(firstDelaySet[0]).not.toBe(secondDelaySet[0]);

    // Ensure delays are within the expected jitter range [70, 130] for initialDelayMs = 100
    [...firstDelaySet, ...secondDelaySet].forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(100 * 0.7);
      expect(d).toBeLessThanOrEqual(100 * 1.3);
    });
  });

  describe('network transient errors', () => {
    it('should retry on undici "terminated" error', async () => {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          // Simulate undici termination error
          const error = new TypeError('terminated');
          throw error;
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should retry on connection terminated error', async () => {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('connection terminated');
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should retry on ECONNRESET error code', async () => {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          const error = Object.assign(new Error('socket hang up'), {
            code: 'ECONNRESET',
          });
          throw error;
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should retry on fetch failed error', async () => {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('fetch failed');
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should retry on "fetch failed sending request" error', async () => {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error(
            'exception TypeError: fetch failed sending request body',
          );
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-transient errors', async () => {
      const mockFn = vi.fn(async () => {
        throw new Error('Some non-transient error');
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      await expect(promise).rejects.toThrow('Some non-transient error');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  // Skipped: llxprt doesn't have automatic model fallback (multi-provider design)
  describe.skip('Flash model fallback for OAuth users', () => {
    it('should trigger fallback for OAuth personal users after persistent 429 errors', async () => {
      const fallbackCallback = vi.fn().mockResolvedValue('gemini-2.5-flash');

      let fallbackOccurred = false;
      const mockFn = vi.fn().mockImplementation(async () => {
        if (!fallbackOccurred) {
          const error: HttpError = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: async () => {
          fallbackOccurred = true;
          return await fallbackCallback();
        },
      });

      // Advance all timers to complete retries
      await vi.runAllTimersAsync();

      // Should succeed after fallback
      await expect(promise).resolves.toBe('success');

      // Verify callback was called with correct auth type
      expect(fallbackCallback).toHaveBeenCalled();

      // Should retry again after fallback
      expect(mockFn).toHaveBeenCalledTimes(3); // 2 initial attempts + 1 after fallback
    });

    it('should NOT trigger fallback for API key users', async () => {
      const fallbackCallback = vi.fn();

      const mockFn = vi.fn(async () => {
        const error: HttpError = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: fallbackCallback,
      });

      // Handle the promise properly to avoid unhandled rejections
      const resultPromise = promise.catch((error) => error);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Should fail after all retries without fallback
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Rate limit exceeded');

      // Callback should not be called for API key users
      expect(fallbackCallback).not.toHaveBeenCalled();
    });

    it('should reset attempt counter and continue after successful fallback', async () => {
      let fallbackCalled = false;
      const fallbackCallback = vi.fn().mockImplementation(async () => {
        fallbackCalled = true;
        return 'gemini-2.5-flash';
      });

      const mockFn = vi.fn().mockImplementation(async () => {
        if (!fallbackCalled) {
          const error: HttpError = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
        return 'success';
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: fallbackCallback,
      });

      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');
      expect(fallbackCallback).toHaveBeenCalledOnce();
    });

    it('should continue with original error if fallback is rejected', async () => {
      const fallbackCallback = vi.fn().mockResolvedValue(null); // User rejected fallback

      const mockFn = vi.fn(async () => {
        const error: HttpError = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: fallbackCallback,
      });

      // Handle the promise properly to avoid unhandled rejections
      const resultPromise = promise.catch((error) => error);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Should fail with original error when fallback is rejected
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Rate limit exceeded');
      expect(fallbackCallback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle mixed error types (only count consecutive 429s)', async () => {
      const fallbackCallback = vi.fn().mockResolvedValue('gemini-2.5-flash');
      let attempts = 0;
      let fallbackOccurred = false;

      const mockFn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (fallbackOccurred) {
          return 'success';
        }
        if (attempts === 1) {
          // First attempt: 500 error (resets consecutive count)
          const error: HttpError = new Error('Server error');
          error.status = 500;
          throw error;
        } else {
          // Remaining attempts: 429 errors
          const error: HttpError = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        onPersistent429: async () => {
          fallbackOccurred = true;
          return await fallbackCallback();
        },
      });

      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should trigger fallback after 2 consecutive 429s (attempts 2-3)
      expect(fallbackCallback).toHaveBeenCalled();
    });
  });

  describe('bucket failover integration', () => {
    /**
     * @requirement PLAN-20251213issue490 Bucket failover
     * @scenario Bucket failover on 429 errors
     * @given A request that consistently returns 429 for first bucket
     * @when onPersistent429 callback returns true (switch succeeded)
     * @then Retry should continue with new bucket
     */
    it('should call onPersistent429 callback on first 429 error', async () => {
      vi.useFakeTimers();
      let attempt = 0;
      let failoverCalled = false;

      const mockFn = vi.fn(async () => {
        attempt++;
        if (attempt <= 1) {
          const error: HttpError = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => {
        failoverCalled = true;
        return true; // Indicate bucket switch succeeded
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 1,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');

      // onPersistent429 should be called after the first 429 error
      expect(failoverCallback).toHaveBeenCalled();
      expect(failoverCalled).toBe(true);
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    /**
     * @requirement issue1081 - Anthropic overloaded_error bucket failover
     * @scenario Bucket failover on Anthropic overloaded_error
     * @given A request that returns Anthropic overloaded_error (no HTTP status)
     * @when onPersistent429 callback returns true (switch succeeded)
     * @then Retry should continue with new bucket
     */
    it('should call onPersistent429 callback on Anthropic overloaded_error', async () => {
      vi.useFakeTimers();
      let attempt = 0;
      let failoverCalled = false;

      const mockFn = vi.fn(async () => {
        attempt++;
        if (attempt <= 1) {
          // Simulate Anthropic's overloaded_error response structure
          const error: HttpError & {
            error?: { type?: string; message?: string };
          } = new Error('Overloaded');
          error.error = {
            type: 'overloaded_error',
            message: 'Overloaded',
          };
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => {
        failoverCalled = true;
        return true; // Indicate bucket switch succeeded
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 1,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');

      // onPersistent429 should be called after the first overloaded_error
      expect(failoverCallback).toHaveBeenCalled();
      expect(failoverCalled).toBe(true);
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    /**
     * @requirement PLAN-20251213issue490 Bucket failover
     * @scenario Bucket failover on 402 errors
     * @given A request that returns 402 for first bucket
     * @when onPersistent429 callback returns true (switch succeeded)
     * @then Retry should continue with new bucket
     */
    it('should call onPersistent429 callback on first 402 error', async () => {
      vi.useFakeTimers();
      let attempt = 0;

      const mockFn = vi.fn(async () => {
        attempt++;
        if (attempt === 1) {
          const error: HttpError = new Error('Payment Required');
          error.status = 402;
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => true);

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 1,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');
      expect(failoverCallback).toHaveBeenCalledWith(expect.any(Error));
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    /**
     * @requirement PLAN-20251213issue490 Bucket failover
     * @scenario Bucket failover on 401 errors
     * @given A request that returns 401 for first bucket
     * @when onPersistent429 callback returns true (switch succeeded)
     * @then Retry should continue with new bucket after refresh retry
     */
    it('should retry once on 401 before bucket failover', async () => {
      vi.useFakeTimers();
      let failoverCalled = false;

      const mockFn = vi.fn(async () => {
        if (!failoverCalled) {
          const error: HttpError = new Error('Unauthorized');
          error.status = 401;
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => {
        failoverCalled = true;
        return true;
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');
      expect(failoverCallback).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    /**
     * @requirement PLAN-20251213issue490 Bucket failover
     * @scenario All buckets exhausted
     * @given A request that returns 429 and all bucket switches fail
     * @when onPersistent429 callback returns false (no more buckets)
     * @then Should throw error after exhausting retries
     */
    it('should throw when onPersistent429 returns false (no more buckets)', async () => {
      vi.useFakeTimers();

      const mockFn = vi.fn(async () => {
        const error: HttpError = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      });

      const failoverCallback = vi.fn(async () => false); // No more buckets available

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      // Properly handle the rejection
      const resultPromise = promise.catch((error) => error);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Rate limit exceeded');
      expect(failoverCallback).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    /**
     * @requirement issue1081 - Anthropic overloaded_error consecutive tracking
     * @scenario Consecutive overloaded_error tracking for bucket failover
     * @given A request that returns multiple Anthropic overloaded_error responses
     * @when onPersistent429 callback is configured
     * @then Should track consecutive overloaded_errors like 429s
     */
    it('should track consecutive overloaded_errors for bucket failover', async () => {
      vi.useFakeTimers();
      let failoverCalled = false;

      const mockFn = vi.fn(async () => {
        if (!failoverCalled) {
          // Simulate Anthropic's overloaded_error response structure
          const error: HttpError & {
            error?: { type?: string; message?: string };
          } = new Error('Overloaded');
          error.error = {
            type: 'overloaded_error',
            message: 'Overloaded',
          };
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => {
        failoverCalled = true;
        return true;
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');

      // onPersistent429 should be called after the first overloaded_error
      expect(failoverCallback).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
    /**
     * @requirement issue1123 - Handle 403 permission_error (revoked token)
     * @scenario Bucket failover on 403 OAuth token revoked
     * @given A request that returns 403 with "OAuth token has been revoked"
     * @when onPersistent429 callback is configured
     * @then Should retry once to allow refresh, then failover on second 403
     */
    it('should retry once on 403 before bucket failover (OAuth token revoked)', async () => {
      vi.useFakeTimers();
      let failoverCalled = false;

      const mockFn = vi.fn(async () => {
        if (!failoverCalled) {
          const error: HttpError = new Error(
            'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"OAuth token has been revoked. Please obtain a new token."}}',
          );
          error.status = 403;
          throw error;
        }
        return 'success after bucket switch';
      });

      const failoverCallback = vi.fn(async () => {
        failoverCalled = true;
        return true;
      });

      const promise = retryWithBackoff(mockFn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        onPersistent429: failoverCallback,
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('success after bucket switch');
      expect(failoverCallback).toHaveBeenCalledTimes(1);
      // Should retry once for refresh attempt, then failover, then succeed
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });

  it('should abort the retry loop when the signal is aborted', async () => {
    const abortController = new AbortController();
    const mockFn = vi.fn().mockImplementation(async () => {
      const error: HttpError = new Error('Server error');
      error.status = 500;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 100,
      signal: abortController.signal,
    });
    await vi.advanceTimersByTimeAsync(50);
    abortController.abort();

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
