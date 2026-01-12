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

import { describe, it, expect } from 'vitest';
import type { IContent } from '../../../services/history/IContent.js';
import { normalizeToOpenAIToolId } from '../../utils/toolIdNormalization.js';
import { buildResponsesInputFromContent } from '../buildResponsesInputFromContent.js';

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

  describe('buildResponsesInputFromContent integration', () => {
    it('should normalize hist_tool IDs in function_call and function_call_output items', () => {
      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Create a file' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_abc123def456',
              name: 'write_file',
              parameters: { path: '/test.txt', content: 'hello' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_abc123def456',
              result: 'File created successfully',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What did you do?' }],
        },
      ];

      const input = buildResponsesInputFromContent(content);

      const functionCallItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call',
      ) as { type: string; call_id: string } | undefined;

      const functionCallOutputItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call_output',
      ) as { type: string; call_id: string } | undefined;

      expect(functionCallItem?.call_id).toBe('call_abc123def456');
      expect(functionCallOutputItem?.call_id).toBe('call_abc123def456');
    });

    it('should normalize unknown format IDs in function_call and function_call_output items', () => {
      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Create a file' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'unknown_xyz789',
              name: 'write_file',
              parameters: { path: '/test.txt', content: 'hello' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'unknown_xyz789',
              result: 'File created successfully',
            },
          ],
        },
      ];

      const input = buildResponsesInputFromContent(content);

      const functionCallItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call',
      ) as { type: string; call_id: string } | undefined;

      const functionCallOutputItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call_output',
      ) as { type: string; call_id: string } | undefined;

      expect(functionCallItem?.call_id).toBe('call_unknown_xyz789');
      expect(functionCallOutputItem?.call_id).toBe('call_unknown_xyz789');
    });

    it('should preserve call_ IDs unchanged', () => {
      const content: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_existing123',
              name: 'read_file',
              parameters: { path: '/test.txt' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_existing123',
              result: 'file contents',
            },
          ],
        },
      ];

      const input = buildResponsesInputFromContent(content);

      const functionCallItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call',
      ) as { type: string; call_id: string } | undefined;

      const functionCallOutputItem = input.find(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'function_call_output',
      ) as { type: string; call_id: string } | undefined;

      expect(functionCallItem?.call_id).toBe('call_existing123');
      expect(functionCallOutputItem?.call_id).toBe('call_existing123');
    });
  });
});
