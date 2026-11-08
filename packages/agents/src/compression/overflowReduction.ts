/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildContextOverflowError } from './contextOverflowError.js';

/** The request after one reduction step and what that step could not do. */
export interface OverflowReductionResult {
  contents: IContent[];
  projected: number;
  compressionFailure?: Error;
  truncationFailure?: Error;
  truncationApplied: boolean;
}

export function buildOverflowError(
  limit: number,
  completionBudget: number,
  marginAdjustedLimit: number,
  initialProjected: number,
  truncationResult: OverflowReductionResult,
  toolResponsesTruncated?: number,
): Error {
  return buildContextOverflowError({
    limit,
    initialProjected,
    finalProjected: truncationResult.projected,
    marginAdjustedLimit,
    completionBudget,
    truncationFailure: truncationResult.truncationFailure,
    compressionFailure: truncationResult.compressionFailure,
    ...(toolResponsesTruncated !== undefined
      ? {
          toolResponseTruncationAttempted: true,
          toolResponsesTruncated,
        }
      : {}),
  });
}

export function withToolTruncationFailure(
  truncationResult: OverflowReductionResult,
  toolTruncationFailure: Error,
): OverflowReductionResult {
  if (truncationResult.truncationFailure === undefined) {
    return {
      ...truncationResult,
      truncationFailure: toolTruncationFailure,
    };
  }
  return {
    ...truncationResult,
    truncationFailure: new Error(
      `${truncationResult.truncationFailure.message}; unified tool-response truncation failed: ${toolTruncationFailure.message}`,
      { cause: toolTruncationFailure },
    ),
  };
}
