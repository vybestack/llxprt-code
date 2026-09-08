/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type {
  AttemptLifecycleObserver,
  AttemptStatus,
} from './logging/attemptLifecycle.js';
import type {
  RetryFailureKind,
  RetryFailurePhase,
  StreamExposure,
} from './retryFailureTaxonomy.js';

/** Failure taxonomy and commitment facts for one attempt (issue #2532). */
export interface AttemptFailureReport {
  kind?: RetryFailureKind;
  phase?: RetryFailurePhase;
  committed: boolean;
  exposure: StreamExposure;
  budgetUsed: number;
  budgetLimit: number;
  totalWaitMs?: number;
  visitedTargetCount?: number;
  visitedCredentialCount?: number;
  deadlineRemainingMs?: number;
}

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
  status: AttemptStatus,
  requestStartMs: number,
  providerName: string,
  logger: DebugLogger,
  errorMessage?: string,
  metrics?: {
    firstTokenMs: number | null;
    lastTokenMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    thoughtsTokens: number;
    toolTokens: number;
    cacheReads?: number;
    cacheWrites?: number | null;
  },
  failureReport?: AttemptFailureReport,
): void {
  const m = metrics ?? {
    firstTokenMs: null,
    lastTokenMs: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thoughtsTokens: 0,
    toolTokens: 0,
  };
  try {
    observer.onAttemptEnd({
      attemptId,
      attemptIndex,
      start: requestStartMs,
      completionMs: performance.now(),
      firstTokenMs: m.firstTokenMs,
      lastTokenMs: m.lastTokenMs,
      status,
      providerName,
      modelName,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cachedTokens: m.cachedTokens,
      thoughtsTokens: m.thoughtsTokens,
      toolTokens: m.toolTokens,
      cacheReads: m.cacheReads,
      cacheWrites: m.cacheWrites,
      errorMessage,
      ...(failureReport !== undefined
        ? {
            failureKind: failureReport.kind,
            failurePhase: failureReport.phase,
            committed: failureReport.committed,
            exposure: failureReport.exposure,
            budgetUsed: failureReport.budgetUsed,
            budgetLimit: failureReport.budgetLimit,
            totalWaitMs: failureReport.totalWaitMs,
            visitedTargetCount: failureReport.visitedTargetCount,
            visitedCredentialCount: failureReport.visitedCredentialCount,
            deadlineRemainingMs: failureReport.deadlineRemainingMs,
          }
        : {}),
    });
  } catch (err) {
    logger.debug(
      () =>
        `Attempt lifecycle onAttemptEnd failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
