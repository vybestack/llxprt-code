/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const TOKEN_SAFETY_MARGIN = 1000;
export const CONTEXT_LIMIT_FUDGE_FACTOR = 0.005;
export const INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD = 0.05;

/**
 * Convert a projected-token overage into the committed-history token target
 * that hard-limit truncation has to reach.
 *
 * The projection covers the whole finalized envelope (system prompt, tool
 * schemas, committed history and pending content), but truncation can only
 * remove committed history, so the target is the current history total less
 * the overage. Returns undefined when there is no overage, leaving strategies
 * on their own threshold-derived target (issue #3406).
 */
export function computeHistoryTruncationTarget(
  projected: number,
  marginAdjustedLimit: number,
  currentHistoryTokens: number,
): number | undefined {
  const overage = projected - marginAdjustedLimit;
  if (overage <= 0) {
    return undefined;
  }
  return Math.max(0, currentHistoryTokens - overage);
}

export function computeMarginAdjustedLimit(limit: number): number {
  const safetyAdjustedLimit = Math.max(0, limit - TOKEN_SAFETY_MARGIN);
  return Math.max(
    0,
    Math.min(
      limit,
      Math.floor(
        safetyAdjustedLimit + safetyAdjustedLimit * CONTEXT_LIMIT_FUDGE_FACTOR,
      ),
    ),
  );
}
