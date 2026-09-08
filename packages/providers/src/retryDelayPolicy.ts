/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  decodeRetryFailure,
  isRetryableFailure,
} from './retryFailureTaxonomy.js';

export {
  getDelayDuration,
  getRetryAfterDelayMs,
  hasRetryAfterHeader,
} from './retryAfterHeader.js';

/**
 * Determines if an error should trigger a retry.
 *
 * Delegates to the shared failure taxonomy: one eligibility decision
 * (isRetryableFailure over the decoded RetryFailure) governs central
 * retry, load-balancer failover, and telemetry. The historical status
 * exceptions (403 forbidden, terminal-quota 429, load-balancer-owned
 * request timeouts, aggregate isRetryable markers) are encoded there.
 */
export function shouldRetryError(error: unknown): boolean {
  return isRetryableFailure(decodeRetryFailure(error));
}

/**
 * Resolve a human-readable reason for a bucket failover attempt.
 */
export function resolveFailoverReason(
  is429: boolean,
  isNetworkError: boolean,
  is5xxServerError: boolean,
  consecutive429s: number,
  consecutiveNetworkErrors: number,
  consecutiveServerErrors: number,
  errorStatus: number | undefined,
): string {
  if (is429) {
    return `${consecutive429s} consecutive 429 errors`;
  }
  if (isNetworkError) {
    return `${consecutiveNetworkErrors} consecutive network errors`;
  }
  if (is5xxServerError) {
    return `${consecutiveServerErrors} consecutive server errors`;
  }
  return `status ${errorStatus}`;
}
