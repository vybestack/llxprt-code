/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * retryWithBackoff onAuthError integration tests
 *
 * These behavioral tests verify that retryWithBackoff:
 * 1. Calls onAuthError callback on 401/403 errors before retry
 * 2. Continues retry logic after onAuthError completes
 * 3. Passes errorStatus to the callback
 */

import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { retryWithBackoff, type HttpError } from './retry.js';
import { setSimulate429 } from './testUtils.js';

describe('retryWithBackoff onAuthError callback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * @fix issue1861
   * Test that onAuthError is called on 401 error before retry
   */
  it('should call onAuthError callback on 401 error before retry', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Unauthorized');
      error.status = 401;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Unauthorized');

    // onAuthError should have been called for the 401
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockOnAuthError).toHaveBeenCalledWith({
      errorStatus: 401,
    });
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue1861
   * Test that onAuthError is called on 403 error before retry
   */
  it('should call onAuthError callback on 403 error before retry', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Forbidden');
      error.status = 403;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Forbidden');

    // onAuthError should have been called for the 403
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockOnAuthError).toHaveBeenCalledWith({
      errorStatus: 403,
    });
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue1861
   * Test that onAuthError is NOT called for non-auth errors
   */
  it('should NOT call onAuthError callback for 429 errors', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Rate limit');
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Rate limit');

    expect(mockOnAuthError).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that onAuthError is NOT called for 500 errors
   */
  it('should NOT call onAuthError callback for 500 errors', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Server error');
      error.status = 500;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Server error');

    expect(mockOnAuthError).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that retry continues even if onAuthError fails
   */
  it('should continue retry if onAuthError throws', async () => {
    const mockOnAuthError = vi
      .fn()
      .mockRejectedValue(new Error('Handler failed'));

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Unauthorized');
      error.status = 401;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Unauthorized');

    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue2917
   * A 403 with only onAuthError (no onPersistent429) must still get the single
   * auth-refresh retry. This pins the intent explicitly: once 403 is no longer
   * blindly retryable by status, the refresh allowance must be driven by the
   * presence of an auth-recovery handler. Without the canRecoverFromAuthError
   * gate this would regress to a single call with no onAuthError invocation.
   */
  it('retries a 403 exactly once when only onAuthError is supplied (issue #2917)', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);

    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Forbidden');
      error.status = 403;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 6,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Forbidden');

    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue2917
   * A 403 with no auth-recovery handler at all must not burn the backoff budget:
   * it is a terminal configuration/authorization problem, so retrying only
   * delays the error. Today this retries up to maxAttempts.
   */
  it('does not backoff-retry a 403 when no auth-recovery handler is configured (issue #2917)', async () => {
    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Forbidden');
      error.status = 403;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 6,
      initialDelayMs: 10,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Forbidden');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  /**
   * @fix issue2917
   * Budget guard for the onAuthError-driven refresh allowance. When the
   * attempt budget is already exhausted (maxAttempts reached on the very first
   * attempt), granting a refresh retry cannot help — there is no attempt left
   * for it to run — yet it would burn a full backoff cycle. The allowance must
   * be gated the same way `invokeAuthErrorCallback` already gates the callback
   * (it skips when `attempt >= maxAttempts`): a 403 at maxAttempts with only
   * onAuthError must call the function exactly once and never invoke the
   * callback.
   *
   * RED before R1(b): the function is called twice (the unconditional
   * onAuthError allowance forces a decrement-and-continue).
   */
  it('does not grant an onAuthError refresh retry when the attempt budget is exhausted (issue #2917)', async () => {
    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Forbidden');
      error.status = 403;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 1,
      initialDelayMs: 10,
      onAuthError: mockOnAuthError,
    });

    promise.catch(() => {});
    await runAllTimersAsync();
    await expect(promise).rejects.toThrow('Forbidden');

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockOnAuthError).not.toHaveBeenCalled();
  });
});
