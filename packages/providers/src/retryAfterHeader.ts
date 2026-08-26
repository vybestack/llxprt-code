/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retry-After header extraction and normalization.
 *
 * Lives apart from retryDelayPolicy so the failure taxonomy (which needs the
 * normalized delay for RetryFailure.retryAfterMs) and the retry policy
 * (which needs the taxonomy for eligibility) can depend on the header
 * helpers without forming an import cycle.
 */

/** Maximum allowable Retry-After delay (5 minutes) to prevent stalling. */
const MAX_RETRY_AFTER_MS = 300_000;

/**
 * Gets the delay duration for a retry, respecting Retry-After header.
 * The Retry-After value is capped at MAX_RETRY_AFTER_MS to prevent an
 * unbounded sleep from a misbehaving server.
 */
export function getDelayDuration(
  error: unknown,
  defaultDelay: number,
): number {
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
