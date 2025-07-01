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
