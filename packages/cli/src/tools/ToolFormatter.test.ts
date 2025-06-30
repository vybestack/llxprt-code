/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
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
});
