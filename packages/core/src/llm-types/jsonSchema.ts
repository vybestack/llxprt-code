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

/**
 * Dependency-free structural JSON Schema type.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-002
 * @pseudocode lines 30-37
 */

/**
 * Open structural object representing any JSON Schema keyword set.
 * Common documented keywords: type, properties, items, required, $ref,
 * $defs, definitions, anyOf, oneOf, allOf, not, additionalProperties,
 * enum, const, format, description, title, default.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-002.2
 * @pseudocode lines 30-32
 */
export interface JsonSchemaObject {
  [keyword: string]: unknown;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-002.1
 * @pseudocode line 33
 */
export type JsonSchema = boolean | JsonSchemaObject;

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-002.3
 * @pseudocode lines 34-37
 */
export function isJsonSchema(value: unknown): value is JsonSchema {
  if (typeof value === 'boolean') {
    return true;
  }
  return isRecord(value);
}

/**
 * Shared structural guard for a plain record object (non-null, non-array).
 * Used by the llm-types narrowing flows so that no type assertion is needed.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
