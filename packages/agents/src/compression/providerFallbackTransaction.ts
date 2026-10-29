/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  publishProviderFallbackCandidate,
  ProviderFallbackInvariantError,
  type ProviderFallbackCandidate,
} from './providerFallbackCandidate.js';

export interface FallbackTransactionDeps {
  readonly historyService: HistoryService;
  readonly logger: DebugLogger;
  readonly model: string;
  readonly performFallbackCompression: (
    promptId: string,
    applyResult: (candidate: ProviderFallbackCandidate) => Promise<void>,
    targetTokenCount?: number,
  ) => Promise<boolean>;
  readonly getPromptTokenBaseline: () => number | null;
  readonly resetPromptTokenBaseline: () => void;
  readonly restorePromptTokenBaseline: (baseline: number | null) => void;
}

export interface FallbackTransactionOutcome {
  readonly truncationApplied: boolean;
  readonly truncationFailure?: Error;
}

interface FallbackStateSnapshot {
  readonly restoreHistory: () => Promise<void>;
  readonly cacheAnchorSeq: number;
  readonly promptTokenBaseline: number | null;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function restoreFallbackState(
  deps: FallbackTransactionDeps,
  snapshot: FallbackStateSnapshot,
): Promise<void> {
  await snapshot.restoreHistory();
  if (snapshot.cacheAnchorSeq === 0) {
    deps.historyService.resetCacheAnchorSeq();
  } else {
    deps.historyService.setCacheAnchorSeq(snapshot.cacheAnchorSeq);
  }
  deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
}

async function restoreRejectedFallback(
  deps: FallbackTransactionDeps,
  snapshot: FallbackStateSnapshot,
  fallbackError: unknown,
): Promise<Error> {
  const failure = normalizeError(fallbackError);
  try {
    await restoreFallbackState(deps, snapshot);
    return failure;
  } catch (rollbackError) {
    throw new AggregateError(
      [failure, normalizeError(rollbackError)],
      'Provider truncation fallback failed and its state rollback also failed',
    );
  }
}

async function executeCapturedFallback(
  deps: FallbackTransactionDeps,
  snapshot: FallbackStateSnapshot,
  promptId: string,
  targetTokenCount: number | undefined,
): Promise<FallbackTransactionOutcome> {
  let truncationFailure: Error | undefined;
  let fallbackSucceeded = false;
  const candidate = { installed: false, committed: false };
  try {
    fallbackSucceeded = await deps.performFallbackCompression(
      promptId,
      async (rows) => {
        if (candidate.installed)
          throw new ProviderFallbackInvariantError(
            'Fallback candidate may only be installed once',
          );
        await publishProviderFallbackCandidate(
          deps.historyService,
          rows,
          deps.model,
        );
        candidate.installed = true;
        deps.historyService.resetCacheAnchorSeq();
        deps.resetPromptTokenBaseline();
        candidate.committed = true;
      },
      targetTokenCount,
    );
    if (!fallbackSucceeded && candidate.installed) {
      throw new Error(
        'Fallback compression rejected after installing candidate history',
      );
    }
    if (fallbackSucceeded && !candidate.committed)
      throw new ProviderFallbackInvariantError(
        'Fallback compression succeeded without providing candidate history',
      );
  } catch (fallbackError) {
    truncationFailure = candidate.installed
      ? await restoreRejectedFallback(deps, snapshot, fallbackError)
      : normalizeError(fallbackError);
    candidate.committed = false;
    deps.logger.warn(
      () =>
        '[CompressionHandler] Provider truncation fallback rejected during hard-limit enforcement',
      truncationFailure,
    );
    if (fallbackError instanceof ProviderFallbackInvariantError)
      throw truncationFailure;
  }
  return {
    truncationApplied: fallbackSucceeded && candidate.committed,
    truncationFailure,
  };
}

/**
 * Executes fallback truncation and commits its candidate history atomically.
 * The existing history remains untouched unless the complete candidate is
 * accepted and its token accounting succeeds. Shared by the array and source
 * routes so both keep one transaction-compensation and anchor/baseline order.
 */
export function executeFallbackTransaction(
  deps: FallbackTransactionDeps,
  promptId: string,
  targetTokenCount: number | undefined,
): Promise<FallbackTransactionOutcome> {
  const cacheAnchorSeq = deps.historyService.getCacheAnchorSeq();
  const promptTokenBaseline = deps.getPromptTokenBaseline();
  return deps.historyService.detachedValues.withRollbackCheckpoint(
    (restoreHistory) =>
      executeCapturedFallback(
        deps,
        { restoreHistory, cacheAnchorSeq, promptTokenBaseline },
        promptId,
        targetTokenCount,
      ),
  );
}
