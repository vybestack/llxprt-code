/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const TOKEN_SAFETY_MARGIN = 1000;
export const CONTEXT_LIMIT_FUDGE_FACTOR = 0.005;
export const INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD = 0.05;

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
