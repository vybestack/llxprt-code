/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IToolFormatter, ToolFormat, OpenAITool } from './IToolFormatter.js';
import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export class ToolFormatter implements IToolFormatter {
  toProviderFormat(tools: ITool[], format: 'openai'): OpenAITool[];
  toProviderFormat(tools: ITool[], format: ToolFormat): unknown;
  toProviderFormat(tools: ITool[], format: ToolFormat): OpenAITool[] | unknown {
    if (format === 'openai') {
      return tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
    }
    throw new Error('NotYetImplemented');
  }

  fromProviderFormat(
    rawToolCall: unknown,
    format: ToolFormat,
  ): IMessage['tool_calls'] {
    if (format === 'openai') {
      // Assuming rawToolCall is an object with a 'function_call' property
      // that contains 'name' and 'arguments' (as a JSON string)
      const openAiToolCall = rawToolCall as {
        id: string;
        function: { name: string; arguments: string };
      };

      if (
        !openAiToolCall ||
        !openAiToolCall.function ||
        !openAiToolCall.function.name ||
        !openAiToolCall.function.arguments
      ) {
        throw new Error('Invalid OpenAI tool call format');
      }

      return [
        {
          id: openAiToolCall.id,
          type: 'function' as const,
          function: {
            name: openAiToolCall.function.name,
            arguments: openAiToolCall.function.arguments,
          },
        },
      ];
    }
    throw new Error('NotYetImplemented');
  }
}
