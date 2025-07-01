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

import { ToolFormatter } from './ToolFormatter';
import { ITool } from '../providers/ITool';

describe('ToolFormatter', () => {
  let formatter: ToolFormatter;

  beforeEach(() => {
    formatter = new ToolFormatter();
  });

  it('should correctly format tools for OpenAI provider', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
      },
    ];

    const expected = [
      {
        type: 'function',
        function: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
      },
    ];

    expect(formatter.toProviderFormat(tools, 'openai')).toEqual(expected);
  });

  it('should throw an error for invalid OpenAI tool call format', () => {
    const rawToolCall = {};
    expect(() => formatter.fromProviderFormat(rawToolCall, 'openai')).toThrow(
      'Invalid openai tool call format',
    );
  });

  it('should correctly parse OpenAI tool calls from provider format', () => {
    const rawToolCall = {
      id: 'call_123',
      function: {
        name: 'sum',
        arguments: '{"a": 5, "b": 3}',
      },
    };

    const expected = [
      {
        id: 'call_123',
        type: 'function' as const,
        function: {
          name: 'sum',
          arguments: '{"a": 5, "b": 3}',
        },
      },
    ];

    expect(formatter.fromProviderFormat(rawToolCall, 'openai')).toEqual(
      expected,
    );
  });

  it('should correctly format tools for Anthropic provider', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search for information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const expected = [
      {
        name: 'search',
        description: 'Search for information',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      },
    ];

    expect(formatter.toProviderFormat(tools, 'anthropic')).toEqual(expected);
  });

  it('should handle empty description for Anthropic provider', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'calculate',
          parameters: {
            type: 'object',
            properties: { x: { type: 'number' } },
          },
        },
      },
    ];

    const result = formatter.toProviderFormat(tools, 'anthropic') as Array<{
      name: string;
      description: string;
      input_schema: object;
    }>;
    expect(result[0].description).toBe('');
  });

  it('should throw NotYetImplemented for non-OpenAI formats in toProviderFormat', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test',
          description: 'Test function',
          parameters: {},
        },
      },
    ];

    expect(() => formatter.toProviderFormat(tools, 'hermes' as const)).toThrow(
      "Tool format 'hermes' not yet implemented",
    );
    expect(() => formatter.toProviderFormat(tools, 'xml' as const)).toThrow(
      "Tool format 'xml' not yet implemented",
    );
  });

  it('should correctly parse Anthropic tool calls from provider format', () => {
    const rawToolCall = {
      id: 'toolu_01abc123',
      type: 'tool_use',
      name: 'search',
      input: { query: 'test search', limit: 10 },
    };

    const expected = [
      {
        id: 'toolu_01abc123',
        type: 'function' as const,
        function: {
          name: 'search',
          arguments: '{"query":"test search","limit":10}',
        },
      },
    ];

    expect(formatter.fromProviderFormat(rawToolCall, 'anthropic')).toEqual(
      expected,
    );
  });

  it('should handle Anthropic tool calls without input', () => {
    const rawToolCall = {
      id: 'toolu_01xyz789',
      name: 'get_time',
    };

    const expected = [
      {
        id: 'toolu_01xyz789',
        type: 'function' as const,
        function: {
          name: 'get_time',
          arguments: '',
        },
      },
    ];

    expect(formatter.fromProviderFormat(rawToolCall, 'anthropic')).toEqual(
      expected,
    );
  });

  it('should throw an error for invalid Anthropic tool call format', () => {
    const invalidCalls = [
      {},
      { id: 'test' }, // missing name
      { name: 'test' }, // missing id
      null,
    ];

    invalidCalls.forEach((rawToolCall) => {
      expect(() =>
        formatter.fromProviderFormat(rawToolCall, 'anthropic'),
      ).toThrow('Invalid anthropic tool call format');
    });
  });

  it('should throw NotYetImplemented for non-OpenAI formats in fromProviderFormat', () => {
    const rawToolCall = { test: 'data' };

    expect(() => formatter.fromProviderFormat(rawToolCall, 'hermes')).toThrow(
      "Tool format 'hermes' not yet implemented",
    );
    expect(() => formatter.fromProviderFormat(rawToolCall, 'xml')).toThrow(
      "Tool format 'xml' not yet implemented",
    );
  });

  it('should format tools correctly for DeepSeek and Qwen providers', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test_function',
          description: 'A test function',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    // DeepSeek and Qwen use the same format as OpenAI
    const deepseekResult = formatter.toProviderFormat(
      tools,
      'deepseek' as const,
    );
    const qwenResult = formatter.toProviderFormat(tools, 'qwen' as const);
    const openaiResult = formatter.toProviderFormat(tools, 'openai');

    expect(deepseekResult).toEqual(openaiResult);
    expect(qwenResult).toEqual(openaiResult);
  });
});
