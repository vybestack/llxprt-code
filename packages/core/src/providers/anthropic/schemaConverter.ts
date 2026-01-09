/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema converter for Anthropic provider.
 * Converts tool schemas to Anthropic-compatible format.
 *
 * Key requirements for Anthropic tool use:
 * - name: string
 * - description: string
 * - input_schema: object with type, properties, required
 * - required: must always be present as an array (even if empty)
 */

import { DebugLogger } from '../../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:provider:anthropic:schema');

// Tool name prefix for Claude Code OAuth compatibility
// Tools are prefixed on outgoing requests and unprefixed on incoming responses
export const TOOL_PREFIX = 'llxprt_';

/**
 * Anthropic input schema format
 */
export interface AnthropicInputSchema {
  type: 'object';
  properties?: Record<string, AnthropicPropertySchema>;
  required: string[];
  [key: string]: unknown;
}

/**
 * Anthropic property schema (recursive for nested objects/arrays)
 */
export interface AnthropicPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: AnthropicPropertySchema;
  properties?: Record<string, AnthropicPropertySchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
}

/**
 * Anthropic tool format
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: AnthropicInputSchema;
}

/**
 * Input format from Gemini-style tool declarations
 */
interface GeminiToolDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
  parameters?: unknown;
}

/**
 * Convert a Gemini-style schema to Anthropic input_schema format.
 * Handles:
 * - Uppercase type enums → lowercase strings
 * - Missing required fields → adds empty array
 * - String numeric values → proper numbers
 * - Recursive property/items conversion
 */
export function convertSchemaToAnthropic(
  schema: unknown,
): AnthropicInputSchema {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  const input = schema as Record<string, unknown>;
  const result: AnthropicInputSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  // Convert properties recursively
  if (input.properties && typeof input.properties === 'object') {
    result.properties = convertProperties(
      input.properties as Record<string, unknown>,
    );
  }

  // Ensure required is always an array - CRITICAL for consistent behavior
  if (Array.isArray(input.required)) {
    result.required = input.required.map((r) => String(r));
  } else {
    // Always include required field, even if empty
    result.required = [];
  }

  return result;
}

/**
 * Convert properties object recursively
 */
function convertProperties(
  properties: Record<string, unknown>,
): Record<string, AnthropicPropertySchema> {
  const result: Record<string, AnthropicPropertySchema> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object') {
      result[key] = convertPropertySchema(value as Record<string, unknown>);
    }
  }

  return result;
}

/**
 * Convert a single property schema
 */
function convertPropertySchema(
  prop: Record<string, unknown>,
): AnthropicPropertySchema {
  const result: AnthropicPropertySchema = {
    type: normalizeType(prop.type),
  };

  // Copy description
  if (typeof prop.description === 'string') {
    result.description = prop.description;
  }

  // Handle enum values
  if (Array.isArray(prop.enum)) {
    result.enum = prop.enum.map((v) => String(v));
  }

  // Handle array items
  if (prop.items) {
    if (Array.isArray(prop.items)) {
      // Tuple type - use first item as representative
      result.items = convertPropertySchema(
        prop.items[0] as Record<string, unknown>,
      );
    } else {
      result.items = convertPropertySchema(
        prop.items as Record<string, unknown>,
      );
    }
  }

  // Handle nested object properties
  if (prop.properties && typeof prop.properties === 'object') {
    result.properties = convertProperties(
      prop.properties as Record<string, unknown>,
    );
    // Nested objects should also have required array
    if (Array.isArray(prop.required)) {
      result.required = prop.required.map((r) => String(r));
    } else if (result.type === 'object') {
      result.required = [];
    }
  }

  // Handle numeric constraints (convert strings to numbers if needed)
  if (prop.minimum !== undefined) {
    result.minimum = toNumber(prop.minimum);
  }
  if (prop.maximum !== undefined) {
    result.maximum = toNumber(prop.maximum);
  }
  if (prop.minLength !== undefined) {
    result.minLength = toNumber(prop.minLength);
  }
  if (prop.maxLength !== undefined) {
    result.maxLength = toNumber(prop.maxLength);
  }

  // Handle default value
  if (prop.default !== undefined) {
    result.default = prop.default;
  }

  return result;
}

/**
 * Normalize type value to lowercase string.
 * Handles Gemini's uppercase Type enum (e.g., "OBJECT" → "object")
 */
function normalizeType(type: unknown): string {
  if (typeof type === 'string') {
    return type.toLowerCase();
  }
  if (typeof type === 'number') {
    // Gemini Type enum values
    const typeMap: Record<number, string> = {
      1: 'string',
      2: 'number',
      3: 'integer',
      4: 'boolean',
      5: 'array',
      6: 'object',
    };
    return typeMap[type] || 'string';
  }
  return 'string';
}

/**
 * Convert value to number, handling strings
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

/**
 * Convert an array of Gemini-style tool declarations to Anthropic format
 */
export function convertToolsToAnthropic(
  geminiTools?: Array<{
    functionDeclarations?: GeminiToolDeclaration[];
  }>,
  isOAuth?: boolean,
): AnthropicTool[] | undefined {
  if (!geminiTools || geminiTools.length === 0) {
    return undefined;
  }

  const anthropicTools: AnthropicTool[] = [];

  for (const toolGroup of geminiTools) {
    if (!toolGroup.functionDeclarations) {
      continue;
    }

    for (const decl of toolGroup.functionDeclarations) {
      // Try parametersJsonSchema first, fall back to parameters
      const toolParameters =
        'parametersJsonSchema' in decl
          ? decl.parametersJsonSchema
          : decl.parameters;

      const inputSchema = convertSchemaToAnthropic(toolParameters);

      // Prefix tool names for OAuth to avoid conflicts with Claude Code built-in tools
      const toolName = isOAuth ? `${TOOL_PREFIX}${decl.name}` : decl.name;

      anthropicTools.push({
        name: toolName,
        description: decl.description || '',
        input_schema: inputSchema,
      });
    }
  }

  if (logger.enabled && anthropicTools.length > 0) {
    logger.debug(
      () => `Converted ${anthropicTools.length} tools to Anthropic format`,
      {
        toolNames: anthropicTools.map((t) => t.name),
        firstToolHasRequired:
          anthropicTools[0]?.input_schema.required !== undefined,
      },
    );
  }

  return anthropicTools.length > 0 ? anthropicTools : undefined;
}
