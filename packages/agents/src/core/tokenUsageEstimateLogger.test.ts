/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { TokenUsageLogger } from './TokenUsageLogger.js';

vi.mock('./clientHelpers.js', () => ({
  estimateRequestTokensStructured: vi.fn(() => {
    throw new Error('structured estimation failed');
  }),
}));

import { recordTokenEstimate } from './tokenUsageEstimateLogger.js';

describe('recordTokenEstimate', () => {
  it('distinguishes a failed tiktoken baseline from a real zero-token estimate', () => {
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
});
