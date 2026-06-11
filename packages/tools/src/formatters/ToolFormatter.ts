/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool formatter implementation.
 *
 * Converts tools between provider formats (OpenAI, Anthropic, etc.)
 * using the self-contained IToolFormatter interface. Zero core dependencies.
 */

import type {
  IToolFormatter,
  ToolFormat,
  OpenAITool,
  ResponsesTool,
  FormatterTool,
  ToolCallBlock,
} from './IToolFormatter.js';
import {
  processToolParameters as doubleEscapeProcessToolParameters,
  logDoubleEscapingInChunk,
} from './doubleEscapeUtils.js';

/** Set of values considered missing/falsy in legacy schema checks. */
const MISSING_SCHEMA_VALUES = new Set<unknown>([false, 0, '', undefined, null]);

function isMissingGeminiSchema(value: unknown): boolean {
  return MISSING_SCHEMA_VALUES.has(value);
}

function isMissingToolCallSlot(
  slot: unknown,
): slot is undefined | null | false | 0 | '' {
  return MISSING_SCHEMA_VALUES.has(slot);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isValidObject(value: unknown): value is Record<string, unknown> {
  return value !== undefined && value !== null && typeof value === 'object';
}

function isRequiredMissing(requiredValue: unknown): boolean {
  if (Array.isArray(requiredValue)) {
    return requiredValue.length === 0;
  }
  return MISSING_SCHEMA_VALUES.has(requiredValue);
}

/**
 * Converts Gemini-format tool declarations to various provider formats.
 *
 * This implementation is self-contained with no core logger dependency.
 * Logging is replaced with silent operation.
 */
export class ToolFormatter implements IToolFormatter {
  /**
   * Convert Gemini format tools directly to OpenAI format.
   */
  convertGeminiToOpenAI(
    geminiTools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
  ): OpenAITool[] | undefined {
    if (!geminiTools) {
      return undefined;
    }

    const openAITools = geminiTools.flatMap((toolGroup) => {
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

    return openAITools;
  }

  /**
   * Convert Gemini format tools directly to Anthropic format.
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

    return anthropicTools;
  }

  /**
   * Convert Gemini format tools to the specified provider format.
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
      return undefined;
    }

    if (
      format === 'openai' ||
      format === 'qwen' ||
      format === 'deepseek' ||
      format === 'kimi'
    ) {
      return this.convertGeminiToOpenAI(geminiTools);
    }

    if (format === 'anthropic') {
      return this.convertGeminiToAnthropic(geminiTools);
    }

    // For other formats, convert to generic then use toProviderFormat
    const itools = geminiTools.flatMap((toolGroup) => {
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

    return this.toProviderFormat(itools as FormatterTool[], format);
  }

  /**
   * Converts Gemini schema format to standard JSON Schema format.
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

  private convertSchemaProperties(newSchema: Record<string, unknown>): void {
    if (isValidObject(newSchema.properties)) {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.properties = newProperties;
    }
  }

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

  private normalizeSchemaType(newSchema: Record<string, unknown>): void {
    const typeValue: unknown = newSchema.type;
    if (!isMissingGeminiSchema(typeValue) && typeValue !== '') {
      newSchema.type = String(newSchema.type).toLowerCase();
    }
  }

  private ensureRequiredForObjects(newSchema: Record<string, unknown>): void {
    if (newSchema.type === 'object' && isRequiredMissing(newSchema.required)) {
      newSchema.required = [];
    }
  }

  private normalizeEnumValues(newSchema: Record<string, unknown>): void {
    if (Array.isArray(newSchema.enum)) {
      newSchema.enum = newSchema.enum.map((v) => String(v));
    }
  }

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

  toProviderFormat(tools: FormatterTool[], format: ToolFormat): unknown {
    switch (format) {
      case 'openai':
      case 'deepseek':
      case 'qwen':
      case 'kimi':
        return tools.map((tool) => {
          const convertedParams = this.convertGeminiSchemaToStandard(
            tool.function.parameters,
          );

          return {
            type: 'function' as const,
            function: {
              name: tool.function.name,
              description: tool.function.description,
              parameters: convertedParams,
            },
          };
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
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description ?? '',
          parameters: tool.function.parameters,
        }));
      case 'gemma':
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
      case 'gemma':
        return this.fromOpenAIFormat(rawToolCall, format);
      case 'anthropic':
        return this.fromAnthropicFormat(rawToolCall);
      case 'hermes':
        return this.fromTextParserFormat(rawToolCall, 'hermes');
      case 'xml':
        return this.fromTextParserFormat(rawToolCall, 'xml');
      default:
        throw new Error(`Tool format '${format}' not yet implemented`);
    }
  }

  private fromOpenAIFormat(
    rawToolCall: unknown,
    format: ToolFormat,
  ): ToolCallBlock[] {
    const openAiToolCall = rawToolCall as {
      id: string;
      type?: string;
      function?: { name: string; arguments: string };
    };

    if (!openAiToolCall.function?.name || !openAiToolCall.function.arguments) {
      throw new Error(`Invalid ${format} tool call format`);
    }

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

  private fromAnthropicFormat(rawToolCall: unknown): ToolCallBlock[] {
    const anthropicToolCall = rawToolCall as {
      id: string;
      type?: string;
      name?: string;
      input?: unknown;
    };

    if (!anthropicToolCall.id || !anthropicToolCall.name) {
      throw new Error('Invalid anthropic tool call format');
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

  private fromTextParserFormat(
    rawToolCall: unknown,
    prefix: 'hermes' | 'xml',
  ): ToolCallBlock[] {
    const textToolCall = rawToolCall as {
      name: string;
      arguments: Record<string, unknown>;
    };

    if (!textToolCall.name) {
      throw new Error(`Invalid ${prefix} tool call format`);
    }

    const arguments_ = textToolCall.arguments as
      | Record<string, unknown>
      | undefined;
    return [
      {
        type: 'tool_call' as const,
        id: `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        name: textToolCall.name,
        parameters: arguments_ ?? {},
      },
    ];
  }

  /**
   * Handles streaming tool call accumulation for OpenAI-compatible providers.
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
        this.accumulateOpenAIStreamingToolCall(
          deltaToolCall,
          accumulatedToolCalls,
          format,
        );
        break;
      case 'hermes':
      case 'xml':
      case 'llama':
        break;
      default:
        throw new Error(
          `Streaming accumulation for format '${format}' not yet implemented`,
        );
    }
  }

  private accumulateOpenAIStreamingToolCall(
    deltaToolCall: {
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    },
    accumulatedToolCalls: ToolCallBlock[],
    format: ToolFormat,
  ): void {
    if (deltaToolCall.index === undefined) return;

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
    if (deltaToolCall.function?.name) tc.name = deltaToolCall.function.name;
    if (deltaToolCall.function?.arguments) {
      this.accumulateStreamingArguments(
        tc,
        deltaToolCall.function.arguments,
        deltaToolCall.index,
        format,
      );
    }
  }

  private accumulateStreamingArguments(
    tc: ToolCallBlock,
    chunk: string,
    index: number,
    format: ToolFormat,
  ): void {
    if (!('_argumentsString' in tc)) {
      (tc as unknown as { _argumentsString: string })._argumentsString = '';
    }

    if (format === 'qwen') {
      logDoubleEscapingInChunk(chunk || '', tc.name || 'unknown', format);
    }

    (tc as unknown as { _argumentsString: string })._argumentsString += chunk;

    try {
      const argsStr = (tc as unknown as { _argumentsString: string })
        ._argumentsString;
      if (argsStr.trim()) {
        tc.parameters = doubleEscapeProcessToolParameters(
          argsStr,
          tc.name || 'unknown',
          format,
        );
      }
    } catch {
      // Keep accumulating
    }

    void index;
  }

  /**
   * Formats tools for the OpenAI Responses API.
   */
  toResponsesTool(tools: FormatterTool[]): ResponsesTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      name: tool.function.name,
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
