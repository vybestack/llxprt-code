/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SourceCandidate } from './source-candidate.js';
import { truncateToolResponsesInOnePass } from './toolResponseOnePass.js';

interface SourceToolTruncationInput<S> {
  readonly historyService: HistoryService;
  readonly logger: DebugLogger;
  readonly model: string;
  readonly marginAdjustedLimit: number;
  readonly completionBudget: number;
  readonly candidate: SourceCandidate<S>;
}

/**
 * Last-resort tool-response truncation over durable history and the raw
 * pending rows, ranked by the existing disk ranking. All replacements are
 * decided in one pass; history stubs are written to the journal in one
 * transaction and pending stubs replace the candidate's pending input. The
 * projections measure the rebuilt candidate: one before and one per round.
 * When no truncation can fit the limit nothing is replaced.
 */
export async function truncateSourceToolResponses<S>(
  input: SourceToolTruncationInput<S>,
): Promise<{ readonly replacedCount: number }> {
  const { historyService, logger, model, candidate } = input;
  logger.warn(
    () =>
      '[CompressionHandler] Provider payload still over limit after fallback, attempting last-resort unified tool-response truncation',
    {
      marginAdjustedLimit: input.marginAdjustedLimit,
      completionBudget: input.completionBudget,
      model,
    },
  );
  const result = await truncateToolResponsesInOnePass(
    {
      historyService,
      logger,
      pendingContents: await candidate.pending.read(),
      estimateBlockTokensAsync: (block) =>
        historyService.estimateTokensForContents(
          [{ speaker: 'tool', blocks: [block] }],
          model,
        ),
      computeProjected: async (working) =>
        (await candidate.estimateWithPending([...working])) +
        input.completionBudget,
      getRuntimeModel: () => model,
    },
    input.marginAdjustedLimit,
  );
  if (result.transformedPending !== undefined)
    candidate.pending.replace(result.transformedPending);
  return { replacedCount: result.replacedCount };
}
