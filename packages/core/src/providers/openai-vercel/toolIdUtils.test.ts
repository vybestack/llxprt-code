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
  it('should convert hist_tool_xxx to call_xxx', () => {
    expect(normalizeToOpenAIToolId('hist_tool_abc123def456')).toBe(
      'call_abc123def456',
    );
  });

  it('should convert toolu_xxx to call_xxx', () => {
    expect(normalizeToOpenAIToolId('toolu_abc123def456')).toBe(
      'call_abc123def456',
    );
  });

  it('should leave call_xxx unchanged', () => {
    const input = 'call_abc123def456';
    expect(normalizeToOpenAIToolId(input)).toBe(input);
  });

  it('should prefix unknown IDs', () => {
    expect(normalizeToOpenAIToolId('unknown_123')).toBe('call_unknown_123');
  });

  it('should handle empty string', () => {
    expect(normalizeToOpenAIToolId('')).toBe('call_');
  });
});

describe('normalizeToHistoryToolId', () => {
  it('should convert call_xxx to hist_tool_xxx', () => {
    expect(normalizeToHistoryToolId('call_abc123def456')).toBe(
      'hist_tool_abc123def456',
    );
  });

  it('should convert toolu_xxx to hist_tool_xxx', () => {
    expect(normalizeToHistoryToolId('toolu_abc123def456')).toBe(
      'hist_tool_abc123def456',
    );
  });

  it('should leave hist_tool_xxx unchanged', () => {
    const input = 'hist_tool_abc123def456';
    expect(normalizeToHistoryToolId(input)).toBe(input);
  });

  it('should prefix unknown IDs', () => {
    expect(normalizeToHistoryToolId('unknown_123')).toBe(
      'hist_tool_unknown_123',
    );
  });

  it('should handle empty string', () => {
    expect(normalizeToHistoryToolId('')).toBe('hist_tool_');
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

  it('should convert toolu -> call and hist_tool consistently', () => {
    const original = 'toolu_abc123def456';
    const toOpenAI = normalizeToOpenAIToolId(original);
    const toHistory = normalizeToHistoryToolId(original);
    expect(toOpenAI).toBe('call_abc123def456');
    expect(toHistory).toBe('hist_tool_abc123def456');
  });
});
