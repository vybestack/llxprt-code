/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Schema } from '@google/genai';

/** Set of values considered missing/falsy in legacy schema checks (non-nullish falsy + nullish). */
const MISSING_SCHEMA_VALUES = new Set<unknown>([false, 0, '', undefined, null]);

/**
 * Helper predicate: checks if a schema value is missing/falsy in the legacy
 * sense. Preserves old `!schema` semantics: reject all falsy runtime values
 * (undefined, null, false, 0, empty string), not only nullish.
 */
export function isMissingGeminiSchema(value: unknown): boolean {
  return MISSING_SCHEMA_VALUES.has(value);
}

const SUPPORTED_SCHEMA_PROPERTIES: ReadonlyArray<keyof Schema> = [
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'minProperties',
  'maxProperties',
  'minLength',
  'maxLength',
  'pattern',
  'example',
  'anyOf',
  'propertyOrdering',
  'default',
  'items',
  'minimum',
  'maximum',
];

function cleanPropertiesObject(properties: unknown): Record<string, Schema> {
  const cleaned: Record<string, Schema> = {};
  if (properties === null || typeof properties !== 'object') {
    return cleaned;
  }
  const source = properties as Record<string, unknown>;
  for (const propKey in source) {
    cleaned[propKey] = cleanGeminiSchema(source[propKey]);
  }
  return cleaned;
}

function cleanAnyOfArray(value: unknown): Schema[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => cleanGeminiSchema(item));
}

/**
 * Cleans a JSON Schema object to ensure it strictly conforms to the Gemini
 * API's supported Schema definition. Acts as a whitelist, removing properties
 * not explicitly supported by the Gemini API (e.g. `exclusiveMinimum`).
 */
export function cleanGeminiSchema(schema: unknown): Schema {
  if (typeof schema !== 'object' || schema === null) {
    return schema as Schema;
  }

  const typedSchema = schema as Record<string, unknown>;
  const cleanedSchema: Record<string, unknown> = {};

  for (const key of SUPPORTED_SCHEMA_PROPERTIES) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      continue;
    }
    if (key === 'properties') {
      cleanedSchema[key] = cleanPropertiesObject(typedSchema[key]);
    } else if (key === 'items' && typeof typedSchema[key] === 'object') {
      cleanedSchema[key] = cleanGeminiSchema(typedSchema[key]);
    } else if (key === 'anyOf') {
      cleanedSchema[key] = cleanAnyOfArray(typedSchema[key]);
    } else {
      cleanedSchema[key] = typedSchema[key];
    }
  }
  return cleanedSchema as Schema;
}
