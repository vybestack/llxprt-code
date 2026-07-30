/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { estimateRequestTokensStructured } from './clientHelpers.js';

vi.mock('./clientHelpers.js', () => ({
  estimateRequestTokensStructured: vi.fn(),
}));

import {
  estimateStructuredTokensOrFallback,
  recordFinalizedPromptEnvelopeEstimate,
  recordTokenEstimate,
  resolveEstimatorType,
} from './tokenUsageEstimateLogger.js';

describe('recordTokenEstimate', () => {
  beforeEach(() => {
    vi.mocked(estimateRequestTokensStructured).mockReset();
  });

  it('provides a conservative numeric fallback for preflight failures', () => {
    vi.mocked(estimateRequestTokensStructured).mockImplementation(() => {
      throw new Error('structured estimation failed');
    });
    expect(estimateStructuredTokensOrFallback([], 42)).toBe(42);
  });

  it('distinguishes a failed tiktoken baseline from a real zero-token estimate', () => {
    vi.mocked(estimateRequestTokensStructured).mockImplementation(() => {
      throw new Error('structured estimation failed');
    });
    const recordEstimate = vi.fn();
    const usageLogger = {
      isEnabled: () => true,
      recordEstimate,
    } as Pick<TokenUsageLogger, 'isEnabled' | 'recordEstimate'>;

    recordTokenEstimate(
      { getTokenUsageLogger: () => usageLogger },
      'prompt-1',
      [],
      0,
      'openai',
      'gpt-4',
    );

    expect(recordEstimate).toHaveBeenCalledWith(
      'prompt-1',
      expect.objectContaining({
        tiktokenTokens: null,
        tiktokenEstimationFailed: true,
      }),
    );
  });

  it('records successful structured estimates and normalizes provider names', () => {
    vi.mocked(estimateRequestTokensStructured).mockReturnValue(42);
    const recordEstimate = vi.fn();
    const usageLogger = {
      isEnabled: () => true,
      recordEstimate,
    } as Pick<TokenUsageLogger, 'isEnabled' | 'recordEstimate'>;

    recordTokenEstimate(
      { getTokenUsageLogger: () => usageLogger },
      'prompt-2',
      [{ text: 'hello' }],
      10,
      'OpenAI',
      'gpt-4',
    );

    expect(recordEstimate).toHaveBeenCalledExactlyOnceWith('prompt-2', {
      provider: 'OpenAI',
      model: 'gpt-4',
      estimatedTokens: 10,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 42,
      tiktokenEstimationFailed: false,
    });
  });

  it('skips disabled and missing usage loggers', () => {
    const recordEstimate = vi.fn();
    const usageLogger = {
      isEnabled: () => false,
      recordEstimate,
    } as Pick<TokenUsageLogger, 'isEnabled' | 'recordEstimate'>;

    recordTokenEstimate(undefined, 'prompt-3', [], 0, 'openai', 'gpt-4');
    recordTokenEstimate(
      { getTokenUsageLogger: () => undefined },
      'prompt-4',
      [],
      0,
      'openai',
      'gpt-4',
    );
    recordTokenEstimate(
      { getTokenUsageLogger: () => usageLogger },
      'prompt-5',
      [],
      0,
      'openai',
      'gpt-4',
    );

    expect(recordEstimate).not.toHaveBeenCalled();
  });

  it('keeps logger failures from disrupting request processing', () => {
    vi.mocked(estimateRequestTokensStructured).mockReturnValue(1);
    expect(() =>
      recordTokenEstimate(
        {
          getTokenUsageLogger: () => ({
            isEnabled: () => true,
            recordEstimate: () => {
              throw new Error('record failed');
            },
          }),
        },
        'prompt-6',
        [],
        1,
        'openai',
        'gpt-4',
      ),
    ).not.toThrow();
  });
});

describe('recordFinalizedPromptEnvelopeEstimate', () => {
  it('keeps synchronous logger failures from disrupting a valid send', () => {
    const usageLogger = {
      isEnabled: () => true,
      recordEstimate: () => {
        throw new Error('record failed');
      },
    } as Pick<TokenUsageLogger, 'isEnabled' | 'recordEstimate'>;

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
  });
});

describe('resolveEstimatorType', () => {
  it('normalizes provider name casing', () => {
    expect(resolveEstimatorType('Anthropic')).toBe('anthropic-char');
    expect(resolveEstimatorType('OpenAI')).toBe('openai-tiktoken');
  });
});
