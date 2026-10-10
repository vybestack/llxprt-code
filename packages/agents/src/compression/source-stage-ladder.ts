/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildUnrecoverableBoundaryError } from './contextOverflowError.js';
import type { ProviderSourceEnforcer } from './provider-source-enforcement.js';

/** Effects the disk-source ladder performs; each mutates durable history or the candidate. */
export interface SourceStageActions {
  /** Density optimization over the durable journal, with token accounting settled. */
  optimizeDensity(): Promise<void>;
  /** One configured compression attempt, with token accounting settled. */
  compress(): Promise<PerformCompressionResult>;
  /** Rebuilds the pending-aware candidate from the durable journal, discarding the stale one. */
  replaceSource(): Promise<void>;
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
  } catch (error: unknown) {
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

/**
 * Same ordered stages and thresholds as the array route: initial check, density
 * optimization, configured compression, then one ineffective-compression retry.
 * Hard-limit fallback and tool-response truncation are a later stage; reaching
 * them fails visibly instead of sending an over-limit request.
 *
 * `pendingRecoverable` is false only when a BeforeModel hook discarded the
 * pending boundary, matching the array route's unrecoverable-boundary rule.
 */
export async function runSourceStages(
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

  const first = await compressAndReplace(actions);
  let after = await enforcer.assess(
    'post-compression',
    dense.projected,
    first.result,
  );
  let failure = first.failure;
  if (after.next === 'retry-compression') {
    const retry = await compressAndReplace(actions);
    failure = retry.failure;
    after = await enforcer.assess('post-retry-compression');
  }
  if (after.next === 'send') return;
  throw new Error(
    `Disk source ${after.next} escalation is not available; projected ${after.projected} exceeds safety-adjusted limit ${enforcer.limits.marginAdjustedLimit} after density and compression.`,
    failure === undefined ? undefined : { cause: failure },
  );
}
