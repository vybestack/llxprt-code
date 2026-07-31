/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  getErrorStatus,
  isOverloadError,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { classifyProviderError } from './providerErrorObservation.js';

export interface RetryErrorCounters {
  consecutive429s: number;
  consecutiveAuthErrors: number;
  consecutiveNetworkErrors: number;
  consecutiveServerErrors: number;
}

export interface RetryErrorClassification {
  readonly status: number | undefined;
  readonly category: StructuredErrorCategory | undefined;
  readonly is429: boolean;
  readonly is402: boolean;
  readonly isAuthError: boolean;
  readonly isNetworkError: boolean;
  readonly is5xxServerError: boolean;
}

const errorsAfterStreamOutput = new WeakSet<object>();

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}

function hasErrorName(error: unknown, expectedName: string): boolean {
  if (!isObjectLike(error)) return false;
  try {
    return 'name' in error && error.name === expectedName;
  } catch {
    return false;
  }
}

export function markErrorAfterStreamOutput(error: unknown): unknown {
  if (isObjectLike(error)) {
    errorsAfterStreamOutput.add(error);
    return error;
  }
  const wrappedError = new Error(String(error)) as Error & { cause: unknown };
  wrappedError.cause = error;
  errorsAfterStreamOutput.add(wrappedError);
  return wrappedError;
}

export function isTerminalRetryError(error: unknown): boolean {
  if (hasErrorName(error, 'AbortError')) return true;
  return isObjectLike(error) && errorsAfterStreamOutput.has(error);
}

export function classifyRetryError(error: unknown): RetryErrorClassification {
  const status = getErrorStatus(error);
  const category = classifyProviderError(error, status);
  const is429 = status === 429 || isOverloadError(error);
  const is402 = status === 402;
  const isAuthError = status === 401 || status === 403;
  const isNetworkError = category === 'network';
  // Server errors include plain HTTP 5xx statuses and Anthropic api_error.
  // category === 'server_error' is already mutually exclusive with the
  // rate_limit/quota/authentication categories, so the only overlap is with
  // is429 (which catches api_error via isOverloadError). Exclude is429 so
  // api_error/overloaded_error use the existing 429 failover path.
  const is5xxServerError = category === 'server_error' && !is429;
  return {
    status,
    category,
    is429,
    is402,
    isAuthError,
    isNetworkError,
    is5xxServerError,
  };
}

export function updateRetryErrorCounters(
  state: RetryErrorCounters,
  classification: RetryErrorClassification,
): void {
  const { is429, isAuthError, isNetworkError, is5xxServerError } =
    classification;
  state.consecutive429s = is429 ? state.consecutive429s + 1 : 0;
  state.consecutiveAuthErrors = isAuthError
    ? state.consecutiveAuthErrors + 1
    : 0;
  state.consecutiveNetworkErrors =
    isNetworkError && !is429 && !isAuthError
      ? state.consecutiveNetworkErrors + 1
      : 0;
  state.consecutiveServerErrors = is5xxServerError
    ? state.consecutiveServerErrors + 1
    : 0;
}

export function resetRetryErrorCounters(state: RetryErrorCounters): void {
  state.consecutive429s = 0;
  state.consecutiveAuthErrors = 0;
  state.consecutiveNetworkErrors = 0;
  state.consecutiveServerErrors = 0;
}
