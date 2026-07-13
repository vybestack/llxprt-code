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

    expect(recordEstimate).toHaveBeenCalledWith(
      'prompt-2',
      expect.objectContaining({
        estimator: 'openai-tiktoken',
        tiktokenTokens: 42,
        tiktokenEstimationFailed: false,
      }),
    );
    expect(resolveEstimatorType('Anthropic')).toBe('anthropic-char');
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
});
