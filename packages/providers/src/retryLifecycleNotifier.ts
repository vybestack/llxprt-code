/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { AttemptLifecycleObserver } from './logging/attemptLifecycle.js';

/** Notify lifecycle observer of attempt start (fail-open). */
export function notifyRetryAttemptStart(
  observer: AttemptLifecycleObserver,
  attemptIndex: number,
  attemptId: string,
  requestStartMs: number,
  providerName: string,
  modelName: string,
  logger: DebugLogger,
): void {
  try {
    observer.onAttemptStart({
      requestStartMs,
      attemptId,
      attemptIndex,
      providerName,
      modelName,
    });
  } catch (err) {
    logger.debug(
      () =>
        `Attempt lifecycle onAttemptStart failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Notify lifecycle observer of attempt terminal end (fail-open). */
export function notifyRetryAttemptEnd(
  observer: AttemptLifecycleObserver,
  attemptIndex: number,
  attemptId: string,
  modelName: string,
  status: 'success' | 'error' | 'aborted',
  requestStartMs: number,
  providerName: string,
  logger: DebugLogger,
  errorMessage?: string,
): void {
  try {
    observer.onAttemptEnd({
      attemptId,
      attemptIndex,
      start: requestStartMs,
      completionMs: performance.now(),
      firstTokenMs: null,
      lastTokenMs: null,
      status,
      providerName,
      modelName,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      errorMessage,
    });
  } catch (err) {
    logger.debug(
      () =>
        `Attempt lifecycle onAttemptEnd failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
