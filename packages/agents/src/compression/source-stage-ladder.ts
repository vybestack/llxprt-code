/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { isRelievableMediaPressure } from './mediaPressureFallback.js';
import { CompressionRollbackError } from './guardedCompression.js';
import { isAbortLikeError } from './is-abort-like-error.js';
import {
  buildContextOverflowError,
  buildUnrecoverableBoundaryError,
} from './contextOverflowError.js';
import type {
  ProviderSourceAssessment,
  ProviderSourceEnforcer,
} from './provider-source-enforcement.js';
import type { FallbackTransactionOutcome } from './providerFallbackTransaction.js';

/** Effects the disk-source ladder performs; each mutates durable history or the candidate. */
export interface SourceStageActions {
  /** Density optimization over the durable journal, with token accounting settled. */
  optimizeDensity(): Promise<void>;
  /** One configured compression attempt, with token accounting settled. */
  compress(): Promise<PerformCompressionResult>;
  /** Rebuilds the pending-aware candidate from the durable journal, discarding the stale one. */
  replaceSource(): Promise<void>;
  /** Retires historical image pixels in the request view without changing history. */
  relieveMediaPressure?(): Promise<boolean>;
  checkMediaPressure?(error: unknown): Promise<void>;
  /** Hard-limit fallback truncation; history, anchor and baseline roll back unless the whole candidate is accepted. */
  fallback(
    historyTarget: number | undefined,
  ): Promise<FallbackTransactionOutcome>;
  /** Last-resort tool-response truncation over durable history and pending rows. Throws when it cannot run. */
  truncateToolResponses(): Promise<{ readonly replacedCount: number }>;
  warn(message: string, error: Error): void;
}

function normalizeFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function compressAndReplace(
  actions: SourceStageActions,
): Promise<{ result: PerformCompressionResult; failure?: Error }> {
  let result: PerformCompressionResult;
  let failure: Error | undefined;
  try {
    result = await actions.compress();
    if (result !== PerformCompressionResult.COMPRESSED)
      failure = new Error(
        `Auto compression did not complete during hard-limit enforcement (result: ${result})`,
      );
  } catch (error: unknown) {
    if (isAbortLikeError(error) || error instanceof CompressionRollbackError)
      throw error;
    result = PerformCompressionResult.FAILED;
    failure = normalizeFailure(error);
    actions.warn(
      '[CompressionHandler] Auto compression failed during hard-limit enforcement',
      failure,
    );
  }
  await actions.replaceSource();
  return failure === undefined ? { result } : { result, failure };
}

interface ReductionOutcome {
  readonly assessment: ProviderSourceAssessment;
  readonly compressionFailure?: Error;
}

/** Configured compression plus the single ineffective-compression retry. */
async function compressWithRetry(
  enforcer: ProviderSourceEnforcer,
  actions: SourceStageActions,
  preCompressionProjected: number,
): Promise<ReductionOutcome> {
  const first = await compressAndReplace(actions);
  const assessment = await enforcer.assess(
    'post-compression',
    preCompressionProjected,
    first.result,
  );
  if (assessment.next !== 'retry-compression')
    return withFailure(assessment, first.failure);
  const retry = await compressAndReplace(actions);
  const retried = await enforcer.assess('post-retry-compression');
  return withFailure(
    retried,
    retry.failure === undefined
      ? undefined
      : new Error(
          `Additional hard-limit compression attempt failed: ${retry.failure.message}`,
          { cause: retry.failure },
        ),
  );
}

function withFailure(
  assessment: ProviderSourceAssessment,
  compressionFailure: Error | undefined,
): ReductionOutcome {
  return compressionFailure === undefined
    ? { assessment }
    : { assessment, compressionFailure };
}

function combineTruncationFailure(
  fallbackFailure: Error | undefined,
  toolFailure: Error,
): Error {
  return fallbackFailure === undefined
    ? toolFailure
    : new Error(
        `${fallbackFailure.message}; unified tool-response truncation failed: ${toolFailure.message}`,
        { cause: toolFailure },
      );
}

/**
 * Hard-limit fallback truncation then last-resort tool-response truncation,
 * in the array route's order. Structured overflow is returned only after both
 * are exhausted.
 */
async function exhaustHardLimit(
  enforcer: ProviderSourceEnforcer,
  actions: SourceStageActions,
  initialProjected: number,
  reduction: ReductionOutcome,
): Promise<void> {
  const fallbackOutcome = await actions.fallback(
    reduction.assessment.historyTarget,
  );
  await actions.replaceSource();
  const truncated = await enforcer.assess('post-truncation');
  if (truncated.next === 'send') return;

  let toolFailure: Error | undefined;
  let replacedCount = 0;
  try {
    replacedCount = (await actions.truncateToolResponses()).replacedCount;
  } catch (error: unknown) {
    if (isAbortLikeError(error)) throw error;
    toolFailure = normalizeFailure(error);
    actions.warn(
      '[CompressionHandler] Unified tool-response truncation failed during last-resort enforcement',
      toolFailure,
    );
  }
  await actions.replaceSource();
  const final = await enforcer.assess('post-tool-response-truncation');
  if (final.next === 'send') return;
  const truncationFailure =
    toolFailure === undefined
      ? fallbackOutcome.truncationFailure
      : combineTruncationFailure(
          fallbackOutcome.truncationFailure,
          toolFailure,
        );
  throw buildContextOverflowError({
    limit: enforcer.limits.limit,
    initialProjected,
    finalProjected: final.projected,
    marginAdjustedLimit: enforcer.limits.marginAdjustedLimit,
    completionBudget: enforcer.limits.completionBudget,
    truncationFailure,
    compressionFailure: reduction.compressionFailure,
    toolResponseTruncationAttempted: true,
    toolResponsesTruncated: replacedCount,
  });
}

/**
 * Same ordered stages and thresholds as the array route: initial check, density
 * optimization, configured compression, one ineffective-compression retry,
 * hard-limit fallback truncation, then last-resort tool-response truncation.
 * Only after that ladder is exhausted does it throw the structured overflow.
 *
 * `pendingRecoverable` is false only when a BeforeModel hook discarded the
 * pending boundary, matching the array route's unrecoverable-boundary rule.
 */
async function runTokenStages(
  enforcer: ProviderSourceEnforcer,
  actions: SourceStageActions,
  pendingRecoverable: boolean,
): Promise<void> {
  const initial = await enforcer.assess('initial');
  if (initial.next === 'send') return;
  if (!pendingRecoverable) {
    if (initial.projected <= enforcer.limits.marginAdjustedLimit) return;
    throw buildUnrecoverableBoundaryError(
      initial.projected,
      enforcer.limits.marginAdjustedLimit,
    );
  }

  await actions.optimizeDensity();
  await actions.replaceSource();
  const dense = await enforcer.assess('post-density-optimization');
  if (dense.next === 'send') return;

  const reduction = await compressWithRetry(enforcer, actions, dense.projected);
  if (reduction.assessment.next === 'send') return;
  await exhaustHardLimit(enforcer, actions, initial.projected, reduction);
}

/** One byte-recovery pass, followed by the same token-limit checks. */
export async function runSourceStages(
  enforcer: ProviderSourceEnforcer,
  actions: SourceStageActions,
  pendingRecoverable: boolean,
): Promise<void> {
  let compressionAttempts = 0;
  const tracked = {
    ...actions,
    compress: () => {
      compressionAttempts++;
      return actions.compress();
    },
  };
  try {
    await runTokenStages(enforcer, tracked, pendingRecoverable);
  } catch (error) {
    if (
      !isRelievableMediaPressure(error) ||
      actions.relieveMediaPressure === undefined
    )
      throw error;
    await actions.checkMediaPressure?.(error);
    if (pendingRecoverable && compressionAttempts === 0) {
      await compressAndReplace(tracked);
    }
    const changed = await actions.relieveMediaPressure();
    if (!changed && compressionAttempts === 0) throw error;
    await runTokenStages(enforcer, actions, pendingRecoverable);
  }
}
