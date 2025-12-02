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
 * @plan PLAN-20251127-OPENAIVERCEL.P04
 * @requirement REQ-OV-004
 * @description Tests for tool ID normalization utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from './toolIdUtils';

describe('normalizeToOpenAIToolId', () => {
  describe('standard conversions', () => {
    it('should convert hist_tool_xxx to call_xxx', () => {
      const input = 'hist_tool_abc123def456';
      const expected = 'call_abc123def456';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should convert toolu_xxx (Anthropic format) to call_xxx', () => {
      const input = 'toolu_abc123def456';
      const expected = 'call_abc123def456';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should leave call_xxx unchanged', () => {
      const input = 'call_abc123def456';
      expect(normalizeToOpenAIToolId(input)).toBe(input);
    });
  });

  describe('UUID handling', () => {
    it('should add call_ prefix to raw UUIDs', () => {
      const uuid = '550e8400e29b41d4a716446655440000';
      const expected = 'call_550e8400e29b41d4a716446655440000';
      expect(normalizeToOpenAIToolId(uuid)).toBe(expected);
    });

    it('should handle UUIDs with dashes by sanitizing them', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const expected = 'call_550e8400e29b41d4a716446655440000';
      expect(normalizeToOpenAIToolId(uuid)).toBe(expected);
    });
  });

  describe('special character sanitization', () => {
    it('should remove non-alphanumeric characters from hist_tool_ IDs', () => {
      const input = 'hist_tool_abc-123-def';
      const expected = 'call_abc123def';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should remove non-alphanumeric characters from toolu_ IDs', () => {
      const input = 'toolu_abc-123-def';
      const expected = 'call_abc123def';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should remove non-alphanumeric characters from call_ IDs', () => {
      const input = 'call_abc-123-def';
      const expected = 'call_abc123def';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should handle IDs with special characters like dots and slashes', () => {
      const input = 'hist_tool_abc.123/def';
      const expected = 'call_abc123def';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = normalizeToOpenAIToolId('');
      expect(result).toMatch(/^call_[a-z0-9]+$/);
    });

    it('should handle string with only prefix', () => {
      const result = normalizeToOpenAIToolId('hist_tool_');
      expect(result).toMatch(/^call_[a-z0-9]+$/);
    });

    it('should handle string with only special characters after prefix', () => {
      const result = normalizeToOpenAIToolId('hist_tool_---');
      expect(result).toMatch(/^call_[a-z0-9]+$/);
    });

    it('should preserve underscores in the ID portion', () => {
      const input = 'hist_tool_abc_123_def';
      const expected = 'call_abc_123_def';
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });
  });

  describe('complex scenarios', () => {
    it('should handle very long IDs', () => {
      const longId = 'a'.repeat(100);
      const input = `hist_tool_${longId}`;
      const expected = `call_${longId}`;
      expect(normalizeToOpenAIToolId(input)).toBe(expected);
    });

    it('should handle mixed prefix formats consistently', () => {
      expect(normalizeToOpenAIToolId('hist_tool_123')).toBe('call_123');
      expect(normalizeToOpenAIToolId('toolu_123')).toBe('call_123');
      expect(normalizeToOpenAIToolId('call_123')).toBe('call_123');
    });
  });
});

describe('normalizeToHistoryToolId', () => {
  describe('standard conversions', () => {
    it('should convert call_xxx to hist_tool_xxx', () => {
      const input = 'call_abc123def456';
      const expected = 'hist_tool_abc123def456';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should convert toolu_xxx (Anthropic format) to hist_tool_xxx', () => {
      const input = 'toolu_abc123def456';
      const expected = 'hist_tool_abc123def456';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should leave hist_tool_xxx unchanged', () => {
      const input = 'hist_tool_abc123def456';
      expect(normalizeToHistoryToolId(input)).toBe(input);
    });
  });

  describe('UUID handling', () => {
    it('should add hist_tool_ prefix to raw UUIDs', () => {
      const uuid = '550e8400e29b41d4a716446655440000';
      const expected = 'hist_tool_550e8400e29b41d4a716446655440000';
      expect(normalizeToHistoryToolId(uuid)).toBe(expected);
    });

    it('should handle UUIDs with dashes', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const expected = 'hist_tool_550e8400e29b41d4a716446655440000';
      expect(normalizeToHistoryToolId(uuid)).toBe(expected);
    });
  });

  describe('special character sanitization', () => {
    it('should remove non-alphanumeric characters from call_ IDs', () => {
      const input = 'call_abc-123-def';
      const expected = 'hist_tool_abc123def';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should remove non-alphanumeric characters from toolu_ IDs', () => {
      const input = 'toolu_abc-123-def';
      const expected = 'hist_tool_abc123def';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should remove non-alphanumeric characters from hist_tool_ IDs', () => {
      const input = 'hist_tool_abc-123-def';
      const expected = 'hist_tool_abc123def';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should handle IDs with special characters like dots and slashes', () => {
      const input = 'call_abc.123/def';
      const expected = 'hist_tool_abc123def';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = normalizeToHistoryToolId('');
      expect(result).toMatch(/^hist_tool_[a-z0-9]+$/);
    });

    it('should handle string with only prefix', () => {
      const result = normalizeToHistoryToolId('call_');
      expect(result).toMatch(/^hist_tool_[a-z0-9]+$/);
    });

    it('should handle string with only special characters after prefix', () => {
      const result = normalizeToHistoryToolId('call_---');
      expect(result).toMatch(/^hist_tool_[a-z0-9]+$/);
    });

    it('should preserve underscores in the ID portion', () => {
      const input = 'call_abc_123_def';
      const expected = 'hist_tool_abc_123_def';
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });
  });

  describe('complex scenarios', () => {
    it('should handle very long IDs', () => {
      const longId = 'a'.repeat(100);
      const input = `call_${longId}`;
      const expected = `hist_tool_${longId}`;
      expect(normalizeToHistoryToolId(input)).toBe(expected);
    });

    it('should handle mixed prefix formats consistently', () => {
      expect(normalizeToHistoryToolId('call_123')).toBe('hist_tool_123');
      expect(normalizeToHistoryToolId('toolu_123')).toBe('hist_tool_123');
      expect(normalizeToHistoryToolId('hist_tool_123')).toBe('hist_tool_123');
    });
  });
});

describe('round-trip conversions', () => {
  it('should maintain identity when converting hist_tool -> call -> hist_tool', () => {
    const original = 'hist_tool_abc123def456';
    const toOpenAI = normalizeToOpenAIToolId(original);
    const backToHistory = normalizeToHistoryToolId(toOpenAI);
    expect(backToHistory).toBe(original);
  });

  it('should convert call -> hist_tool -> call consistently', () => {
    const original = 'call_abc123def456';
    const toHistory = normalizeToHistoryToolId(original);
    const backToOpenAI = normalizeToOpenAIToolId(toHistory);
    expect(backToOpenAI).toBe(original);
  });

  it('should handle Anthropic format in round-trip', () => {
    const anthropic = 'toolu_abc123def456';
    const toOpenAI = normalizeToOpenAIToolId(anthropic);
    expect(toOpenAI).toBe('call_abc123def456');

    const toHistory = normalizeToHistoryToolId(anthropic);
    expect(toHistory).toBe('hist_tool_abc123def456');
  });
});
