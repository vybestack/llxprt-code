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
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from './toolIdNormalization.js';

describe('normalizeToOpenAIToolId', () => {
  it('preserves call_ format unchanged', () => {
    expect(normalizeToOpenAIToolId('call_abc123def456')).toBe(
      'call_abc123def456',
    );
  });

  it('converts hist_tool_XXX to call_XXX format', () => {
    expect(normalizeToOpenAIToolId('hist_tool_abc123def456')).toBe(
      'call_abc123def456',
    );
  });

  it('converts toolu_XXX to call_XXX format', () => {
    expect(normalizeToOpenAIToolId('toolu_abc123def456')).toBe(
      'call_abc123def456',
    );
  });

  it('prefixes unknown formats with call_', () => {
    expect(normalizeToOpenAIToolId('unknown_abc123')).toBe(
      'call_unknown_abc123',
    );
  });

  it('strips history prefix for canonical IDs', () => {
    expect(normalizeToOpenAIToolId('hist_tool_cancelledXYZ789')).toBe(
      'call_cancelledXYZ789',
    );
  });

  it('returns call_ for empty input', () => {
    expect(normalizeToOpenAIToolId('')).toBe('call_');
  });

  it('sanitizes invalid characters in suffix', () => {
    expect(normalizeToOpenAIToolId('call_abc.123')).toBe('call_abc123');
  });
});

describe('normalizeToHistoryToolId', () => {
  it('preserves hist_tool_ format', () => {
    expect(normalizeToHistoryToolId('hist_tool_abc123')).toBe(
      'hist_tool_abc123',
    );
  });

  it('converts call_XXX to hist_tool_XXX', () => {
    expect(normalizeToHistoryToolId('call_abc123')).toBe('hist_tool_abc123');
  });

  it('converts toolu_XXX to hist_tool_XXX', () => {
    expect(normalizeToHistoryToolId('toolu_abc123')).toBe('hist_tool_abc123');
  });

  it('prefixes unknown formats with hist_tool_', () => {
    expect(normalizeToHistoryToolId('unknown_abc')).toBe(
      'hist_tool_unknown_abc',
    );
  });

  it('returns hist_tool_ for empty input', () => {
    expect(normalizeToHistoryToolId('')).toBe('hist_tool_');
  });

  it('sanitizes invalid characters in suffix', () => {
    expect(normalizeToHistoryToolId('call_abc.123')).toBe('hist_tool_abc123');
  });
});
