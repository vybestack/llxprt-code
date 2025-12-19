/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildToolResponsePayload,
  EMPTY_TOOL_RESULT_PLACEHOLDER,
} from './toolResponsePayload.js';
import type { ToolResponseBlock } from '../../services/history/IContent.js';
import type { Config } from '../../config/config.js';

describe('toolResponsePayload', () => {
  describe('buildToolResponsePayload respects configurable limits', () => {
    let mockConfig: Config;

    beforeEach(() => {
      mockConfig = {
        getEphemeralSettings: vi.fn().mockReturnValue({
          'tool-output-max-tokens': 50000,
          'tool-output-truncate-mode': 'warn',
        }),
      } as unknown as Config;
    });

    it('should NOT truncate tool response to 1024 chars when config allows larger output', () => {
      // Issue #894: hardcoded MAX_TOOL_RESPONSE_CHARS = 1024 bypasses configurable limits
      // A 2000 char string should NOT be truncated to 1024 when the config allows 50000 tokens
      const largeResult = 'x'.repeat(2000);
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: largeResult,
      };

      const payload = buildToolResponsePayload(block, mockConfig);

      // The result should be at least 2000 chars (not truncated to 1024)
      expect(payload.result.length).toBeGreaterThanOrEqual(2000);
      expect(payload.truncated).toBeFalsy();
    });

    it('should NOT apply secondary 512 char truncation to text results', () => {
      // Issue #894: hardcoded MAX_TOOL_RESPONSE_TEXT_CHARS = 512 further truncates text
      const textResult = 'hello world '.repeat(100); // ~1200 chars
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: textResult,
      };

      const payload = buildToolResponsePayload(block, mockConfig);

      // The result should NOT be truncated to 512 chars
      expect(payload.result.length).toBeGreaterThan(512);
    });

    it('should pass through the token-limited output from toolOutputLimiter', () => {
      // When toolOutputLimiter returns content within limits, it should pass through unchanged
      const mediumResult = 'test content '.repeat(50); // ~650 chars
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: mediumResult,
      };

      const payload = buildToolResponsePayload(block, mockConfig);

      // Should contain the full content without arbitrary truncation
      expect(payload.result).toContain('test content');
      expect(payload.result.length).toBeGreaterThanOrEqual(mediumResult.length);
    });

    it('should only apply unicode sanitization, not char-based truncation', () => {
      // Unicode characters should be sanitized but length should be preserved
      const unicodeResult = '𝒯𝑒𝓈𝓉 '.repeat(200); // Unicode text
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: unicodeResult,
      };

      const payload = buildToolResponsePayload(block, mockConfig);

      // Should not truncate based on char count when within token limits
      expect(payload.truncated).toBeFalsy();
    });
  });

  describe('buildToolResponsePayload without config', () => {
    it('should still handle results gracefully without arbitrary truncation', () => {
      // Even without config, shouldn't apply super-restrictive 1024 char limit
      // Instead should use toolOutputLimiter defaults (50000 tokens)
      const largeResult = 'y'.repeat(3000);
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: largeResult,
      };

      // Without config, the function should still not arbitrarily truncate to 1024
      const payload = buildToolResponsePayload(block);

      // At minimum, should allow more than 1024 chars
      expect(payload.result.length).toBeGreaterThan(1024);
    });
  });

  describe('edge cases', () => {
    it('should handle empty results', () => {
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: '',
      };

      const payload = buildToolResponsePayload(block);

      expect(payload.result).toBe(EMPTY_TOOL_RESULT_PLACEHOLDER);
    });

    it('should handle null/undefined results', () => {
      const block: ToolResponseBlock = {
        type: 'tool_response',
        toolUseId: 'test-id',
        toolName: 'test_tool',
        result: undefined,
      };

      const payload = buildToolResponsePayload(block);

      expect(payload.result).toBe(EMPTY_TOOL_RESULT_PLACEHOLDER);
    });
  });
});
