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
}

export interface RetryErrorClassification {
  readonly status: number | undefined;
  readonly category: StructuredErrorCategory | undefined;
  readonly is429: boolean;
  readonly is402: boolean;
  readonly isAuthError: boolean;
  readonly isNetworkError: boolean;
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
  return {
    status,
    category,
    is429: status === 429 || isOverloadError(error),
    is402: status === 402,
    isAuthError: status === 401 || status === 403,
    isNetworkError: category === 'network',
  };
}

export function updateRetryErrorCounters(
  state: RetryErrorCounters,
  classification: RetryErrorClassification,
): void {
  const { is429, isAuthError, isNetworkError } = classification;
  state.consecutive429s = is429 ? state.consecutive429s + 1 : 0;
  state.consecutiveAuthErrors = isAuthError
    ? state.consecutiveAuthErrors + 1
    : 0;
  state.consecutiveNetworkErrors =
    isNetworkError && !is429 && !isAuthError
      ? state.consecutiveNetworkErrors + 1
      : 0;
}

export function resetRetryErrorCounters(state: RetryErrorCounters): void {
  state.consecutive429s = 0;
  state.consecutiveAuthErrors = 0;
  state.consecutiveNetworkErrors = 0;
}
