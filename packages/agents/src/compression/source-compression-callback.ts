/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeCompressionGuardInfo } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  ProviderSourceEnforcer,
  type ProviderSourceLimits,
} from './provider-source-enforcement.js';
import type { SourceCandidate } from './source-candidate.js';
import {
  runSourceStages,
  type SourceStageActions,
} from './source-stage-ladder.js';

export interface SourceCompressionCallbackDeps<S extends ProviderRequestRows> {
  readonly candidate: SourceCandidate<S>;
  /** Limits used when the provider supplies no guard facts. */
  readonly defaultLimits: ProviderSourceLimits;
  readonly pendingRecoverable: boolean;
  readonly getHistoryTokens: () => number;
  readonly stageActions: (limits: ProviderSourceLimits) => SourceStageActions;
  readonly warn: (message: string, error: unknown) => void;
}

/**
 * The provider's guard estimate covers the whole finalized envelope; whatever
 * the candidate's own estimate cannot see is fixed overhead, and the fit
 * predicate mirrors the guard's check with no completion budget re-reserved
 * (issue #3499).
 */
async function guardLimits<S extends ProviderRequestRows>(
  candidate: SourceCandidate<S>,
  guard: RuntimeCompressionGuardInfo,
): Promise<ProviderSourceLimits> {
  const overhead = Math.max(
    0,
    guard.estimatedTokens - (await candidate.estimate()),
  );
  const effectiveLimit = Math.max(1, guard.contextLimit - overhead);
  return {
    completionBudget: 0,
    limit: guard.contextLimit,
    marginAdjustedLimit: effectiveLimit,
    compressionThreshold: effectiveLimit,
  };
}

async function readRows(rows: ProviderRequestRows): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const row of rows.openReader()) out.push(row);
  return out;
}

/**
 * Provider-triggered compression over the disk candidate. It runs the same
 * ordered source stages as pre-send enforcement (so fallback keeps its shared
 * transaction compensation and anchor/baseline order) and hands the provider
 * the rows of the replacement candidate. Superseded and replacement candidates
 * stay owned by the send preparer that estimated them.
 */
export function createSourceCompressionCallback<S extends ProviderRequestRows>(
  deps: SourceCompressionCallbackDeps<S>,
): (
  contents: IContent[],
  guard?: RuntimeCompressionGuardInfo,
) => Promise<IContent[]> {
  return async (_contents, guard) => {
    try {
      const limits =
        guard === undefined
          ? deps.defaultLimits
          : await guardLimits(deps.candidate, guard);
      await runSourceStages(
        new ProviderSourceEnforcer({
          limits,
          estimate: () => deps.candidate.estimate(),
          getHistoryTokens: deps.getHistoryTokens,
        }),
        deps.stageActions(limits),
        deps.pendingRecoverable,
      );
      return await readRows(deps.candidate.value);
    } catch (error: unknown) {
      deps.warn('[CompressionHandler] Compression callback failed', error);
      throw error;
    }
  };
}
