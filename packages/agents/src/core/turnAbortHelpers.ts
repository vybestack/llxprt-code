/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Retry-decision helpers extracted from TurnProcessor.
 *
 * {@link isAbortError} distinguishes a genuine user/system abort from a
 * retryable transient network error: transient-error phrases (e.g.
 * "request aborted", "terminated") overlap with abort signaling, so the
 * classifier alone would wrongly retry cancellations.
 *
 * {@link shouldRetryStreamAttempt} centralizes the pure retry/stop decision
 * for errors that escape the stream loop in TurnProcessor._runStreamAttempt.
 *
 * @plan PLAN-20260806-ISSUE3048.P04
 * @requirement REQ-3048-002 REQ-3048-003 REQ-3048-004
 */

import type { SendMessageParams } from './chatSession.js';
import {
  InvalidStreamError,
  EmptyStreamError,
  INVALID_CONTENT_RETRY_OPTIONS,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';

export function isTerminalRetryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isRetryable' in error &&
    error.isRetryable === false
  );
}

/**
 * Determines whether an error represents a genuine user/system abort, as
 * opposed to a retryable transient network error whose phrasing merely
 * overlaps with abort signaling (e.g. "request aborted", "terminated").
 *
 * Recognized abort indicators:
 * - `error.name === 'AbortError'` (DOM/Node convention).
 * - `error.code === 'ABORT_ERR'` (set by `createAbortError()` in delay.ts and
 *   by Node's abort machinery; some abort-shaped errors carry the code without
 *   the name).
 * - `params.config?.abortSignal?.aborted === true` (the request's own signal
 *   was aborted, regardless of the error shape).
 */
export function isAbortError(
  error: unknown,
  params: SendMessageParams,
): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  ) {
    return true;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ABORT_ERR'
  ) {
    return true;
  }
  return params.config?.abortSignal?.aborted === true;
}

/**
 * True when the attempt already yielded model output (non-empty text, thinking,
 * or a tool call) to the consumer. Post-output restarts are
 * discard-and-restart: the whole attempt is abandoned, so a content-validity
 * verdict about output being discarded is not a reason to restart — only a
 * transport condition qualifies.
 */
export interface StreamAttemptContext {
  readonly hasYieldedOutput: boolean;
}

/**
 * Decides whether a mid-stream error in _runStreamAttempt should trigger a
 * bounded turn-level retry. Returns true only for retryable content/stream
 * errors or transient network errors that are NOT user-initiated aborts, and
 * only while the retry budget remains.
 *
 * A user/system abort is checked before any content/stream-error
 * classification in every branch, so an abort that surfaces as a pre-output
 * InvalidStreamError/EmptyStreamError is never retried. For non-abort errors
 * before output the classification matches the pre-#3048 contract. After
 * output only a transient transport failure (`isNetworkTransientError`) may
 * restart the turn: a content-validity verdict about discarded output is not a
 * transport failure, and the abandoned attempt must not be re-sent on its own
 * merits.
 */
export function shouldRetryStreamAttempt(
  error: unknown,
  params: SendMessageParams,
  attempt: number,
  context: StreamAttemptContext,
): boolean {
  const withinBudget = attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1;
  if (!withinBudget || isTerminalRetryError(error)) return false;
  // Abort must win before any content/stream-error classification: a
  // user/system cancellation is never retryable even if it surfaces as a
  // pre-output InvalidStreamError/EmptyStreamError.
  if (isAbortError(error, params)) return false;
  if (context.hasYieldedOutput) {
    return isNetworkTransientError(error);
  }
  if (
    error instanceof InvalidStreamError ||
    error instanceof EmptyStreamError
  ) {
    return true;
  }
  return isNetworkTransientError(error);
}

/**
 * Returns the request params for a given turn attempt, bumping the sampling
 * temperature on every restart so the regeneration does not deterministically
 * repeat. Relocated verbatim from TurnProcessor so that file stays under the
 * lint `max-lines` budget; behaviour is unchanged.
 */
export function applyRetryTemperature(
  params: SendMessageParams,
  attempt: number,
): SendMessageParams {
  if (attempt === 0) return params;
  const baselineTemperature = Math.max(params.config?.temperature ?? 1, 1);
  const newTemperature = Math.min(
    Math.max(baselineTemperature + attempt * 0.1, 0),
    2,
  );
  return {
    ...params,
    config: { ...params.config, temperature: newTemperature },
  };
}
