/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema converter for OpenAI Responses provider.
 * Converts tool schemas to OpenAI Responses API format.
 *
 * Key requirements for OpenAI Responses API:
 * - type: 'function'
 * - name: string
 * - description: string | null
 * - parameters: object with type, properties, required
 * - strict: null
 * - required: must always be present as an array (even if empty)
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

const logger = new DebugLogger('llxprt:provider:openai-responses:schema');

export interface OpenAIResponsesParameters {
  type: 'object';
  properties: Record<string, OpenAIResponsesPropertySchema>;
  required: string[];
  [key: string]: unknown;
}

export interface OpenAIResponsesPropertySchema {
  type?: string | string[];
  properties?: Record<string, OpenAIResponsesPropertySchema>;
  required?: string[];
  [key: string]: unknown;
}

export interface OpenAIResponsesTool {
  type: 'function';
  name: string;
  description: string | null;
  parameters: OpenAIResponsesParameters;
  strict: null;
}

export function convertSchemaToOpenAIResponses(
  schema: unknown,
): OpenAIResponsesParameters {
  const converted = isSchemaObject(schema) ? convertPropertySchema(schema) : {};
  return {
    ...converted,
    type: 'object',
    properties: converted.properties ?? {},
    required: converted.required ?? [],
  };
}

function convertProperties(
  properties: Record<string, unknown>,
): Record<string, OpenAIResponsesPropertySchema> {
  const result: Record<string, OpenAIResponsesPropertySchema> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (isSchemaObject(value)) result[key] = convertPropertySchema(value);
  }
  return result;
}

/** Normalize only schema positions; const/default/enum remain literal data. */
function convertSchemaValue(value: unknown): unknown {
  return isSchemaObject(value) ? convertPropertySchema(value) : value;
}

function convertPropertySchema(
  prop: Record<string, unknown>,
): OpenAIResponsesPropertySchema {
  const result: OpenAIResponsesPropertySchema = { ...prop };
  // A union or reference without a type must not acquire a string constraint.
  if (prop.type !== undefined) {
    result.type = Array.isArray(prop.type)
      ? prop.type.map(normalizeType)
      : normalizeType(prop.type);
  }
  if (isSchemaObject(prop.properties)) {
    result.properties = convertProperties(prop.properties);
  }
  if (Array.isArray(prop.required)) {
    result.required = prop.required.map(String);
  } else if (result.type === 'object' && result.properties !== undefined) {
    result.required = [];
  }
  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
  ]) {
    if (key in prop) {
      const value = prop[key];
      result[key] = Array.isArray(value)
        ? value.map(convertSchemaValue)
        : convertSchemaValue(value);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    if (Array.isArray(prop[key]))
      result[key] = prop[key].map(convertSchemaValue);
  }
  for (const key of [
    '$defs',
    'definitions',
    'patternProperties',
    'dependentSchemas',
  ]) {
    if (isSchemaObject(prop[key])) result[key] = convertProperties(prop[key]);
  }
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength']) {
    if (prop[key] !== undefined) result[key] = toNumber(prop[key]);
  }
  return result;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Normalize authored uppercase and numeric type enums at schema positions. */
function normalizeType(type: unknown): string {
  if (typeof type === 'string') return type.toLowerCase();
  if (typeof type === 'number') {
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

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

export function convertToolsToOpenAIResponses(
  toolDeclarations?: ToolDeclaration[],
): OpenAIResponsesTool[] | undefined {
  if (!toolDeclarations || toolDeclarations.length === 0) return undefined;
  const responsesTools: OpenAIResponsesTool[] = [];
  for (const decl of toolDeclarations) {
    if (!isSchemaObject(decl.parametersJsonSchema)) {
      throw new Error(
        `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
          `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
      );
    }
    responsesTools.push({
      type: 'function',
      name: decl.name,
      description: decl.description ?? null,
      parameters: convertSchemaToOpenAIResponses(decl.parametersJsonSchema),
      strict: null,
    });
  }
  if (logger.enabled && responsesTools.length > 0) {
    logger.debug(
      () =>
        `Converted ${responsesTools.length} tools to OpenAI Responses format`,
      {
        toolNames: responsesTools.map((t) => t.name),
        firstToolHasRequired: Array.isArray(
          responsesTools[0].parameters.required,
        ),
      },
    );
  }
  return responsesTools.length > 0 ? responsesTools : undefined;
}
