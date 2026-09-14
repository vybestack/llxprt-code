/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_MAX_TOKENS,
  estimateTokens,
  limitOutputTokens,
} from './toolOutputLimiter.js';

describe('limitOutputTokens', () => {
  it.each([false, '', 0, NaN, 'abc'])(
    'passes over-limit content through when the setting is %s',
    (raw) => {
      const content = 'word '.repeat(40000);
      const config = {
        getEphemeralSettings: () => ({ 'tool-output-max-tokens': raw }),
      };
      expect(estimateTokens(content)).toBeGreaterThan(DEFAULT_MAX_TOKENS);

      const result = limitOutputTokens(content, config, 'test-tool');

      expect(result).toStrictEqual({ content, wasTruncated: false });
    },
  );

  it('warns when content exceeds the effective numeric limit', () => {
    const content = 'x'.repeat(300);
    const config = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 100,
        'tool-output-truncate-mode': 'warn',
      }),
    };

    const result = limitOutputTokens(content, config, 'test-tool');

    expect(result.wasTruncated).toBe(true);
    expect(result.content).toBe('');
    expect(result.originalTokens).toBe(100);
    expect(result.message).toContain(
      'test-tool output exceeded token limit (100 > 80)',
    );
  });
});
