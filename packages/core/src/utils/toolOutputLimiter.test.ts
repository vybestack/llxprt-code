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
    it('should estimate tokens as roughly 1/4 of characters', () => {
      expect(estimateTokens('hello')).toBe(2); // 5 chars / 4 = 1.25, ceil = 2
      expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75, ceil = 3
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('a'.repeat(100))).toBe(25); // 100 / 4 = 25
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
      const content = 'a'.repeat(250000); // Way over default 50k token limit
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
      expect(result.message).toContain('62500 > 50000');
    });

    it('should truncate content in truncate mode', () => {
      const content = 'a'.repeat(250000); // Way over default 50k token limit
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
      expect(result.originalTokens).toBe(62500);
    });

    it('should sample lines in sample mode', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const content = lines.join('\n');
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-truncate-mode': 'sample',
        'tool-output-max-tokens': 1000, // Very small limit
      });

      const result = limitOutputTokens(
        content,
        mockConfig as unknown as Config,
        'test-tool',
      );

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('[Sampled');
      expect(result.content).toContain('of 1000 lines due to token limit]');
      expect(result.content.split('\n').length).toBeLessThan(1000);
    });

    it('should handle single line content in sample mode', () => {
      const content = 'a'.repeat(250000); // Single line, way over limit
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
      expect(result.message).toContain('250 > 100');
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
