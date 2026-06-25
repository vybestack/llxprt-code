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
 */

import type { SendMessageParameters } from '@google/genai';
import {
  InvalidStreamError,
  EmptyStreamError,
  INVALID_CONTENT_RETRY_OPTIONS,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';

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
  params: SendMessageParameters,
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
 * Decides whether a mid-stream error in _runStreamAttempt should trigger a
 * bounded turn-level retry. Returns true only for retryable content/stream
 * errors or transient network errors that are NOT user-initiated aborts, and
 * only while the retry budget remains.
 */
export function shouldRetryStreamAttempt(
  error: unknown,
  params: SendMessageParameters,
  attempt: number,
): boolean {
  const withinBudget = attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1;
  if (!withinBudget) return false;
  if (
    error instanceof InvalidStreamError ||
    error instanceof EmptyStreamError
  ) {
    return true;
  }
  return isNetworkTransientError(error) && !isAbortError(error, params);
}
