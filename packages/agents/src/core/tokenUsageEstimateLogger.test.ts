/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  recordFinalizedPromptEnvelopeEstimate,
  resolveEstimatorType,
} from './tokenUsageEstimateLogger.js';

function estimate(
  overrides: Partial<PromptEnvelopeEstimate> = {},
): PromptEnvelopeEstimate {
  return {
    estimatedPromptTokens: 12,
    activeProvider: 'openai',
    model: 'gpt-4o',
    protocol: 'openai-chat',
    method: 'chat/completions/v1',
    estimatorMethod: 'calibrated',
    estimatorFamily: 'legacy-unregistered',
    estimatorVersion: 'core-estimate-tokens-v1',
    assetRevision: 'none',
    projectionRevision: 2,
    unsupportedMedia: [],
    ...overrides,
  };
}

function usageLogger(refineEstimate: ReturnType<typeof vi.fn>, enabled = true) {
  return {
    isEnabled: () => enabled,
    refineEstimate,
  } as Pick<TokenUsageLogger, 'isEnabled' | 'refineEstimate'>;
}

describe('recordFinalizedPromptEnvelopeEstimate', () => {
  it('uses provider provenance for calibrated finalized estimates', () => {
    const refineEstimate = vi.fn();
    recordFinalizedPromptEnvelopeEstimate(
      usageLogger(refineEstimate),
      'prompt-finalized',
      estimate(),
    );

    expect(refineEstimate).toHaveBeenCalledExactlyOnceWith('prompt-finalized', {
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 12,
      estimator: 'openai-tiktoken',
      estimatorMethod: 'calibrated',
      estimatorFamily: 'legacy-unregistered',
      estimatorVersion: 'core-estimate-tokens-v1',
      assetRevision: 'none',
      projectionRevision: 2,
      protocol: 'openai-chat',
    });
  });

  it('labels the registered exact family from estimator provenance', () => {
    const refineEstimate = vi.fn();
    recordFinalizedPromptEnvelopeEstimate(
      usageLogger(refineEstimate),
      'prompt-exact',
      estimate({
        activeProvider: 'codex-alias',
        model: 'gpt-5.6-sol',
        protocol: 'openai-responses',
        method: 'responses/v1',
        estimatorMethod: 'exact',
        estimatorFamily: 'openai-gpt-5.6',
        estimatorVersion: 'gpt-5.6-o200k-v1',
        assetRevision: 'o200k-base-revision',
      }),
    );

    expect(refineEstimate).toHaveBeenCalledWith(
      'prompt-exact',
      expect.objectContaining({
        provider: 'codex-alias',
        estimator: 'openai-tiktoken',
        estimatorMethod: 'exact',
        estimatorFamily: 'openai-gpt-5.6',
        estimatorVersion: 'gpt-5.6-o200k-v1',
        assetRevision: 'o200k-base-revision',
        projectionRevision: 2,
        protocol: 'openai-responses',
      }),
    );
  });

  it('does not mislabel a non-OpenAI exact estimator', () => {
    const refineEstimate = vi.fn();
    recordFinalizedPromptEnvelopeEstimate(
      usageLogger(refineEstimate),
      'prompt-other-exact',
      estimate({
        activeProvider: 'anthropic',
        estimatorMethod: 'exact',
        estimatorFamily: 'anthropic-future-exact',
      }),
    );
    expect(refineEstimate).toHaveBeenCalledWith(
      'prompt-other-exact',
      expect.objectContaining({ estimator: 'anthropic-char' }),
    );
  });

  it.each([
    ['undefined logger', undefined],
    ['null logger', null],
  ])('is a no-op for %s', (_name, logger) => {
    expect(() =>
      recordFinalizedPromptEnvelopeEstimate(
        logger,
        'prompt-no-logger',
        estimate(),
      ),
    ).not.toThrow();
  });

  it('is a no-op when disabled or the estimate is null', () => {
    const refineEstimate = vi.fn();
    recordFinalizedPromptEnvelopeEstimate(
      usageLogger(refineEstimate, false),
      'prompt-disabled',
      estimate(),
    );
    recordFinalizedPromptEnvelopeEstimate(
      usageLogger(refineEstimate),
      'prompt-null',
      null,
    );
    expect(refineEstimate).not.toHaveBeenCalled();
  });

  it('keeps synchronous logger failures from disrupting a valid send', () => {
    let refineCalls = 0;
    const logger = {
      isEnabled: () => true,
      refineEstimate: () => {
        refineCalls += 1;
        throw new Error('refine failed');
      },
    } as Pick<TokenUsageLogger, 'isEnabled' | 'refineEstimate'>;

    expect(() =>
      recordFinalizedPromptEnvelopeEstimate(
        logger,
        'prompt-finalized',
        estimate(),
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
