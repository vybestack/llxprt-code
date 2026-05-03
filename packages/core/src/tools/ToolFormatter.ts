/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

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
  type IToolFormatter,
  type ToolFormat,
  type OpenAITool,
  type ResponsesTool,
} from './IToolFormatter.js';
import { type ITool } from '../providers/ITool.js';
import { type ToolCallBlock } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import {
  logDoubleEscapingInChunk,
  processToolParameters as doubleEscapeProcessToolParameters,
} from './doubleEscapeUtils.js';

/** Set of values considered missing/falsy in legacy schema checks (non-nullish falsy + nullish). */
const MISSING_SCHEMA_VALUES = new Set<unknown>([false, 0, '', undefined, null]);

/**
 * Helper predicate: checks if a schema value is missing/falsy in the legacy sense.
 * Preserves old !schema semantics: reject all falsy runtime values
 * (undefined, null, false, 0, empty string), not only nullish.
 */
function isMissingGeminiSchema(value: unknown): boolean {
  return MISSING_SCHEMA_VALUES.has(value);
}

/**
 * Helper predicate: checks if an accumulated tool call slot is missing/empty.
 * Preserves old truthy behavior: treats undefined, null, false, 0, and empty string as missing.
 * Used for streaming accumulation where old code overwrote any falsy slot.
 */
function isMissingToolCallSlot(
  slot: unknown,
): slot is undefined | null | false | 0 | '' {
  return MISSING_SCHEMA_VALUES.has(slot);
}

/**
 * Helper predicate: checks if a value is a non-empty string.
 * Used for string field checks that preserve old truthy behavior (empty string skipped).
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Helper predicate: checks if a value is a valid object (non-null, typeof 'object').
 * Used for schema property checks to reduce expression complexity.
 */
function isValidObject(value: unknown): value is Record<string, unknown> {
  return value !== undefined && value !== null && typeof value === 'object';
}

/**
 * Helper predicate: checks if a required value is missing for 'object' types.
 * Treats falsy values and empty arrays as missing (old truthy behavior).
 */
function isRequiredMissing(requiredValue: unknown): boolean {
  if (Array.isArray(requiredValue)) {
    return requiredValue.length === 0;
  }
  return MISSING_SCHEMA_VALUES.has(requiredValue);
}

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
        parametersJsonSchema?: unknown;
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

    if (this.logger.enabled) {
      this.logger.debug(() => `convertGeminiToOpenAI input:`, {
        toolGroupCount: geminiTools.length,
        hasFirstGroup: geminiTools.length > 0,
        firstGroupFunctionCount:
          geminiTools[0]?.functionDeclarations?.length ?? 0,
      });
    }

    const openAITools = geminiTools.flatMap((toolGroup) => {
      // Add safety check for malformed tool groups
      // Runtime boundary: toolGroup comes from provider payload, functionDeclarations may not be an array
      if (!Array.isArray(toolGroup.functionDeclarations)) {
        this.logger.warn(
          () => `convertGeminiToOpenAI: Skipping malformed tool group`,
          { toolGroup },
        );
        return [];
      }

      return toolGroup.functionDeclarations.map((decl) => {
        const schema: unknown = decl.parametersJsonSchema;
        if (isMissingGeminiSchema(schema)) {
          throw new Error(
            `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
              `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
          );
        }
        const convertedParams = this.convertGeminiSchemaToStandard(
          schema,
        ) as Record<string, unknown>;

        return {
          type: 'function' as const,
          function: {
            name: decl.name,
            description: decl.description ?? '',
            parameters: convertedParams,
          },
        };
      });
    });

    if (this.logger.enabled) {
      this.logger.debug(
        () =>
          `Converted ${openAITools.length} tools from Gemini to OpenAI format`,
        {
          toolNames: openAITools.map((t) => t.function.name),
          hasFirstTool: openAITools.length > 0,
          firstToolName: openAITools[0]?.function?.name,
        },
      );
    }

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
        parametersJsonSchema?: unknown;
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
        const schema: unknown = decl.parametersJsonSchema;
        if (isMissingGeminiSchema(schema)) {
          throw new Error(
            `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
              `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
          );
        }
        const convertedParams = this.convertGeminiSchemaToStandard(
          schema,
        ) as Record<string, unknown>;

        // Remove verbose per-tool logging

        return {
          name: decl.name,
          description: decl.description ?? '',
          input_schema: {
            type: 'object' as const,
            ...convertedParams,
          },
        };
      }),
    );

    if (this.logger.enabled) {
      this.logger.debug(
        () =>
          `Converted ${anthropicTools.length} tools from Gemini to Anthropic format`,
        {
          toolNames: anthropicTools.map((t) => t.name),
          hasFirstTool: anthropicTools.length > 0,
        },
      );
    }

    return anthropicTools;
  }

  /**
   * Convert Gemini format tools to the specified provider format
   * @param geminiTools Tools in Gemini format with functionDeclarations
   * @param format The target format to convert to
   * @returns Tools in the specified provider format
   */
  convertGeminiToFormat(
    geminiTools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
    format: ToolFormat = 'openai',
  ): unknown {
    if (!geminiTools) {
      this.logger.debug(
        () => `convertGeminiToFormat called with undefined tools`,
      );
      return undefined;
    }

    this.logger.debug(
      () => `Converting ${geminiTools.length} tool groups to ${format} format`,
    );

    // For OpenAI-compatible formats (openai, qwen, deepseek, kimi), use the OpenAI conversion
    if (
      format === 'openai' ||
      format === 'qwen' ||
      format === 'deepseek' ||
      format === 'kimi'
    ) {
      return this.convertGeminiToOpenAI(geminiTools);
    }

    // For Anthropic format
    if (format === 'anthropic') {
      return this.convertGeminiToAnthropic(geminiTools);
    }

    // For other formats, convert to ITool first then use toProviderFormat
    const itools = geminiTools.flatMap((toolGroup) => {
      // Runtime boundary: toolGroup comes from provider payload, functionDeclarations may not be an array
      if (!Array.isArray(toolGroup.functionDeclarations)) {
        return [];
      }

      return toolGroup.functionDeclarations.map((decl) => {
        const schema: unknown = decl.parametersJsonSchema;
        if (isMissingGeminiSchema(schema)) {
          throw new Error(
            `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
              `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
          );
        }
        return {
          type: 'function' as const,
          function: {
            name: decl.name,
            description: decl.description ?? '',
            parameters: schema,
          },
        };
      });
    });

    // Convert using the generic toProviderFormat method
    return this.toProviderFormat(itools as ITool[], format);
  }

  /**
   * Converts Gemini schema format (with uppercase Type enums) to standard JSON Schema format
   */
  convertGeminiSchemaToStandard(schema: unknown): unknown {
    if (schema === null || schema === undefined || typeof schema !== 'object') {
      return schema;
    }

    const newSchema: Record<string, unknown> = { ...schema };

    this.convertSchemaProperties(newSchema);
    this.convertSchemaItems(newSchema);
    this.normalizeSchemaType(newSchema);
    this.ensureRequiredForObjects(newSchema);
    this.normalizeEnumValues(newSchema);
    this.convertStringLengthConstraints(newSchema);

    return newSchema;
  }

  /**
   * Recursively converts properties object in schema.
   */
  private convertSchemaProperties(newSchema: Record<string, unknown>): void {
    if (isValidObject(newSchema.properties)) {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.properties = newProperties;
    }
  }

  /**
   * Recursively converts items in schema (handles both array and single item).
   */
  private convertSchemaItems(newSchema: Record<string, unknown>): void {
    if (newSchema.items !== undefined && newSchema.items !== null) {
      if (Array.isArray(newSchema.items)) {
        newSchema.items = newSchema.items.map((item) =>
          this.convertGeminiSchemaToStandard(item),
        );
      } else {
        newSchema.items = this.convertGeminiSchemaToStandard(newSchema.items);
      }
    }
  }

  /**
   * Normalizes type field from UPPERCASE enum to lowercase string.
   */
  private normalizeSchemaType(newSchema: Record<string, unknown>): void {
    const typeValue: unknown = newSchema.type;
    if (!isMissingGeminiSchema(typeValue) && typeValue !== '') {
      newSchema.type = String(newSchema.type).toLowerCase();
    }
  }

  /**
   * Ensures required field is present for object types (critical for K2 structured calls).
   */
  private ensureRequiredForObjects(newSchema: Record<string, unknown>): void {
    if (newSchema.type === 'object' && isRequiredMissing(newSchema.required)) {
      newSchema.required = [];
    }
  }

  /**
   * Normalizes enum values to strings.
   */
  private normalizeEnumValues(newSchema: Record<string, unknown>): void {
    if (Array.isArray(newSchema.enum)) {
      newSchema.enum = newSchema.enum.map((v) => String(v));
    }
  }

  /**
   * Converts minLength/maxLength from string to number when present.
   */
  private convertStringLengthConstraints(
    newSchema: Record<string, unknown>,
  ): void {
    if (isNonEmptyString(newSchema.minLength)) {
      const minLengthNum = parseInt(newSchema.minLength, 10);
      if (!isNaN(minLengthNum)) {
        newSchema.minLength = minLengthNum;
      } else {
        delete newSchema.minLength;
      }
    }

    if (isNonEmptyString(newSchema.maxLength)) {
      const maxLengthNum = parseInt(newSchema.maxLength, 10);
      if (!isNaN(maxLengthNum)) {
        newSchema.maxLength = maxLengthNum;
      } else {
        delete newSchema.maxLength;
      }
    }
  }

  toProviderFormat(tools: ITool[], format: 'openai'): OpenAITool[];
  toProviderFormat(tools: ITool[], format: ToolFormat): unknown;
  toProviderFormat(tools: ITool[], format: ToolFormat): OpenAITool[] | unknown {
    switch (format) {
      case 'openai':
      case 'deepseek': // DeepSeek uses same format as OpenAI for now
      case 'qwen': // Qwen uses same format as OpenAI for now
      case 'kimi': // Kimi K2 uses same format as OpenAI
        // Guard verbose conversion logging
        if (this.logger.enabled) {
          this.logger.debug(
            () => `Converting ${tools.length} tools to ${format} format`,
          );
        }
        return tools.map((tool) => {
          const convertedParams = this.convertGeminiSchemaToStandard(
            tool.function.parameters,
          );

          const converted = {
            type: 'function' as const,
            function: {
              name: tool.function.name,
              description: tool.function.description,
              parameters: convertedParams,
            },
          };
          return converted;
        });
      case 'anthropic':
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description ?? '',
          input_schema: {
            type: 'object' as const,
            ...tool.function.parameters,
          },
        }));
      case 'hermes':
      case 'xml':
        // Hermes and XML use text-based format, tools are provided as system prompt
        // Return a text description of tools for the system prompt
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description ?? '',
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
      case 'kimi':
      case 'gemma': {
        // Runtime boundary: rawToolCall comes from network response, may not match expected type
        // Cast reflects that fields may be missing from malformed provider data
        const openAiToolCall = rawToolCall as {
          id: string;
          type?: string;
          function?: { name: string; arguments: string };
        };

        if (
          !openAiToolCall.function?.name ||
          !openAiToolCall.function.arguments
        ) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        // Only log tool call conversions if debug is enabled to avoid performance overhead
        if (this.logger.enabled) {
          this.logger.debug(
            () => `Converting ${format} tool call from provider format:`,
            {
              format,
              toolName: openAiToolCall.function.name,
              argumentsType: typeof openAiToolCall.function.arguments,
              argumentsLength: openAiToolCall.function.arguments.length,
            },
          );
        }

        // Process parameters using doubleEscapeUtils for formats that need special handling
        const parameters = doubleEscapeProcessToolParameters(
          openAiToolCall.function.arguments,
          openAiToolCall.function.name,
          format,
        );

        return [
          {
            type: 'tool_call' as const,
            id: openAiToolCall.id,
            name: openAiToolCall.function.name,
            parameters,
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

        // Runtime boundary: rawToolCall comes from provider API, may not match asserted type

        if (!anthropicToolCall.id || !anthropicToolCall.name) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        return [
          {
            type: 'tool_call' as const,
            id: anthropicToolCall.id,
            name: anthropicToolCall.name,
            parameters: anthropicToolCall.input ?? {},
          },
        ];
      }
      case 'hermes': {
        // Hermes format comes from TextToolCallParser
        const hermesToolCall = rawToolCall as {
          name: string;
          arguments: Record<string, unknown>;
        };

        // Runtime boundary: rawToolCall from parser may not match asserted type
        if (!hermesToolCall.name) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        const hermesArguments = hermesToolCall.arguments as
          | Record<string, unknown>
          | undefined;
        return [
          {
            type: 'tool_call' as const,
            id: `hermes_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: hermesToolCall.name,
            parameters: hermesArguments ?? {},
          },
        ];
      }
      case 'xml': {
        // XML format also comes from TextToolCallParser
        const xmlToolCall = rawToolCall as {
          name: string;
          arguments: Record<string, unknown>;
        };

        // Runtime boundary: rawToolCall from parser may not match asserted type
        if (!xmlToolCall.name) {
          throw new Error(`Invalid ${format} tool call format`);
        }

        const xmlArguments = xmlToolCall.arguments as
          | Record<string, unknown>
          | undefined;
        return [
          {
            type: 'tool_call' as const,
            id: `xml_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: xmlToolCall.name,
            parameters: xmlArguments ?? {},
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
      case 'kimi':
      case 'gemma':
        // All use same accumulation logic for now
        if (deltaToolCall.index !== undefined) {
          // Preserve old truthy behavior: overwrite any falsy slot (not just nullish)
          const existingSlot = accumulatedToolCalls[deltaToolCall.index];
          if (isMissingToolCallSlot(existingSlot)) {
            accumulatedToolCalls[deltaToolCall.index] = {
              type: 'tool_call',
              id: deltaToolCall.id ?? '',
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
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (!('_argumentsString' in tc)) {
              (tc as unknown as { _argumentsString: string })._argumentsString =
                '';
            }

            // Only log argument accumulation in debug mode to prevent performance issues
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (this.logger.enabled) {
              this.logger.debug(
                () =>
                  `[${format}] Accumulating argument chunk for tool ${tc.name}`,
                {
                  format,
                  toolName: tc.name,
                  index: deltaToolCall.index,
                  chunkLength: deltaToolCall.function.arguments.length,
                  currentAccumulatedLength: (
                    tc as unknown as { _argumentsString: string }
                  )._argumentsString.length,
                },
              );
            }

            // Use doubleEscapeUtils to detect potential double-stringification
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (format === 'qwen') {
              logDoubleEscapingInChunk(
                deltaToolCall.function.arguments || '',
                tc.name || 'unknown',
                format,
              );
            }

            (tc as unknown as { _argumentsString: string })._argumentsString +=
              deltaToolCall.function.arguments;

            // Try to parse parameters using doubleEscapeUtils for special formats
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            try {
              const argsStr = (tc as unknown as { _argumentsString: string })
                ._argumentsString;
              if (argsStr.trim()) {
                // Process using doubleEscapeUtils for formats that need special handling
                tc.parameters = doubleEscapeProcessToolParameters(
                  argsStr,
                  tc.name || 'unknown',
                  format,
                );
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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty description should become null
      description: tool.function.description || null,
      parameters:
        (this.convertGeminiSchemaToStandard(tool.function.parameters) as
          | Record<string, unknown>
          | null
          | undefined) ?? null,

      strict: null,
    }));
  }
}
