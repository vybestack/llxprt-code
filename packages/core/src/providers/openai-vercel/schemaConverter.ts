/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema converter for OpenAI Vercel provider.
 * Converts tool schemas to OpenAI-compatible JSON Schema format for use with Vercel AI SDK.
 *
 * Key requirements for OpenAI function calling:
 * - type: must be lowercase string ("object", "string", etc.)
 * - required: must always be present as an array (even if empty)
 * - properties: object describing each parameter
 */

import { DebugLogger } from '../../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:provider:openai-vercel:schema');

/**
 * OpenAI function parameter schema format
 */
export interface OpenAIFunctionParameters {
  type: 'object';
  properties: Record<string, OpenAIPropertySchema>;
  required: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * OpenAI property schema (recursive for nested objects/arrays)
 */
export interface OpenAIPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: OpenAIPropertySchema;
  properties?: Record<string, OpenAIPropertySchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
}

/**
 * OpenAI tool format for function calling (Vercel AI SDK compatible)
 */
export interface OpenAIVercelTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: OpenAIFunctionParameters;
  };
}

/**
 * Input format from Gemini-style tool declarations
 */
interface GeminiToolDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
}

/**
 * Convert a Gemini-style schema to OpenAI JSON Schema format.
 * Handles:
 * - Uppercase type enums → lowercase strings
 * - Missing required fields → adds empty array
 * - String numeric values → proper numbers
 * - Recursive property/items conversion
 */
export function convertSchemaToOpenAI(
  schema: unknown,
): OpenAIFunctionParameters {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  const input = schema as Record<string, unknown>;
  const result: OpenAIFunctionParameters = {
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

  // Ensure required is always an array - CRITICAL for K2 and other models
  if (Array.isArray(input.required)) {
    result.required = input.required.map((r) => String(r));
  } else {
    // OpenAI requires the 'required' field to be present, even if empty
    result.required = [];
  }

  // Handle additionalProperties if present
  if (typeof input.additionalProperties === 'boolean') {
    result.additionalProperties = input.additionalProperties;
  }

  return result;
}

/**
 * Convert properties object recursively
 */
function convertProperties(
  properties: Record<string, unknown>,
): Record<string, OpenAIPropertySchema> {
  const result: Record<string, OpenAIPropertySchema> = {};

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
): OpenAIPropertySchema {
  const result: OpenAIPropertySchema = {
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
 * Convert an array of Gemini-style tool declarations to OpenAI Vercel format
 */
export function convertToolsToOpenAIVercel(
  geminiTools?: Array<{
    functionDeclarations?: GeminiToolDeclaration[];
  }>,
): OpenAIVercelTool[] | undefined {
  if (!geminiTools || geminiTools.length === 0) {
    return undefined;
  }

  const openAITools: OpenAIVercelTool[] = [];

  for (const toolGroup of geminiTools) {
    if (!toolGroup.functionDeclarations) {
      continue;
    }

    for (const decl of toolGroup.functionDeclarations) {
      const parameters = convertSchemaToOpenAI(decl.parametersJsonSchema);

      openAITools.push({
        type: 'function',
        function: {
          name: decl.name,
          description: decl.description,
          parameters,
        },
      });
    }
  }

  if (logger.enabled && openAITools.length > 0) {
    logger.debug(
      () => `Converted ${openAITools.length} tools to OpenAI Vercel format`,
      {
        toolNames: openAITools.map((t) => t.function.name),
        firstToolHasRequired:
          openAITools[0]?.function.parameters?.required !== undefined,
      },
    );
  }

  return openAITools.length > 0 ? openAITools : undefined;
}
