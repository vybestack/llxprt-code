/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Unit tests for toolIdNormalization utility
 * @issue https://github.com/vybestack/llxprt-code/issues/825
 */

import { describe, it, expect } from 'vitest';
import { normalizeToOpenAIToolId } from './toolIdNormalization.js';

describe('normalizeToOpenAIToolId', () => {
  describe('OpenAI format (call_XXX)', () => {
    it('should preserve call_XXX format unchanged', () => {
      expect(normalizeToOpenAIToolId('call_abc123')).toBe('call_abc123');
    });

    it('should preserve complex call_XXX IDs', () => {
      expect(normalizeToOpenAIToolId('call_mEwqq4nEsxpmHnqnkChAG7KS')).toBe(
        'call_mEwqq4nEsxpmHnqnkChAG7KS',
      );
    });

    it('should sanitize call_XXX IDs with invalid characters', () => {
      const result = normalizeToOpenAIToolId('call_abc-123-def');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('-');
    });
  });

  describe('History format (hist_tool_XXX)', () => {
    it('should convert hist_tool_XXX to call_XXX format', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc123def456');
      expect(result).toBe('call_abc123def456');
    });

    it('should handle hist_tool IDs with hyphens', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc-123-def-456');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('-');
      expect(result).toBe('call_abc123def456');
    });

    it('should handle the exact ID format from issue #825', () => {
      const result = normalizeToOpenAIToolId(
        'hist_tool_mEwqq4nEsxpmHnqnkChAG7KS',
      );
      expect(result).toBe('call_mEwqq4nEsxpmHnqnkChAG7KS');
    });

    it('should generate new ID for empty suffix', () => {
      const result = normalizeToOpenAIToolId('hist_tool_');
      expect(result).toMatch(/^call_/);
      expect(result.length).toBeGreaterThan('call_'.length);
    });

    it('should generate new ID for suffix with only invalid chars', () => {
      const result = normalizeToOpenAIToolId('hist_tool_---');
      expect(result).toMatch(/^call_/);
      expect(result.length).toBeGreaterThan('call_'.length);
    });
  });

  describe('Anthropic format (toolu_XXX)', () => {
    it('should convert toolu_XXX to call_XXX format', () => {
      const result = normalizeToOpenAIToolId('toolu_abc123def456');
      expect(result).toBe('call_abc123def456');
    });

    it('should handle toolu IDs with underscores', () => {
      const result = normalizeToOpenAIToolId('toolu_abc_123_def');
      expect(result).toBe('call_abc_123_def');
    });

    it('should generate new ID for empty suffix', () => {
      const result = normalizeToOpenAIToolId('toolu_');
      expect(result).toMatch(/^call_/);
      expect(result.length).toBeGreaterThan('call_'.length);
    });
  });

  describe('Unknown formats', () => {
    it('should prefix unknown format with call_', () => {
      const result = normalizeToOpenAIToolId('unknown_abc123');
      expect(result).toBe('call_unknown_abc123');
    });

    it('should handle plain alphanumeric IDs', () => {
      const result = normalizeToOpenAIToolId('abc123');
      expect(result).toBe('call_abc123');
    });

    it('should sanitize and prefix IDs with special characters', () => {
      const result = normalizeToOpenAIToolId('my-tool-id-123');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('-');
    });
  });

  describe('Consistency', () => {
    it('should produce consistent results for the same input', () => {
      const id = 'hist_tool_cancelledXYZ789';
      const result1 = normalizeToOpenAIToolId(id);
      const result2 = normalizeToOpenAIToolId(id);
      expect(result1).toBe(result2);
    });

    it('should produce matching IDs for tool_call and tool_response', () => {
      const toolCallId = 'hist_tool_abc123';
      const toolResponseCallId = 'hist_tool_abc123';
      expect(normalizeToOpenAIToolId(toolCallId)).toBe(
        normalizeToOpenAIToolId(toolResponseCallId),
      );
    });

    it('should be deterministic - same input always produces same output', () => {
      const testCases = [
        '',
        '!!!@@@###',
        'hist_tool_',
        'toolu_',
        'call_',
        'hist_tool_abc123',
        'toolu_xyz789',
        'random_id',
      ];

      for (const input of testCases) {
        const result1 = normalizeToOpenAIToolId(input);
        const result2 = normalizeToOpenAIToolId(input);
        const result3 = normalizeToOpenAIToolId(input);
        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
      }
    });

    it('should generate consistent fallback IDs for edge cases across multiple calls', () => {
      // These edge cases require fallback ID generation
      const edgeCases = ['', 'hist_tool_', 'toolu_', '!@#$%'];

      for (const input of edgeCases) {
        const results = new Set<string>();
        for (let i = 0; i < 10; i++) {
          results.add(normalizeToOpenAIToolId(input));
        }
        // All 10 calls should produce the exact same result
        expect(results.size).toBe(1);
      }
    });
  });
});
