/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { TokenUsageLogger } from './TokenUsageLogger.js';

import {
  recordFinalizedPromptEnvelopeEstimate,
  resolveEstimatorType,
} from './tokenUsageEstimateLogger.js';

describe('recordFinalizedPromptEnvelopeEstimate', () => {
  it('refines the existing prompt estimate with the finalized envelope count', () => {
    const refineEstimate = vi.fn();
    const usageLogger = {
      isEnabled: () => true,
      refineEstimate,
    } as Pick<TokenUsageLogger, 'isEnabled' | 'refineEstimate'>;

    recordFinalizedPromptEnvelopeEstimate(
      usageLogger,
      'prompt-finalized',
      {
        estimatedPromptTokens: 12,
        model: 'gpt-4o',
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 2,
        unsupportedMedia: [],
      },
      'openai',
    );

    expect(refineEstimate).toHaveBeenCalledExactlyOnceWith('prompt-finalized', {
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 12,
      estimator: 'openai-tiktoken',
    });
  });

  it('keeps synchronous logger failures from disrupting a valid send', () => {
    let refineCalls = 0;
    const usageLogger = {
      isEnabled: () => true,
      refineEstimate: () => {
        refineCalls += 1;
        throw new Error('refine failed');
      },
    } as Pick<TokenUsageLogger, 'isEnabled' | 'refineEstimate'>;

    expect(() =>
      recordFinalizedPromptEnvelopeEstimate(
        usageLogger,
        'prompt-finalized',
        {
          estimatedPromptTokens: 12,
          model: 'gpt-4o',
          protocol: 'openai-chat',
          method: 'chat/completions/v1',
          projectionRevision: 2,
          unsupportedMedia: [],
        },
        'openai',
      ),
    ).not.toThrow();
    expect(refineCalls).toBe(1);
  });
});

describe('resolveEstimatorType', () => {
  it('normalizes provider name casing', () => {
    expect(resolveEstimatorType('Anthropic')).toBe('anthropic-char');
    expect(resolveEstimatorType('OpenAI')).toBe('openai-tiktoken');
  });
});
