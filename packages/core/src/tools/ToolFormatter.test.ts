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

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFormatter } from './ToolFormatter.js';
import { ITool } from '../providers/ITool.js';

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

  it('should not throw for implemented formats in toProviderFormat', () => {
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

    // All these formats are now implemented and should not throw
    expect(() => formatter.toProviderFormat(tools, 'openai')).not.toThrow();
    expect(() => formatter.toProviderFormat(tools, 'anthropic')).not.toThrow();
    expect(() => formatter.toProviderFormat(tools, 'hermes')).not.toThrow();
    expect(() => formatter.toProviderFormat(tools, 'xml')).not.toThrow();
    expect(() => formatter.toProviderFormat(tools, 'deepseek')).not.toThrow();
    expect(() => formatter.toProviderFormat(tools, 'qwen')).not.toThrow();
  });

  it('should correctly format tools for Hermes provider', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'get_stock_fundamentals',
          description: 'Get fundamental data for a stock',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'Stock symbol' },
            },
            required: ['symbol'],
          },
        },
      },
    ];

    const expected = [
      {
        name: 'get_stock_fundamentals',
        description: 'Get fundamental data for a stock',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
          },
          required: ['symbol'],
        },
      },
    ];

    expect(formatter.toProviderFormat(tools, 'hermes')).toEqual(expected);
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

  it('should correctly parse Hermes tool calls from provider format', () => {
    const rawToolCall = {
      name: 'get_stock_fundamentals',
      arguments: { symbol: 'AAPL' },
    };

    const result = formatter.fromProviderFormat(rawToolCall, 'hermes');

    expect(result).toHaveLength(1);
    expect(result![0].type).toBe('function');
    expect(result![0].function.name).toBe('get_stock_fundamentals');
    expect(result![0].function.arguments).toBe('{"symbol":"AAPL"}');
    expect(result![0].id).toMatch(/^hermes_/); // Should have generated ID
  });

  it('should handle Hermes tool calls without arguments', () => {
    const rawToolCall = {
      name: 'get_current_time',
      arguments: {},
    };

    const result = formatter.fromProviderFormat(rawToolCall, 'hermes');

    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('get_current_time');
    expect(result![0].function.arguments).toBe('{}');
  });

  it('should throw error for invalid Hermes tool call format', () => {
    const invalidCalls = [
      {},
      { arguments: {} }, // missing name
      null,
    ];

    invalidCalls.forEach((rawToolCall) => {
      expect(() => formatter.fromProviderFormat(rawToolCall, 'hermes')).toThrow(
        'Invalid hermes tool call format',
      );
    });
  });

  it('should correctly format tools for XML provider', () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'weather_tool',
          description: 'Get weather information',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
              units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      },
    ];

    const expected = [
      {
        name: 'weather_tool',
        description: 'Get weather information',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
      },
    ];

    expect(formatter.toProviderFormat(tools, 'xml')).toEqual(expected);
  });

  it('should correctly parse XML tool calls from provider format', () => {
    const rawToolCall = {
      name: 'weather_tool',
      arguments: { location: 'Paris', units: 'celsius' },
    };

    const result = formatter.fromProviderFormat(rawToolCall, 'xml');

    expect(result).toHaveLength(1);
    expect(result![0].type).toBe('function');
    expect(result![0].function.name).toBe('weather_tool');
    expect(result![0].function.arguments).toBe(
      '{"location":"Paris","units":"celsius"}',
    );
    expect(result![0].id).toMatch(/^xml_/); // Should have generated ID
  });

  it('should handle XML tool calls without arguments', () => {
    const rawToolCall = {
      name: 'get_time',
      arguments: {},
    };

    const result = formatter.fromProviderFormat(rawToolCall, 'xml');

    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('get_time');
    expect(result![0].function.arguments).toBe('{}');
  });

  it('should throw error for invalid XML tool call format', () => {
    const invalidCalls = [
      {},
      { arguments: {} }, // missing name
      null,
    ];

    invalidCalls.forEach((rawToolCall) => {
      expect(() => formatter.fromProviderFormat(rawToolCall, 'xml')).toThrow(
        'Invalid xml tool call format',
      );
    });
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
