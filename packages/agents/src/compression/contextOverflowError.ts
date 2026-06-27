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
}

export function buildContextOverflowError({
  limit,
  initialProjected,
  finalProjected,
  marginAdjustedLimit,
  completionBudget,
  truncationFailure,
  compressionFailure,
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
  return new Error(parts.join(' '));
}
