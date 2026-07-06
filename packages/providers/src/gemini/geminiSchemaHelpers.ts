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

/** Module-private narrowing predicate for plain records (non-array objects). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanPropertiesObject(
  properties: unknown,
  visited: WeakSet<object>,
): Record<string, Schema> {
  const cleaned: Record<string, Schema> = {};
  if (!isRecord(properties)) {
    return cleaned;
  }
  for (const propKey of Object.keys(properties)) {
    // Schema-supplied keys are attacker-influenced (e.g. third-party MCP tool
    // schemas parsed from JSON). Skip prototype-polluting names outright.
    if (
      propKey === '__proto__' ||
      propKey === 'constructor' ||
      propKey === 'prototype'
    ) {
      continue;
    }
    cleaned[propKey] = cleanGeminiSchemaInternal(properties[propKey], visited);
  }
  return cleaned;
}

function cleanAnyOfArray(value: unknown, visited: WeakSet<object>): Schema[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => cleanGeminiSchemaInternal(item, visited));
}

/**
 * Internal recursive core of {@link cleanGeminiSchema}. Threads a `visited`
 * WeakSet for PATH-BASED cycle detection: a schema is added to `visited`
 * before recursing into its children and removed after the subtree is
 * processed (try/finally). This means only true ancestor-cycles hit the
 * visited check; shared sibling references (diamond/DAG shapes) clean
 * normally on every occurrence. A cycle edge yields `{}`.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-011.1, REQ-011.2
 * @pseudocode lines 80-86
 */
function cleanGeminiSchemaInternal(
  schema: unknown,
  visited: WeakSet<object>,
): Schema {
  // Primitives pass through unchanged. The public contract returns Schema but
  // historically passes non-object garbage through verbatim; this assertion is
  // unavoidable without an API change (Schema has no primitive fields).
  if (!isRecord(schema)) {
    return schema as Schema;
  }

  if (visited.has(schema)) {
    const empty: Schema = {};
    return empty;
  }
  visited.add(schema);

  const cleanedSchema: Record<string, unknown> = {};
  try {
    for (const key of SUPPORTED_SCHEMA_PROPERTIES) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        continue;
      }
      if (key === 'properties') {
        cleanedSchema[key] = cleanPropertiesObject(schema[key], visited);
      } else if (key === 'items' && isRecord(schema[key])) {
        // Note: items:null passes through verbatim via the else branch below
        // (isRecord rejects null, so it is not recursed into, but the value
        // is still copied). The Gemini API expects items to be a schema
        // object or absent; null is preserved as-is for compatibility.
        cleanedSchema[key] = cleanGeminiSchemaInternal(schema[key], visited);
      } else if (key === 'items' && Array.isArray(schema[key])) {
        // Tuple-validation items array (JSON Schema draft-04 tuples): each
        // member is a sub-schema that must be cleaned independently so $ref
        // and other unsupported keys are stripped from every member.
        const itemsArray = schema[key];
        cleanedSchema[key] = itemsArray.map((item: unknown) =>
          cleanGeminiSchemaInternal(item, visited),
        );
      } else if (key === 'anyOf') {
        cleanedSchema[key] = cleanAnyOfArray(schema[key], visited);
      } else if (Array.isArray(schema[key])) {
        // Copy array-valued generic keys (enum, required, ...) so the
        // returned schema shares no array references with the input.
        cleanedSchema[key] = [...schema[key]];
      } else {
        cleanedSchema[key] = schema[key];
      }
    }
  } finally {
    // Remove from path so sibling references to the same object clean normally.
    visited.delete(schema);
  }
  return cleanedSchema as Schema;
}

/**
 * Cleans a JSON Schema object to ensure it strictly conforms to the Gemini
 * API's supported Schema definition. Acts as a whitelist, removing properties
 * not explicitly supported by the Gemini API (e.g. `exclusiveMinimum`).
 *
 * Cycle-safe and non-mutating: a `visited` WeakSet is used for PATH-BASED cycle
 * detection — each schema reference is added before recursing into its children
 * and removed (via try/finally) after the subtree is processed, so only true
 * ancestor-cycles are detected while shared sibling references (diamond/DAG
 * shapes) are cleaned normally on every occurrence. A cycle edge yields `{}`
 * (lossy-by-design, documented). The input is never mutated — a fresh copy is
 * always returned for object schemas.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-011.1, REQ-011.2, REQ-011.3
 * @pseudocode lines 80-88
 */
export function cleanGeminiSchema(schema: unknown): Schema {
  return cleanGeminiSchemaInternal(schema, new WeakSet());
}
