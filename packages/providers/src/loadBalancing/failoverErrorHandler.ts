/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  shouldFailover as shouldFailoverOnError,
  isImmediateFailoverError as isImmediateFailover,
  permitsLoadBalancerFailover,
} from './failoverSettings.js';
import type { FailoverState } from './failoverState.js';
import type { CircuitBreakerManager } from './circuitBreakerManager.js';
import type {
  FailoverSettings,
  LoadBalancerSubProfile,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';

export type FailoverErrorAction = 'immediate-throw' | 'break' | 'retry';

export interface FailoverErrorContext {
  readonly logger: DebugLogger;
  readonly circuitBreaker: CircuitBreakerManager;
  readonly failoverState: FailoverState;
  readonly recordFail: (name: string, startTime: number, error: Error) => void;
}

/**
 * Classify how the failover loop should respond to a backend error.
 *
 * Extracted from LoadBalancingProvider to keep the main class under the
 * max-lines limit while preserving identical behavior.
 */
export function handleFailoverError(
  error: unknown,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  attempts: number,
  maxAttempts: number,
  settings: FailoverSettings,
  errors: Array<{ profile: string; error: Error }>,
  chunksYielded: boolean,
  currentIndex: number,
  numProfiles: number,
  requestOwner: symbol,
  transportAttemptRemaining: boolean,
  ctx: FailoverErrorContext,
): FailoverErrorAction {
  // Normalize non-Error throws (null, string, plain object) so downstream
  // logging and recording never throws while reading .message.
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  if (chunksYielded) {
    ctx.logger.debug(
      () =>
        `[LB:failover] ${subProfile.name} failed after yielding chunks, aborting stream`,
    );
    ctx.recordFail(subProfile.name, startTime, normalizedError);
    ctx.circuitBreaker.recordBackendFailure(subProfile.name, normalizedError);
    return 'immediate-throw';
  }
  if (!permitsLoadBalancerFailover(error)) return 'immediate-throw';
  if (isImmediateFailover(error)) {
    ctx.logger.debug(
      () =>
        `[LB:failover] ${subProfile.name} returned immediate failover error (${getErrorStatus(error)}), skipping retries`,
    );
    ctx.recordFail(subProfile.name, startTime, normalizedError);
    ctx.circuitBreaker.recordBackendFailure(subProfile.name, normalizedError);
    errors.push({ profile: subProfile.name, error: normalizedError });
    ctx.failoverState.advanceFrom(requestOwner, currentIndex, numProfiles);
    return 'break';
  }

  const isLastAttempt = attempts >= maxAttempts;
  const shouldRetry =
    !isLastAttempt &&
    transportAttemptRemaining &&
    shouldFailoverOnError(error, settings);

  if (shouldRetry) {
    if (settings.retryDelayMs > 0) {
      ctx.logger.debug(
        () =>
          `[LB:failover] ${subProfile.name} attempt ${attempts} failed, retrying after ${settings.retryDelayMs}ms: ${normalizedError.message}`,
      );
    }
    return 'retry';
  }

  ctx.logger.debug(
    () =>
      `[LB:failover] ${subProfile.name} failed after ${attempts} attempts: ${normalizedError.message}`,
  );
  ctx.recordFail(subProfile.name, startTime, normalizedError);
  ctx.circuitBreaker.recordBackendFailure(subProfile.name, normalizedError);
  errors.push({ profile: subProfile.name, error: normalizedError });
  ctx.failoverState.advanceFrom(requestOwner, currentIndex, numProfiles);
  return 'break';
}
