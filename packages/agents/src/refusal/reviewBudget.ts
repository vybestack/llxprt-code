/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveEffectiveContextLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { REFUSAL_REVIEW_PROMPT } from './reviewPrompt.js';

/**
 * Share of the reviewer's context window the review request may fill. A
 * rewrite returns the full replacement text of each entry it changes, so the
 * answer can be as long as the editable entries and needs room of its own.
 */
export const REVIEW_INPUT_FRACTION = 0.6;

export interface ReviewBudgetShortfall {
  readonly requestTokens: number;
  readonly budgetTokens: number;
}

/**
 * Whether the review request fits the reviewer's context window. Entries are
 * never clipped to make it fit, because a rewrite replaces an entry's full
 * text and a clipped view could lead to a replacement that drops content.
 * Returns the shortfall when it does not fit.
 */
export function reviewBudgetShortfall(
  data: string,
  contextLimit: number,
): ReviewBudgetShortfall | undefined {
  const requestTokens =
    estimateTokens(REFUSAL_REVIEW_PROMPT) + estimateTokens(data);
  const budgetTokens = Math.floor(contextLimit * REVIEW_INPUT_FRACTION);
  return requestTokens > budgetTokens
    ? { requestTokens, budgetTokens }
    : undefined;
}

/** The reviewer's context window, by the same precedence the session uses. */
export function reviewerContextLimit(input: {
  readonly model: string;
  readonly profileLimit: unknown;
  readonly providerLimit: number | undefined;
}): number {
  return resolveEffectiveContextLimit(
    input.model,
    typeof input.profileLimit === 'number' ? input.profileLimit : undefined,
    input.providerLimit,
  );
}
