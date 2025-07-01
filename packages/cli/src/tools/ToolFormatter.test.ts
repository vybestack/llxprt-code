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
      'Invalid OpenAI tool call format',
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

    expect(formatter.fromProviderFormat(rawToolCall, 'openai')).toEqual(expected);
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
      'NotYetImplemented',
    );
    expect(() => formatter.toProviderFormat(tools, 'xml' as const)).toThrow(
      'NotYetImplemented',
    );
  });

  it('should throw NotYetImplemented for non-OpenAI formats in fromProviderFormat', () => {
    const rawToolCall = { test: 'data' };

    expect(() => formatter.fromProviderFormat(rawToolCall, 'hermes')).toThrow(
      'NotYetImplemented',
    );
    expect(() => formatter.fromProviderFormat(rawToolCall, 'xml')).toThrow(
      'NotYetImplemented',
    );
  });
});
