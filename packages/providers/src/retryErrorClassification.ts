/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  getErrorStatus,
  isNetworkTransientError,
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

export function isTerminalRetryError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error as Error & { _chunksYieldedBeforeError?: boolean })
      ._chunksYieldedBeforeError === true
  );
}

export function classifyRetryError(error: unknown): RetryErrorClassification {
  const status = getErrorStatus(error);
  return {
    status,
    category: classifyProviderError(error, status),
    is429: status === 429 || isOverloadError(error),
    is402: status === 402,
    isAuthError: status === 401 || status === 403,
    isNetworkError: isNetworkTransientError(error),
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
