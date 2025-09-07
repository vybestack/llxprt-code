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
import { ToolCallBlock } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/DebugLogger.js';

export class ToolFormatter implements IToolFormatter {
  private logger = new DebugLogger('llxprt:tools:formatter');

  /**
   * Convert Gemini format tools directly to OpenAI format
   * @param geminiTools Tools in Gemini format with functionDeclarations
   * @returns Tools in OpenAI format with type: "function" wrapper
   */
  convertGeminiToOpenAI(
    geminiTools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ):
    | Array<{
        type: 'function';
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        };
      }>
    | undefined {
    if (!geminiTools) {
      this.logger.debug(
        () => `convertGeminiToOpenAI called with undefined tools`,
      );
      return undefined;
    }

    this.logger.debug(() => `convertGeminiToOpenAI input:`, {
      toolGroupCount: geminiTools.length,
      firstGroup: geminiTools[0]
        ? JSON.stringify(geminiTools[0]).substring(0, 500)
        : 'undefined',
    });

    const openAITools = geminiTools.flatMap((toolGroup) =>
      toolGroup.functionDeclarations.map((decl) => {
        this.logger.debug(
          () => `Processing tool declaration for ${decl.name}`,
          {
            hasParameters: !!decl.parameters,
            parametersType: typeof decl.parameters,
            parametersPreview: decl.parameters
              ? JSON.stringify(decl.parameters).substring(0, 200)
              : 'undefined',
          },
        );

        const convertedParams = this.convertGeminiSchemaToStandard(
          decl.parameters || {},
        ) as Record<string, unknown>;

        this.logger.debug(
          () => `Converting Gemini tool ${decl.name} to OpenAI format`,
          {
            name: decl.name,
            originalParams: decl.parameters,
            convertedParams,
            convertedParamsJSON: JSON.stringify(convertedParams),
          },
        );

        return {
          type: 'function' as const,
          function: {
            name: decl.name,
            description: decl.description || '',
            parameters: convertedParams,
          },
        };
      }),
    );

    this.logger.debug(
      () =>
        `Converted ${openAITools.length} tools from Gemini to OpenAI format`,
      {
        toolNames: openAITools.map((t) => t.function.name),
        firstTool: openAITools[0],
        firstToolParams: openAITools[0]
          ? JSON.stringify(openAITools[0].function.parameters)
          : 'undefined',
      },
    );

    return openAITools;
  }

  /**
   * Convert Gemini format tools directly to Anthropic format
   * @param geminiTools Tools in Gemini format with functionDeclarations
   * @returns Tools in Anthropic format with input_schema
   */
  convertGeminiToAnthropic(
    geminiTools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ):
    | Array<{
        name: string;
        description: string;
        input_schema: { type: 'object'; [key: string]: unknown };
      }>
    | undefined {
    if (!geminiTools) return undefined;

    const anthropicTools = geminiTools.flatMap((toolGroup) =>
      toolGroup.functionDeclarations.map((decl) => {
        const convertedParams = this.convertGeminiSchemaToStandard(
          decl.parameters || {},
        ) as Record<string, unknown>;

        this.logger.debug(
          () => `Converting Gemini tool ${decl.name} to Anthropic format`,
          {
            name: decl.name,
            originalParams: decl.parameters,
            convertedParams,
          },
        );

        return {
          name: decl.name,
          description: decl.description || '',
          input_schema: {
            type: 'object' as const,
            ...convertedParams,
          },
        };
      }),
    );

    this.logger.debug(
      () =>
        `Converted ${anthropicTools.length} tools from Gemini to Anthropic format`,
      {
        toolNames: anthropicTools.map((t) => t.name),
        firstTool: anthropicTools[0],
      },
    );

    return anthropicTools;
  }

  /**
   * Converts Gemini schema format (with uppercase Type enums) to standard JSON Schema format
   */
  convertGeminiSchemaToStandard(schema: unknown): unknown {
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

    // Convert enum values if present (they should remain as-is)
    // But ensure they're arrays of strings, not some other type
    if (newSchema.enum && Array.isArray(newSchema.enum)) {
      newSchema.enum = newSchema.enum.map((v) => String(v));
    }

    // Convert minLength from string to number if present
    if (newSchema.minLength && typeof newSchema.minLength === 'string') {
      const minLengthNum = parseInt(newSchema.minLength, 10);
      if (!isNaN(minLengthNum)) {
        newSchema.minLength = minLengthNum;
      } else {
        delete newSchema.minLength;
      }
    }

    // Convert maxLength from string to number if present
    if (newSchema.maxLength && typeof newSchema.maxLength === 'string') {
      const maxLengthNum = parseInt(newSchema.maxLength, 10);
      if (!isNaN(maxLengthNum)) {
        newSchema.maxLength = maxLengthNum;
      } else {
        delete newSchema.maxLength;
      }
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
        this.logger.debug(
          () => `Converting ${tools.length} tools to ${format} format`,
        );
        return tools.map((tool) => {
          const convertedParams = this.convertGeminiSchemaToStandard(
            tool.function.parameters,
          );

          // Special debug logging for TodoWrite to catch the issue
          if (
            tool.function.name === 'todo_write' ||
            tool.function.name === 'TodoWrite'
          ) {
            this.logger.debug(
              () =>
                `TodoWrite schema conversion - Original: ${JSON.stringify(tool.function.parameters, null, 2)}`,
            );
            this.logger.debug(
              () =>
                `TodoWrite schema conversion - Converted: ${JSON.stringify(convertedParams, null, 2)}`,
            );
          }

          const converted = {
            type: 'function' as const,
            function: {
              name: tool.function.name,
              description: tool.function.description,
              parameters: convertedParams,
            },
          };
          this.logger.debug(
            () => `Converted tool ${tool.function.name} to ${format} format:`,
            {
              original: tool.function.parameters,
              converted: converted.function.parameters,
            },
          );
          return converted;
        });
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
  ): ToolCallBlock[] {
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

        // Debug logging for tool call conversion
        this.logger.debug(
          () => `Converting ${format} tool call from provider format:`,
          {
            format,
            toolName: openAiToolCall.function.name,
            argumentsType: typeof openAiToolCall.function.arguments,
            argumentsLength: openAiToolCall.function.arguments.length,
            argumentsPreview:
              openAiToolCall.function.arguments.length > 100
                ? openAiToolCall.function.arguments.substring(0, 100) + '...'
                : openAiToolCall.function.arguments,
            rawArguments: openAiToolCall.function.arguments,
          },
        );

        // Check if arguments look double-stringified
        if (format === 'qwen') {
          const args = openAiToolCall.function.arguments;
          try {
            const parsed = JSON.parse(args);
            if (typeof parsed === 'string') {
              // Arguments were stringified, let's check if they're double-stringified
              try {
                const doubleParsed = JSON.parse(parsed);
                this.logger.error(
                  () =>
                    `[Qwen] Arguments appear to be double-stringified for ${openAiToolCall.function.name}`,
                  {
                    firstParse: parsed,
                    secondParse: doubleParsed,
                    originalLength: args.length,
                  },
                );
              } catch {
                // Not double-stringified, just single stringified
                this.logger.debug(
                  () =>
                    `[Qwen] Arguments are single-stringified for ${openAiToolCall.function.name}`,
                );
              }
            }
          } catch (e) {
            this.logger.error(
              () =>
                `[Qwen] Failed to parse arguments for ${openAiToolCall.function.name}:`,
              e,
            );
          }
        }

        return [
          {
            type: 'tool_call' as const,
            id: openAiToolCall.id,
            name: openAiToolCall.function.name,
            parameters: JSON.parse(openAiToolCall.function.arguments),
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
            type: 'tool_call' as const,
            id: anthropicToolCall.id,
            name: anthropicToolCall.name,
            parameters: anthropicToolCall.input || {},
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
            type: 'tool_call' as const,
            id: `hermes_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: hermesToolCall.name,
            parameters: hermesToolCall.arguments || {},
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
            type: 'tool_call' as const,
            id: `xml_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: xmlToolCall.name,
            parameters: xmlToolCall.arguments || {},
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
    accumulatedToolCalls: ToolCallBlock[],
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
              type: 'tool_call',
              id: deltaToolCall.id || '',
              name: '',
              parameters: {},
            };
          }
          const tc = accumulatedToolCalls[deltaToolCall.index];
          if (deltaToolCall.id) tc.id = deltaToolCall.id;
          if (deltaToolCall.function?.name)
            tc.name = deltaToolCall.function.name;
          if (deltaToolCall.function?.arguments) {
            // Enhanced debug logging for all formats, especially Qwen
            // Store accumulated arguments as string first, will parse at the end
            if (!('_argumentsString' in tc)) {
              (tc as unknown as { _argumentsString: string })._argumentsString =
                '';
            }

            this.logger.debug(
              () =>
                `[${format}] Accumulating argument chunk for tool ${tc.name}:`,
              {
                format,
                toolName: tc.name,
                index: deltaToolCall.index,
                chunk: deltaToolCall.function.arguments,
                chunkLength: deltaToolCall.function.arguments.length,
                currentAccumulated: (
                  tc as unknown as { _argumentsString: string }
                )._argumentsString,
                currentAccumulatedLength: (
                  tc as unknown as { _argumentsString: string }
                )._argumentsString.length,
                startsWithQuote:
                  deltaToolCall.function.arguments.startsWith('"'),
                endsWithQuote: deltaToolCall.function.arguments.endsWith('"'),
                containsEscapedQuote:
                  deltaToolCall.function.arguments.includes('\\"'),
                containsDoubleEscapedQuote:
                  deltaToolCall.function.arguments.includes('\\\\"'),
              },
            );

            // Special Qwen double-stringification detection
            if (format === 'qwen') {
              // Check if this looks like a double-stringified value
              const chunk = deltaToolCall.function.arguments;
              if (
                chunk.includes('\\"[') ||
                chunk.includes('\\\\"') ||
                (chunk.startsWith('"\\"') && chunk.endsWith('\\""'))
              ) {
                this.logger.error(
                  () =>
                    `[Qwen] Detected potential double-stringification in chunk for ${tc.name}`,
                  {
                    chunk,
                    pattern:
                      'Contains escaped quotes that suggest double-stringification',
                  },
                );
              }
            }

            (tc as unknown as { _argumentsString: string })._argumentsString +=
              deltaToolCall.function.arguments;

            // Log the accumulated state after adding chunk
            this.logger.debug(
              () => `[${format}] After accumulation for ${tc.name}:`,
              {
                totalLength: (tc as unknown as { _argumentsString: string })
                  ._argumentsString.length,
                preview:
                  (tc as unknown as { _argumentsString: string })
                    ._argumentsString.length > 100
                    ? (
                        tc as unknown as { _argumentsString: string }
                      )._argumentsString.substring(0, 100) + '...'
                    : (tc as unknown as { _argumentsString: string })
                        ._argumentsString,
              },
            );

            // Try to parse parameters
            try {
              const argsStr = (tc as unknown as { _argumentsString: string })
                ._argumentsString;
              if (argsStr.trim()) {
                tc.parameters = JSON.parse(argsStr);
              }
            } catch {
              // Keep accumulating, parameters will be set when complete
            }
          }
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
