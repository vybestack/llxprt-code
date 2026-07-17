/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getErrorStatus,
  isNetworkTransientError,
  isOverloadError,
  isRetryableError,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { isStreamTimeoutError } from './providerErrorObservation.js';

/**
 * Determines if an error should trigger a retry.
 */
export function shouldRetryError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { failures?: unknown }).failures) &&
    typeof (error as { isRetryable?: unknown }).isRetryable === 'boolean'
  ) {
    return isRetryableError(error);
  }
  const status = getErrorStatus(error);

  if (status === 400 || status === 404) {
    return false;
  }
  if (status === 429 || isOverloadError(error)) {
    return true;
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return true;
  }
  if (isNetworkTransientError(error)) {
    return true;
  }
  if (status === 401 || status === 403) {
    return true;
  }
  return isStreamTimeoutError(error);
}

/** Maximum allowable Retry-After delay (5 minutes) to prevent stalling. */
const MAX_RETRY_AFTER_MS = 300_000;

/**
 * Gets the delay duration for a retry, respecting Retry-After header.
 * The Retry-After value is capped at MAX_RETRY_AFTER_MS to prevent an
 * unbounded sleep from a misbehaving server.
 */
export function getDelayDuration(error: unknown, defaultDelay: number): number {
  const retryAfterMs = getRetryAfterDelayMs(error);
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  const jitter = defaultDelay * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, defaultDelay + jitter);
}

/**
 * Extracts Retry-After delay from error headers.
 */
export function getRetryAfterDelayMs(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as {
      response?: { headers?: { 'retry-after'?: unknown } };
    };

    const retryAfter = errorObj.response?.headers?.['retry-after'];
    if (typeof retryAfter === 'string' && retryAfter !== '') {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }
  }
  return 0;
}

/**
 * Checks if error has a Retry-After header.
 */
export function hasRetryAfterHeader(error: unknown): boolean {
  return getRetryAfterDelayMs(error) > 0;
}

/**
 * Resolve a human-readable reason for a bucket failover attempt.
 */
export function resolveFailoverReason(
  is429: boolean,
  isNetworkError: boolean,
  consecutive429s: number,
  consecutiveNetworkErrors: number,
  errorStatus: number | undefined,
): string {
  if (is429) {
    return `${consecutive429s} consecutive 429 errors`;
  }
  if (isNetworkError) {
    return `${consecutiveNetworkErrors} consecutive network errors`;
  }
  return `status ${errorStatus}`;
}
