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
import { permitsBucketFailover } from './errors.js';
import {
  decodeRetryFailure,
  type RetryFailure,
} from './retryFailureTaxonomy.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export type RetryAction =
  | { type: 'throw'; error: unknown }
  | { type: 'continue' };

export interface FailoverState {
  consecutive429s: number;
  consecutiveNetworkErrors: number;
  consecutiveAuthErrors: number;
  consecutiveServerErrors: number;
  attempt: number;
  currentDelay: number;
}

export interface FailoverFlags {
  is429: boolean;
  is402: boolean;
  isAuthError: boolean;
  isNetworkError: boolean;
  is5xxServerError: boolean;
}

/**
 * Gate a bucket-failover attempt on the aggregate attempt budget, the
 * error's eligibility, and the consecutive-failure thresholds. Committed
 * requests never reach this: post-exposure errors are terminal upstream.
 *
 * Eligibility flags are derived from the shared failure taxonomy (one decode
 * per decision) rather than re-implemented status matching here.
 */
export function shouldFailoverNow(
  state: FailoverState,
  maxAttempts: number,
  error: unknown,
  bucketFailoverHandler: BucketFailoverHandler | undefined,
  failoverThreshold: number,
): boolean {
  if (state.attempt >= maxAttempts) return false;
  if (!permitsBucketFailover(error)) return false;
  return shouldAttemptFailover(
    bucketFailoverHandler,
    flagsFromFailure(decodeRetryFailure(error)),
    state,
    failoverThreshold,
  );
}

/**
 * Project a decoded failure onto the historical classification flags the
 * consecutive-threshold policy consumes. quota-bearing rate limits keep the
 * is429 flag: credential-bucket rotation is the intended recovery for an
 * exhausted quota even though same-target retry treats it as terminal.
 *
 * In-band provider-coded failures (overloaded_error, rate_limit_error, and
 * the status-less api_error body) ride the is429/overload counter path:
 * classifyRetryError counts them as the 429 class (its is5xx excludes them
 * by design, see retryErrorClassification.ts), so the flags must match the
 * counters they are compared against.
 */
export function flagsFromFailure(failure: RetryFailure): FailoverFlags {
  const inBandServer = failure.kind === 'server' && failure.phase === 'stream';
  return {
    is429:
      failure.kind === 'rate_limit' ||
      failure.kind === 'overload' ||
      inBandServer,
    is402: failure.kind === 'payment',
    isAuthError: failure.kind === 'auth',
    isNetworkError: failure.kind === 'network',
    is5xxServerError: failure.kind === 'server' && !inBandServer,
  };
}

/**
 * Determines whether a bucket failover should be attempted based on
 * consecutive error counts and the failover threshold.
 */
export function shouldAttemptFailover(
  bucketFailoverHandler: BucketFailoverHandler | undefined,
  flags: FailoverFlags,
  state: FailoverState,
  failoverThreshold: number,
): boolean {
  if (bucketFailoverHandler === undefined) {
    return false;
  }
  if (flags.is429 && state.consecutive429s > failoverThreshold) {
    return true;
  }
  if (flags.is402) {
    return true;
  }
  if (flags.isAuthError && state.consecutiveAuthErrors > 1) {
    return true;
  }
  if (
    flags.isNetworkError &&
    state.consecutiveNetworkErrors > failoverThreshold
  ) {
    return true;
  }
  return (
    flags.is5xxServerError && state.consecutiveServerErrors > failoverThreshold
  );
}

/**
 * Attempt bucket failover; returns 'continue' if failover succeeded
 * (counters reset, retry immediately), or 'exhausted' if no buckets remain.
 */
export async function attemptBucketFailover(
  errorStatus: number | undefined,
  is429: boolean,
  isNetworkError: boolean,
  is5xxServerError: boolean,
  state: FailoverState,
  bucketFailoverHandler: BucketFailoverHandler,
  authRetryTimeoutMs: number,
  signal: AbortSignal | undefined,
  logger: DebugLogger,
): Promise<'continue' | 'exhausted'> {
  const failoverReason = resolveFailoverReason(
    is429,
    isNetworkError,
    is5xxServerError,
    state.consecutive429s,
    state.consecutiveNetworkErrors,
    state.consecutiveServerErrors,
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
