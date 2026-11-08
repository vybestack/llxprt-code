/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { getCompletionBudget } from './compressionBudgeting.js';
import { computeMarginAdjustedLimit } from './contextLimitPolicy.js';

/** The token limits one enforcement call holds a request to. */
export interface ContextLimits {
  completionBudget: number;
  limit: number;
  marginAdjustedLimit: number;
  compressionThreshold: number;
}

export interface ContextLimitSettings {
  /** Configured context window override; the model's own limit otherwise. */
  readonly userContextLimit: number;
  /** Fraction of the usable window at which compression starts. */
  readonly compressionThreshold: number;
  readonly generationConfig: ModelGenerationSettings;
  readonly completionBudgetSetting: unknown;
}

function computeCompressionThreshold(
  threshold: number,
  limit: number,
  completionBudget: number,
  marginAdjustedLimit: number,
): number {
  const effectiveLimit = Math.max(0, limit - completionBudget);
  return Math.min(
    marginAdjustedLimit,
    threshold * effectiveLimit + completionBudget,
  );
}

export function computeContextLimits(
  settings: ContextLimitSettings,
  provider: IProvider | undefined,
  model: string,
): ContextLimits {
  const limit = tokenLimit(model, settings.userContextLimit);
  const completionBudget = getCompletionBudget(
    settings.generationConfig,
    model,
    provider,
    settings.completionBudgetSetting,
    limit,
  );
  const marginAdjustedLimit = computeMarginAdjustedLimit(limit);
  return {
    completionBudget,
    limit,
    marginAdjustedLimit,
    compressionThreshold: computeCompressionThreshold(
      settings.compressionThreshold,
      limit,
      completionBudget,
      marginAdjustedLimit,
    ),
  };
}

/**
 * Limits for a request held to a context guard's limit. The guard's estimate
 * covers the full finalized envelope, so the fixed `overhead` it carries
 * beyond the contents is subtracted from the limit, and no completion budget
 * is re-reserved: the fit predicate mirrors the guard's own check,
 * ownEstimate(contents') + overhead <= guard.contextLimit (issue #3499).
 */
export function limitsForGuard(
  contextLimit: number,
  overhead: number,
): ContextLimits {
  const effectiveLimit = Math.max(1, contextLimit - overhead);
  return {
    completionBudget: 0,
    limit: contextLimit,
    marginAdjustedLimit: effectiveLimit,
    compressionThreshold: effectiveLimit,
  };
}
