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
import { normalizeToOpenAIToolId } from './toolIdNormalization.js';

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
});
