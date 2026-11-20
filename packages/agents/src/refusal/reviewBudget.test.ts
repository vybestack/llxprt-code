/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { REFUSAL_REVIEW_PROMPT } from './reviewPrompt.js';
import {
  REVIEW_INPUT_FRACTION,
  reviewBudgetShortfall,
} from './reviewBudget.js';

describe('refusal review request budget', () => {
  it('includes exact-copy feedback in the context-size check', () => {
    const data = 'Reviewed session data.';
    const feedback =
      'Feedback on your previous answer: preserve every dropped literal exactly.';
    const baseTokens =
      estimateTokens(REFUSAL_REVIEW_PROMPT) + estimateTokens(data);
    const contextLimit = Math.ceil(baseTokens / REVIEW_INPUT_FRACTION);

    expect(reviewBudgetShortfall(data, contextLimit)).toBeUndefined();
    expect(reviewBudgetShortfall(data, contextLimit, feedback)).toStrictEqual({
      requestTokens: baseTokens + estimateTokens(feedback),
      budgetTokens: Math.floor(contextLimit * REVIEW_INPUT_FRACTION),
    });
  });
});
