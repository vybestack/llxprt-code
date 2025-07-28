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

import {
  IToolFormatter,
  ToolFormat,
  OpenAITool,
  ResponsesTool,
} from './IToolFormatter.js';
import { ITool } from '../providers/ITool.js';
import { IMessage } from '../providers/IMessage.js';

export class ToolFormatter implements IToolFormatter {
  /**
   * Converts Gemini schema format (with uppercase Type enums) to standard JSON Schema format
   */
  private convertGeminiSchemaToStandard(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const newSchema: Record<string, unknown> = { ...schema };

    // Handle properties
    if (newSchema.properties && typeof newSchema.properties === 'object') {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.properties = newProperties;
    }

    // Handle items
    if (newSchema.items) {
      if (Array.isArray(newSchema.items)) {
        newSchema.items = newSchema.items.map((item) =>
          this.convertGeminiSchemaToStandard(item),
        );
      } else {
        newSchema.items = this.convertGeminiSchemaToStandard(newSchema.items);
      }
    }

    // Convert type from UPPERCASE enum to lowercase string
    if (newSchema.type) {
      newSchema.type = String(newSchema.type).toLowerCase();
    }

    return newSchema;
  }

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
            parameters: this.convertGeminiSchemaToStandard(
              tool.function.parameters,
            ),
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
      case 'hermes':
        // Hermes uses text-based format, tools are provided as system prompt
        // Return a text description of tools for the system prompt
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters,
        }));
      case 'xml':
        // XML format also uses text-based format similar to Hermes
        // Tools are typically described in the system prompt
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters,
        }));
      case 'gemma':
        // Gemma models use the same format as OpenAI with type: 'function'
        return tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: this.convertGeminiSchemaToStandard(
              tool.function.parameters,
            ),
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
      case 'qwen':
      case 'gemma': {
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
      case 'hermes': {
        // Hermes format comes from TextToolCallParser
        const hermesToolCall = rawToolCall as {
          name: string;
          arguments: Record<string, unknown>;
        };

        if (!hermesToolCall || !hermesToolCall.name) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        return [
          {
            id: `hermes_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            type: 'function' as const,
            function: {
              name: hermesToolCall.name,
              arguments: JSON.stringify(hermesToolCall.arguments || {}),
            },
          },
        ];
      }
      case 'xml': {
        // XML format also comes from TextToolCallParser
        const xmlToolCall = rawToolCall as {
          name: string;
          arguments: Record<string, unknown>;
        };

        if (!xmlToolCall || !xmlToolCall.name) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        return [
          {
            id: `xml_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            type: 'function' as const,
            function: {
              name: xmlToolCall.name,
              arguments: JSON.stringify(xmlToolCall.arguments || {}),
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
      case 'gemma':
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
      case 'hermes':
      case 'xml':
      case 'llama':
        // For text-based toolcalls, streaming accumulation isn't required (they arrive parsed)
        // NO-OP (future implementation can extend if needed)
        break;
      default:
        throw new Error(
          `Streaming accumulation for format '${format}' not yet implemented`,
        );
    }
  }

  /**
   * Formats tools specifically for the OpenAI Responses API
   * The Responses API expects a flatter format than the regular OpenAI API
   */
  toResponsesTool(tools: ITool[]): ResponsesTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      name: tool.function.name,
      description: tool.function.description || null,
      parameters:
        (this.convertGeminiSchemaToStandard(tool.function.parameters) as Record<
          string,
          unknown
        >) || null,
      strict: null,
    }));
  }
}
