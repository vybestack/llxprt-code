/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema-aware parameter coercion utility.
 *
 * LLMs (particularly Claude) sometimes return tool parameters with incorrect types:
 * - Numbers as strings: "50" instead of 50
 * - Booleans as strings: "true" instead of true
 * - Single values instead of arrays: "file.txt" instead of ["file.txt"]
 * - JSON strings instead of objects: '{"key": "value"}' instead of {key: "value"}
 *
 * This utility coerces parameters to match the expected schema types.
 *
 * @see https://github.com/vybestack/llxprt-code/issues/1146
 */

interface PropertySchema {
  type?: string;
  properties?: Record<string, PropertySchema>;
  items?: PropertySchema;
}

interface Schema {
  type?: string;
  properties?: Record<string, PropertySchema>;
}

/**
 * Normalize type string to lowercase for comparison.
 * Handles Gemini's uppercase Type enum (e.g., "ARRAY" → "array", "OBJECT" → "object").
 */
function normalizeType(type: unknown): string | undefined {
  if (typeof type === 'string') {
    return type.toLowerCase();
  }
  return undefined;
}

/**
 * Coerce a single value to match the expected type from schema.
 */
function coerceValue(value: unknown, propertySchema: PropertySchema): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const expectedType = normalizeType(propertySchema.type);

  if (!expectedType) {
    return value;
  }

  const result = coerceByType(value, expectedType, propertySchema);
  return result === undefined ? value : result;
}

function coerceByType(
  value: unknown,
  expectedType: string,
  propertySchema: PropertySchema,
): unknown | undefined {
  if (coerceNumber(value, expectedType) !== undefined) {
    return coerceNumber(value, expectedType);
  }
  if (coerceBoolean(value, expectedType) !== undefined) {
    return coerceBoolean(value, expectedType);
  }
  if (expectedType === 'array') {
    return coerceArray(value, propertySchema);
  }
  if (expectedType === 'object') {
    return coerceObject(value, propertySchema);
  }
  return undefined;
}

function coerceNumber(
  value: unknown,
  expectedType: string,
): unknown | undefined {
  if (
    (expectedType === 'number' || expectedType === 'integer') &&
    typeof value === 'string'
  ) {
    const trimmed = value.trim();
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    if (/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        return value;
      }
      if (expectedType === 'integer' && !Number.isInteger(num)) {
        return value;
      }
      return num;
    }
    return value;
  }
  return undefined;
}

function coerceBoolean(
  value: unknown,
  expectedType: string,
): unknown | undefined {
  if (expectedType === 'boolean' && typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return value;
  }
  return undefined;
}

function coerceArray(value: unknown, propertySchema: PropertySchema): unknown {
  // String → Array coercion (JSON string representing an array)
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (Array.isArray(parsed)) {
          const itemSchema = propertySchema.items;
          if (itemSchema) {
            return parsed.map((item) => coerceValue(item, itemSchema));
          }
          return parsed;
        }
      } catch {
        // Not valid JSON array, fall through to single value wrapping
      }
    }
    const itemSchema = propertySchema.items;
    if (itemSchema) {
      return [coerceValue(value, itemSchema)];
    }
    return [value];
  }

  // Single non-string value → Array coercion
  if (!Array.isArray(value)) {
    const itemSchema = propertySchema.items;
    if (itemSchema) {
      return [coerceValue(value, itemSchema)];
    }
    return [value];
  }

  // Coerce items within arrays
  const itemSchema = propertySchema.items;
  if (itemSchema) {
    return value.map((item) => coerceValue(item, itemSchema));
  }
  return value;
}

function coerceObject(
  value: unknown,
  propertySchema: PropertySchema,
): unknown | undefined {
  // String → Object coercion (JSON string)
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (typeof parsed === 'object' && parsed !== null) {
          if (propertySchema.properties) {
            return coerceObjectProperties(parsed, propertySchema);
          }
          return parsed;
        }
      } catch {
        // Not valid JSON, return original
      }
    }
    return value;
  }

  // Nested object coercion
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    propertySchema.properties
  ) {
    return coerceObjectProperties(
      value as Record<string, unknown>,
      propertySchema,
    );
  }

  return undefined;
}

/**
 * Coerce object properties according to schema.
 */
function coerceObjectProperties(
  obj: Record<string, unknown>,
  schema: PropertySchema,
): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const propertySchema = properties[key];
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      result[key] = coerceValue(value, propertySchema);
    } else {
      // Property not in schema, pass through unchanged
      result[key] = value;
    }
  }

  return result;
}

/**
 * Coerce tool parameters to match expected schema types.
 *
 * This function handles common LLM mistakes:
 * - String numbers → actual numbers (e.g., "50" → 50)
 * - String booleans → actual booleans (e.g., "true" → true)
 * - Single values → arrays when schema expects array
 * - JSON strings → objects when schema expects object
 *
 * @param params - The raw parameters from the LLM
 * @param schema - The JSON schema for the tool parameters
 * @returns Coerced parameters matching expected types
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: 'object',
 *   properties: {
 *     offset: { type: 'number' },
 *     limit: { type: 'number' },
 *   },
 * };
 * const params = { offset: '50', limit: '100' };
 * const result = coerceParametersToSchema(params, schema);
 * // result: { offset: 50, limit: 100 }
 * ```
 */
export function coerceParametersToSchema(
  params: unknown,
  schema: unknown,
): unknown {
  // Handle null/undefined params
  if (params === null || params === undefined) {
    return params;
  }

  // Handle null/undefined schema - return params unchanged
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return params;
  }

  const typedSchema = schema as Schema;

  // Only process object params
  if (typeof params !== 'object' || Array.isArray(params)) {
    return params;
  }

  // If schema doesn't have properties, return unchanged
  if (!typedSchema.properties) {
    return params;
  }

  return coerceObjectProperties(
    params as Record<string, unknown>,
    typedSchema as PropertySchema,
  );
}
