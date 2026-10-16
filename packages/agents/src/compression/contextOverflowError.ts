/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class ContextOverflowError extends Error {
  constructor(
    message: string,
    readonly estimatedRequestTokenCount: number,
    readonly remainingTokenCount: number,
  ) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

export interface ContextOverflowErrorParams {
  limit: number;
  initialProjected: number;
  finalProjected: number;
  marginAdjustedLimit: number;
  completionBudget: number;
  truncationFailure?: Error;
  compressionFailure?: Error;
  toolResponseTruncationAttempted?: boolean;
  toolResponsesTruncated?: number;
}

export function buildContextOverflowError({
  limit,
  initialProjected,
  finalProjected,
  marginAdjustedLimit,
  completionBudget,
  truncationFailure,
  compressionFailure,
  toolResponseTruncationAttempted,
  toolResponsesTruncated,
}: ContextOverflowErrorParams): ContextOverflowError {
  const totalReduction = Math.max(0, initialProjected - finalProjected);
  const tokensStillNeeded = finalProjected - marginAdjustedLimit;
  const parts: string[] = [
    `Request still exceeds the safety-adjusted context limit (${marginAdjustedLimit} tokens).`,
    `density optimization and compression reduced ${totalReduction} tokens (from ${initialProjected} to ${finalProjected} projected).`,
    `completionBudget=${completionBudget}, tokensStillNeeded=${tokensStillNeeded}.`,
  ];
  if (completionBudget > 0.8 * limit) {
    parts.push(
      `The completion budget (${completionBudget}) consumes more than 80% of the context window (${limit}). Consider lowering maxOutputTokens.`,
    );
  }
  if (compressionFailure !== undefined) {
    parts.push(
      `Automatic compression failed before fallback: ${String(compressionFailure)}.`,
    );
  }
  if (truncationFailure !== undefined) {
    parts.push(
      `Truncation fallback failed during hard-limit enforcement: ${String(truncationFailure)}.`,
    );
  }
  if (toolResponseTruncationAttempted === true) {
    parts.push(
      `Last-resort tool-response truncation replaced ${toolResponsesTruncated ?? 0} response(s) but could not recover the remaining context budget.`,
    );
  }
  return new ContextOverflowError(
    parts.join(' '),
    Math.max(0, finalProjected - completionBudget),
    Math.max(0, marginAdjustedLimit - completionBudget),
  );
}

export function buildUnrecoverableBoundaryError(
  projected: number,
  marginAdjustedLimit: number,
): Error {
  return new Error(
    'Context overflow requires compression, but the pending-content boundary is unrecoverable: ' +
      'a BeforeModel hook replaced or restructured the conversation contents, and no usable ' +
      'llm_request_boundary metadata was available, so compression cannot safely recompose the pending region. ' +
      'Consider reducing the context size, or have the hook supply valid llm_request_boundary metadata. ' +
      `Projected ${projected} exceeds safety-adjusted limit ${marginAdjustedLimit}.`,
  );
}
