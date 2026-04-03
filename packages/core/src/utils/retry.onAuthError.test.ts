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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

    await Promise.all([
      expect(promise).rejects.toThrow('Unauthorized'),
      vi.runAllTimersAsync(),
    ]);

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

    await Promise.all([
      expect(promise).rejects.toThrow('Forbidden'),
      vi.runAllTimersAsync(),
    ]);

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

    await Promise.all([
      expect(promise).rejects.toThrow('Rate limit'),
      vi.runAllTimersAsync(),
    ]);

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

    await Promise.all([
      expect(promise).rejects.toThrow('Server error'),
      vi.runAllTimersAsync(),
    ]);

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

    await Promise.all([
      expect(promise).rejects.toThrow('Unauthorized'),
      vi.runAllTimersAsync(),
    ]);

    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
