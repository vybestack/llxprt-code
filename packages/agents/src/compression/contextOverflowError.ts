/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
}: ContextOverflowErrorParams): Error {
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
  return new Error(parts.join(' '));
}
