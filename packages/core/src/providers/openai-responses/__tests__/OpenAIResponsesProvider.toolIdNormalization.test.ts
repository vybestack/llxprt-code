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
 * @issue https://github.com/vybestack/llxprt-code/issues/825
 *
 * When tool calls are cancelled, their IDs may be in hist_tool_XXX format.
 * OpenAI's Responses API expects call_XXX format for all call_ids.
 * This causes a 400 error: "No tool call found for function call output with call_id"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import type { IContent } from '../../../services/history/IContent.js';
import { normalizeToOpenAIToolId } from '../../utils/toolIdNormalization.js';
import { buildResponsesInputFromContent } from '../buildResponsesInputFromContent.js';

describe('Tool ID Normalization for OpenAI Responses API (Issue #825)', () => {
  describe('normalizeToOpenAIToolId utility function', () => {
    it('should normalize hist_tool_XXX format to call_XXX format', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc123def456');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('hist_tool_');
    });

    it('should normalize toolu_XXX format (Anthropic) to call_XXX format', () => {
      const result = normalizeToOpenAIToolId('toolu_abc123def456');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('toolu_');
    });

    it('should preserve call_XXX format IDs unchanged', () => {
      const result = normalizeToOpenAIToolId('call_abc123def456');
      expect(result).toBe('call_abc123def456');
    });

    it('should sanitize IDs with invalid characters (hyphens)', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc-123-def-456');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('-');
    });

    it('should produce consistent results for the same input', () => {
      const id = 'hist_tool_cancelledXYZ789';
      const result1 = normalizeToOpenAIToolId(id);
      const result2 = normalizeToOpenAIToolId(id);
      expect(result1).toBe(result2);
    });

    it('should handle mixed-case IDs', () => {
      const result = normalizeToOpenAIToolId('hist_tool_AbCdEf123');
      expect(result).toMatch(/^call_/);
      expect(result).not.toContain('hist_tool_');
    });

    it('should handle IDs with underscores (valid characters)', () => {
      const result = normalizeToOpenAIToolId('hist_tool_abc_123_def');
      expect(result).toMatch(/^call_/);
      expect(result).toContain('_');
    });

    it('should generate a valid ID for empty suffix after stripping prefix', () => {
      const result = normalizeToOpenAIToolId('hist_tool_');
      expect(result).toMatch(/^call_/);
      expect(result.length).toBeGreaterThan('call_'.length);
    });

    it('should handle IDs with only invalid characters after prefix', () => {
      const result = normalizeToOpenAIToolId('hist_tool_---');
      expect(result).toMatch(/^call_/);
      expect(result.length).toBeGreaterThan('call_'.length);
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

      expect(functionCallItem).toBeDefined();
      expect(functionCallItem?.call_id).toMatch(/^call_/);
      expect(functionCallItem?.call_id).not.toContain('hist_tool_');

      expect(functionCallOutputItem).toBeDefined();
      expect(functionCallOutputItem?.call_id).toMatch(/^call_/);
      expect(functionCallOutputItem?.call_id).not.toContain('hist_tool_');

      expect(functionCallItem?.call_id).toBe(functionCallOutputItem?.call_id);
    });

    it('should normalize toolu_ IDs in function_call and function_call_output items', () => {
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
              id: 'toolu_xyz789',
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
              callId: 'toolu_xyz789',
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

      expect(functionCallItem?.call_id).toMatch(/^call_/);
      expect(functionCallItem?.call_id).not.toContain('toolu_');
      expect(functionCallOutputItem?.call_id).toMatch(/^call_/);
      expect(functionCallItem?.call_id).toBe(functionCallOutputItem?.call_id);
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

    it('should handle cancelled tool calls with hist_tool IDs', () => {
      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Edit the file' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_cancelledXYZ789',
              name: 'replace',
              parameters: {
                file_path: '/test.txt',
                old_string: 'a',
                new_string: 'b',
              },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_cancelledXYZ789',
              result: 'User cancelled tool execution.',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'Why did you want to make that change?' },
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

      expect(functionCallItem?.call_id).toMatch(/^call_/);
      expect(functionCallOutputItem?.call_id).toMatch(/^call_/);
      expect(functionCallItem?.call_id).toBe(functionCallOutputItem?.call_id);
    });
  });
});
