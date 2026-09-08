/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532 AC-04 commitment gate for RetryOrchestrator recovery.
 *
 * The guarded stream already marks post-yield failures terminal via the
 * error-after-stream-output WeakSet, which gates retry and bucket failover.
 * This module makes the commitment gate explicit and adds the one case the
 * WeakSet mark cannot cover: an auth-kind failure arriving after commitment
 * is terminal, but the request MAY still repair auth for FUTURE requests by
 * invoking the auth error handler once (never replaying this request).
 *
 * The one-shot flag is claimed on the shared metadata record (the same
 * record the commit state lives on, via claimRequestAuthRepair), so repair
 * can never run twice for one request — even when nested orchestrator
 * layers resolve their own RetryRequestContext for that request — and
 * never leaks across requests.
 */

import type { GenerateChatOptions } from './IProvider.js';
import {
  claimRequestAuthRepair,
  getRequestCommitState,
  type RetryRequestContext,
} from './retryRequestContext.js';
import type { RetryFailure } from './retryFailureTaxonomy.js';
import { getOnAuthErrorHandlerFromOptions } from './retryConfigHandlers.js';
import { getRequestSignal } from './utils/abortSignal.js';

export interface RetryDecision {
  readonly type: 'throw';
  readonly error: unknown;
}

export type AuthRepairInvoker = (
  error: unknown,
  options: GenerateChatOptions,
  errorStatus: number | undefined,
  signal: AbortSignal | undefined,
) => Promise<void>;

/**
 * Runs the one-shot prepare-future-only auth repair when the failure is an
 * auth-kind failure on a committed request. The handler prepares future
 * requests (token refresh / cache invalidation); it never grants a retry.
 * Handler failures are swallowed: the original error still surfaces.
 */
async function repairAuthForFutureRequests(
  request: RetryRequestContext,
  failure: RetryFailure,
  invoke: AuthRepairInvoker,
): Promise<void> {
  if (getRequestCommitState(request).committed !== true) return;
  if (failure.kind !== 'auth') return;
  if (getOnAuthErrorHandlerFromOptions(request.options) === undefined) return;
  if (!claimRequestAuthRepair(request.options)) return;
  try {
    await invoke(
      failure.cause,
      request.options,
      failure.status,
      getRequestSignal(request.options),
    );
  } catch {
    // Best-effort repair for future requests; this request is already dead.
  }
}

/**
 * Terminal decision for a committed (or WeakSet-terminal) failure: optionally
 * repairs auth for future requests, then throws the ORIGINAL error. The error
 * is passed explicitly so it is never lost to decoding.
 */
export async function decideCommittedFailure(
  error: unknown,
  request: RetryRequestContext,
  failure: RetryFailure | undefined,
  invoke: AuthRepairInvoker,
): Promise<RetryDecision> {
  if (failure !== undefined) {
    await repairAuthForFutureRequests(request, failure, invoke);
  }
  return { type: 'throw', error };
}
