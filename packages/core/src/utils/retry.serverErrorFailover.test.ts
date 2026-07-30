/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0 */

import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from './retry.js';

interface HttpError extends Error {
  status?: number;
}

describe('retryWithBackoff - server error failover (issue #1726)', () => {
  it('should call onPersistent429 callback on persistent HTTP 5xx errors', async () => {
    vi.useFakeTimers();
    let attempt = 0;

    const mockFn = vi.fn(async () => {
      attempt++;
      if (attempt <= 1) {
        const error: HttpError = new Error('Internal server error');
        error.status = 500;
        throw error;
      }
      return 'success after bucket switch';
    });

    const failoverCallback = vi.fn(async () => true);

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 100,
      onPersistent429: failoverCallback,
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('success after bucket switch');
    expect(failoverCallback).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should call onPersistent429 callback on persistent Anthropic api_error', async () => {
    vi.useFakeTimers();
    let attempt = 0;

    const mockFn = vi.fn(async () => {
      attempt++;
      if (attempt <= 1) {
        const error: HttpError & {
          error?: { type?: string; error?: { type?: string } };
        } = new Error('Internal server error');
        error.status = undefined;
        error.error = {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Internal server error',
          },
        };
        throw error;
      }
      return 'success after bucket switch';
    });

    const failoverCallback = vi.fn(async () => true);

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 5,
      initialDelayMs: 100,
      onPersistent429: failoverCallback,
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('success after bucket switch');
    // api_error is caught by isOverloadError, treated as overload, and
    // triggers failover through the 429/overload threshold path.
    expect(failoverCallback).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
