/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BucketFailoverHandler,
  FailoverContext,
} from '@vybestack/llxprt-code-core/config/config.js';
import { raceWithAbort } from './utils/abortSignal.js';
import { resetRetryErrorCounters } from './retryErrorClassification.js';
import { resolveFailoverReason } from './retryDelayPolicy.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export type RetryAction =
  | { type: 'throw'; error: unknown }
  | { type: 'continue' };

export interface FailoverState {
  consecutive429s: number;
  consecutiveNetworkErrors: number;
  consecutiveAuthErrors: number;
  attempt: number;
  currentDelay: number;
}

/**
 * Determines whether a bucket failover should be attempted based on
 * consecutive error counts and the failover threshold.
 */
export function shouldAttemptFailover(
  bucketFailoverHandler: BucketFailoverHandler | undefined,
  is429: boolean,
  is402: boolean,
  isAuthError: boolean,
  isNetworkError: boolean,
  state: FailoverState,
  failoverThreshold: number,
): boolean {
  if (bucketFailoverHandler === undefined) {
    return false;
  }
  if (is429 && state.consecutive429s > failoverThreshold) {
    return true;
  }
  if (is402) {
    return true;
  }
  if (isAuthError && state.consecutiveAuthErrors > 1) {
    return true;
  }
  return isNetworkError && state.consecutiveNetworkErrors > failoverThreshold;
}

/**
 * Attempt bucket failover; returns 'continue' if failover succeeded
 * (counters reset, retry immediately), or 'exhausted' if no buckets remain.
 */
export async function attemptBucketFailover(
  errorStatus: number | undefined,
  is429: boolean,
  isNetworkError: boolean,
  state: FailoverState,
  bucketFailoverHandler: BucketFailoverHandler,
  authRetryTimeoutMs: number,
  signal: AbortSignal | undefined,
  logger: DebugLogger,
): Promise<'continue' | 'exhausted'> {
  const failoverReason = resolveFailoverReason(
    is429,
    isNetworkError,
    state.consecutive429s,
    state.consecutiveNetworkErrors,
    errorStatus,
  );
  logger.debug(() => `Attempting bucket failover after ${failoverReason}`);

  const failoverContext: FailoverContext = {
    triggeringStatus: errorStatus,
    authRetryTimeoutMs,
    signal,
  };

  let failoverResult: boolean;
  try {
    failoverResult = await raceWithAbort(
      bucketFailoverHandler.tryFailover(failoverContext),
      signal,
    );
  } catch (failoverError) {
    if (signal?.aborted === true) throw failoverError;
    logger.debug(
      () =>
        `Bucket failover handler rejected, treating as exhausted: ${failoverError}`,
    );
    return 'exhausted';
  }

  if (failoverResult) {
    logger.debug(() => `Bucket failover successful, resetting retry state`);
    resetRetryErrorCounters(state);
    return 'continue';
  }

  logger.debug(() => `No more buckets available for failover, stopping retry`);
  return 'exhausted';
}
