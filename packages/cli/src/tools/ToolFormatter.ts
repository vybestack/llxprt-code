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
    switch (format) {
      case 'openai':
      case 'deepseek': // DeepSeek uses same format as OpenAI for now
      case 'qwen': // Qwen uses same format as OpenAI for now
        return tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          },
        }));
      case 'anthropic':
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          input_schema: {
            type: 'object' as const,
            ...tool.function.parameters,
          },
        }));
      default:
        throw new Error(`Tool format '${format}' not yet implemented`);
    }
  }

  fromProviderFormat(
    rawToolCall: unknown,
    format: ToolFormat,
  ): IMessage['tool_calls'] {
    switch (format) {
      case 'openai':
      case 'deepseek':
      case 'qwen': {
        const openAiToolCall = rawToolCall as {
          id: string;
          type?: string;
          function: { name: string; arguments: string };
        };

        if (
          !openAiToolCall ||
          !openAiToolCall.function ||
          !openAiToolCall.function.name ||
          !openAiToolCall.function.arguments
        ) {
          throw new Error(`Invalid ${format} tool call format`);
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
      case 'anthropic': {
        const anthropicToolCall = rawToolCall as {
          id: string;
          type?: string;
          name?: string;
          input?: unknown;
        };

        if (
          !anthropicToolCall ||
          !anthropicToolCall.id ||
          !anthropicToolCall.name
        ) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        return [
          {
            id: anthropicToolCall.id,
            type: 'function' as const,
            function: {
              name: anthropicToolCall.name,
              arguments: anthropicToolCall.input
                ? JSON.stringify(anthropicToolCall.input)
                : '',
            },
          },
        ];
      }
      default:
        throw new Error(`Tool format '${format}' not yet implemented`);
    }
  }

  /**
   * Handles streaming tool call accumulation for OpenAI-compatible providers
   * This accumulates partial tool calls from streaming responses
   */
  accumulateStreamingToolCall(
    deltaToolCall: {
      index?: number;
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    },
    accumulatedToolCalls: NonNullable<IMessage['tool_calls']>,
    format: ToolFormat,
  ): void {
    switch (format) {
      case 'openai':
      case 'deepseek':
      case 'qwen':
        // All use same accumulation logic for now
        if (deltaToolCall.index !== undefined) {
          if (!accumulatedToolCalls[deltaToolCall.index]) {
            accumulatedToolCalls[deltaToolCall.index] = {
              id: deltaToolCall.id || '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          const tc = accumulatedToolCalls[deltaToolCall.index];
          if (deltaToolCall.id) tc.id = deltaToolCall.id;
          if (deltaToolCall.function?.name)
            tc.function.name = deltaToolCall.function.name;
          if (deltaToolCall.function?.arguments)
            tc.function.arguments += deltaToolCall.function.arguments;
        }
        break;
      default:
        throw new Error(
          `Streaming accumulation for format '${format}' not yet implemented`,
        );
    }
  }
}
