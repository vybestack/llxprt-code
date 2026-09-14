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
 * Tests for tool ID normalization in OpenAIResponsesProvider
 */

import { describe, it, expect } from 'bun:test';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

describe('Tool ID Normalization for OpenAI Responses API', () => {
  describe('normalizeToOpenAIToolId utility function', () => {
    it('should normalize hist_tool_XXX format to call_XXX format', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc123def456');
      expect(result).toBe('call_abc123def456');
    });

    it('should handle unknown format IDs by prefixing with call_', () => {
      const result = normalizeToOpenAIToolId('unknown_abc123def456');
      expect(result).toBe('call_unknown_abc123def456');
    });

    it('should preserve call_XXX format IDs unchanged', () => {
      const result = normalizeToOpenAIToolId('call_abc123def456');
      expect(result).toBe('call_abc123def456');
    });
  });
});
