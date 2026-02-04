/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  estimateTokens,
  getOutputLimits,
  limitOutputTokens,
  formatLimitedOutput,
  clipMiddle,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TRUNCATE_MODE,
} from './toolOutputLimiter.js';
import { Config } from '../config/config.js';

describe('toolOutputLimiter', () => {
  let mockConfig: {
    getEphemeralSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConfig = {
      getEphemeralSettings: vi.fn().mockReturnValue({}),
    };
  });

  describe('estimateTokens', () => {
    it('should estimate tokens using tiktoken for gpt-4o', () => {
      expect(estimateTokens('hello')).toBe(1); // 'hello' is 1 token in gpt-4o
      expect(estimateTokens('hello world')).toBe(2); // 'hello world' is 2 tokens in gpt-4o
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('a'.repeat(100))).toBeLessThan(50); // Should be much less than char count due to tokenization
    });
  });

  describe('clipMiddle', () => {
    it('should not truncate when content is within maxChars', () => {
      const content = 'hello world';
      const result = clipMiddle(content, 100, 0.3, 0.7);
      expect(result).toEqual({
        content,
        wasTruncated: false,
        originalLength: content.length,
      });
    });

    it('should remove middle and keep head and tail with marker', () => {
      const content = `HEAD
${'X'.repeat(200)}
TAIL`;
      const result = clipMiddle(content, 60, 0.3, 0.7);

      expect(result.wasTruncated).toBe(true);
      expect(result.originalLength).toBe(content.length);
      expect(result.content).toContain('HEAD');
      expect(result.content).toContain('TAIL');
      expect(result.content).toContain(
        '...[middle clipped due to token limits]...',
      );
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content.length).toBeLessThan(content.length);
    });

    it('should handle zero/negative ratios by still producing valid output', () => {
      const content = 'A'.repeat(200);
      const result = clipMiddle(content, 50, 0, 0);
      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain(
        '...[middle clipped due to token limits]...',
      );
    });
  });

  describe('getOutputLimits', () => {
    it('should return default values when no settings are provided', () => {
      const limits = getOutputLimits(mockConfig as unknown as Config);
      expect(limits).toEqual({
        maxTokens: DEFAULT_MAX_TOKENS,
        truncateMode: DEFAULT_TRUNCATE_MODE,
      });
    });

    it('should return configured values from ephemeral settings', () => {
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-max-tokens': 75000,
        'tool-output-truncate-mode': 'truncate',
      });

      const limits = getOutputLimits(mockConfig as unknown as Config);
      expect(limits).toEqual({
        maxTokens: 75000,
        truncateMode: 'truncate',
      });
    });

    it('should handle partial settings', () => {
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-max-tokens': 100000,
        // truncateMode not set
      });

      const limits = getOutputLimits(mockConfig as unknown as Config);
      expect(limits).toEqual({
        maxTokens: 100000,
        truncateMode: DEFAULT_TRUNCATE_MODE,
      });
    });
  });

  describe('limitOutputTokens', () => {
    it('should not truncate content within limits', () => {
      const content = 'This is a short message';
      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result).toEqual({
        content,
        wasTruncated: false,
      });
    });

    it('should warn when content exceeds limit in warn mode', () => {
      // Create content with many unique words to avoid token compression
      const words = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(
        ' ',
      );
      const content = words.repeat(10); // This should exceed the effective limit
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-truncate-mode': 'warn',
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toBe('');
      expect(result.message).toContain('test-tool output exceeded token limit');
      expect(result.message).toContain(
        'The results were found but are too large to display',
      );
      expect(result.message).toContain(
        'Use more specific search patterns or file paths to narrow results',
      );
    });

    it('should truncate content in truncate mode', () => {
      // Create content with many unique words to avoid token compression
      const words = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(
        ' ',
      );
      const content = words.repeat(10); // This should exceed the effective limit
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-truncate-mode': 'truncate',
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result.wasTruncated).toBe(true);
      expect(result.content.length).toBeLessThan(content.length);
      expect(result.content).toContain('[Output truncated due to token limit]');
      expect(result.message).toContain('Output truncated from');
      expect(result.message).toContain('to');
      expect(result.message).toContain('tokens');
    });

    it('should sample lines in sample mode', () => {
      // Create enough lines to exceed the limit without making the test slow
      const lines = Array.from(
        { length: 80 },
        (_, i) =>
          `Line number ${i} with some additional content to exercise sampling behavior`,
      );
      const content = lines.join('\n');
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-truncate-mode': 'sample',
        'tool-output-max-tokens': 200, // Force sampling on smaller content set
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('[Sampled');
      expect(result.content).toContain('of 80 lines due to token limit]');
      expect(result.content.split('\n').length).toBeLessThan(80);
    });

    it('should handle single line content in sample mode', () => {
      // Create single line with many unique words to avoid token compression
      const words = Array.from({ length: 50000 }, (_, i) => `word${i}`).join(
        ' ',
      );
      const content = words; // Single line, over effective limit with gpt-4o tokenization
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-truncate-mode': 'sample',
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      // Should fall back to truncate behavior for single lines
      expect(result.wasTruncated).toBe(true);
      expect(result.content.length).toBeLessThan(content.length);
      expect(result.content).toContain('[Output truncated due to token limit]');
      expect(result.message).toContain('Output truncated from');
      expect(result.message).toContain('to');
      expect(result.message).toContain('tokens');
    });

    it('should respect custom max tokens setting', () => {
      const content = 'a'.repeat(1000); // 250 tokens
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-max-tokens': 100,
        'tool-output-truncate-mode': 'warn',
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toBe('');
      // Updated expectation: check for the new generic message content instead of specific numbers
      expect(result.message).toContain('test-tool output exceeded token limit');
      expect(result.message).toContain(
        'The results were found but are too large to display',
      );
      expect(result.message).toContain(
        'Use more specific search patterns or file paths to narrow results',
      );
    });
  });

  describe('formatLimitedOutput', () => {
    it('should pass through non-truncated content', () => {
      const result = formatLimitedOutput({
        content: 'Normal content',
        wasTruncated: false,
      });

      expect(result).toEqual({
        llmContent: 'Normal content',
        returnDisplay: 'Normal content',
      });
    });

    it('should format warn mode output', () => {
      const result = formatLimitedOutput({
        content: '',
        wasTruncated: true,
        message: 'Tool output exceeded limit',
      });

      expect(result).toEqual({
        llmContent: 'Tool output exceeded limit',
        returnDisplay: '## Token Limit Exceeded\n\nTool output exceeded limit',
      });
    });

    it('should format truncated output with message', () => {
      const result = formatLimitedOutput({
        content: 'Truncated content...',
        wasTruncated: true,
        message: 'Output was truncated',
      });

      expect(result).toEqual({
        llmContent: 'Truncated content...',
        returnDisplay: 'Truncated content...\n\n## Note\nOutput was truncated',
      });
    });

    it('should handle truncated output without message', () => {
      const result = formatLimitedOutput({
        content: 'Truncated content...',
        wasTruncated: true,
      });

      expect(result).toEqual({
        llmContent: 'Truncated content...',
        returnDisplay: 'Truncated content...',
      });
    });
  });
});
