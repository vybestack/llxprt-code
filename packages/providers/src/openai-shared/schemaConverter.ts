/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared OpenAI tool-schema converter.
 *
 * This is the single source of truth for converting Gemini-style tool
 * declarations into OpenAI-compatible JSON Schema. Both the classic
 * `openai` provider and the `openai-vercel` provider import from here so
 * the two implementations cannot drift.
 *
 * Key requirements for OpenAI function calling:
 * - type: must be a lowercase string ("object", "string", etc.)
 * - required: must always be present as an array (even if empty)
 * - properties: object describing each parameter
 *
 * Rather than whitelisting a fixed set of JSON-schema keywords (which
 * silently strips anyOf/oneOf/allOf/$ref/const/format/pattern/...), this
 * converter normalizes the keywords it understands and passes every other
 * keyword through unchanged so that union types, references, and
 * validation constraints survive end-to-end.
 */

/**
 * OpenAI function parameter schema format.
 * Includes an index signature to satisfy OpenAI SDK's FunctionParameters
 * type and to carry passthrough JSON-schema keywords.
 */
export interface OpenAIFunctionParameters {
  type: 'object';
  properties: Record<string, OpenAIPropertySchema>;
  required: string[];
  additionalProperties?: boolean | OpenAIPropertySchema;
  [key: string]: unknown;
}

/**
 * OpenAI property schema (recursive for nested objects/arrays).
 * The index signature allows unhandled JSON-schema keywords (anyOf, $ref,
 * format, pattern, const, ...) to be preserved verbatim.
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
  [key: string]: unknown;
}

/**
 * Input format from Gemini-style tool declarations.
 */
interface ToolDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
}

/**
 * Property-level keywords that receive explicit normalization. Every other
 * keyword is passed through verbatim (with recursive normalization of
 * sub-schema arrays/objects) so the converter never silently drops schema
 * structure.
 */
const NORMALIZED_KEYS: ReadonlySet<string> = new Set([
  'type',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'default',
]);

/**
 * Normalize type value to a lowercase string.
 * Handles Gemini's uppercase Type enum (e.g., "OBJECT" → "object") and the
 * numeric Gemini Type enum values.
 */
function normalizeType(type: unknown): string {
  if (typeof type === 'string') {
    return type.toLowerCase();
  }
  if (typeof type === 'number') {
    const typeMap: Record<number, string> = {
      1: 'string',
      2: 'number',
      3: 'integer',
      4: 'boolean',
      5: 'array',
      6: 'object',
    };
    return typeMap[type] ?? 'string';
  }
  return 'string';
}

/**
 * Convert a value to a number, coercing numeric strings. Returns undefined
 * when the value cannot be interpreted as a number.
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

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * JSON-schema keywords whose values are themselves schema objects (or arrays
 * of schema objects). Used to decide whether a passthrough object should be
 * normalized as a sub-schema or left untouched as plain data.
 */
const SCHEMA_VALUE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'items',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  '$ref',
]);

/**
 * Determine whether a plain object looks like a JSON-schema node (i.e. it
 * declares a type or carries a keyword whose value is itself a schema). This
 * guards passthrough so that arbitrary data objects embedded in keywords like
 * `const`, `default`, or `examples` are preserved verbatim instead of being
 * corrupted by schema normalization.
 */
function isLikelySchemaNode(node: Record<string, unknown>): boolean {
  for (const key of Object.keys(node)) {
    if (SCHEMA_VALUE_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize an arbitrary passthrough value:
 * - arrays are mapped element-wise (so anyOf/oneOf/allOf sub-schemas are
 *   normalized),
 * - objects that look like schema nodes are normalized recursively,
 * - everything else (including plain data objects in `const`/`default`/...) is
 *   returned unchanged.
 */
function normalizePassthroughValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizePassthroughValue);
  }
  if (isSchemaObject(value) && isLikelySchemaNode(value)) {
    return normalizeSchemaNode(value);
  }
  return value;
}

/**
 * Apply the handled-keyword normalizations (type, description, enum, items,
 * nested properties/required, numeric constraints, default) to a schema node.
 */
function applyHandledNormalizations(
  node: Record<string, unknown>,
  result: OpenAIPropertySchema,
): void {
  if (typeof node.description === 'string') {
    result.description = node.description;
  }

  if (Array.isArray(node.enum)) {
    result.enum = node.enum.map((v) => String(v));
  }

  if (Array.isArray(node.items)) {
    if (node.items.length > 0) {
      const firstItem = node.items[0];
      if (isSchemaObject(firstItem)) {
        result.items = normalizeSchemaNode(firstItem);
      }
    }
  } else if (isSchemaObject(node.items)) {
    result.items = normalizeSchemaNode(node.items);
  }

  if (node.properties != null && typeof node.properties === 'object') {
    result.properties = convertProperties(
      node.properties as Record<string, unknown>,
    );
    if (Array.isArray(node.required)) {
      result.required = node.required.map((r) => String(r));
    } else if (result.type === 'object') {
      result.required = [];
    }
  }

  if (node.minimum !== undefined) {
    result.minimum = toNumber(node.minimum);
  }
  if (node.maximum !== undefined) {
    result.maximum = toNumber(node.maximum);
  }
  if (node.minLength !== undefined) {
    result.minLength = toNumber(node.minLength);
  }
  if (node.maxLength !== undefined) {
    result.maxLength = toNumber(node.maxLength);
  }

  if (node.default !== undefined) {
    result.default = node.default;
  }
}

/**
 * Recursively normalize a single JSON-schema node. Handled keywords are
 * normalized; every other keyword (anyOf, oneOf, allOf, $ref, const, format,
 * pattern, additionalProperties, ...) is preserved so schema structure is
 * never silently lost.
 */
function normalizeSchemaNode(
  node: Record<string, unknown>,
): OpenAIPropertySchema {
  const result: OpenAIPropertySchema = {
    type: normalizeType(node.type),
  };

  applyHandledNormalizations(node, result);

  for (const [key, value] of Object.entries(node)) {
    if (NORMALIZED_KEYS.has(key)) {
      continue;
    }
    result[key] = normalizePassthroughValue(value);
  }

  return result;
}

/**
 * Convert a properties object recursively.
 */
function convertProperties(
  properties: Record<string, unknown>,
): Record<string, OpenAIPropertySchema> {
  const result: Record<string, OpenAIPropertySchema> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (isSchemaObject(value)) {
      result[key] = normalizeSchemaNode(value);
    }
  }

  return result;
}

/**
 * Normalize a top-level `additionalProperties` value. Booleans pass through
 * unchanged; schema objects are normalized so nested types are lowercased.
 */
function normalizeAdditionalProperties(
  value: unknown,
): boolean | OpenAIPropertySchema | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (isSchemaObject(value)) {
    return normalizeSchemaNode(value);
  }
  return undefined;
}

/**
 * Top-level keywords that receive explicit handling in
 * {@link convertSchemaToOpenAI} (type is forced to 'object', properties and
 * required are normalized, additionalProperties is normalized). Every other
 * keyword present on the root schema is passed through verbatim so root-level
 * unions, references, and validation constraints survive.
 */
const TOP_LEVEL_HANDLED_KEYS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
]);

/**
 * Convert a Gemini-style schema to OpenAI JSON Schema format.
 * Handles:
 * - Uppercase type enums → lowercase strings
 * - Missing required fields → adds empty array
 * - String numeric values → proper numbers
 * - Recursive property/items/union conversion
 * - Pass-through of all other JSON-schema keywords
 */
export function convertSchemaToOpenAI(
  schema: unknown,
): OpenAIFunctionParameters {
  if (!isSchemaObject(schema)) {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  const input = schema;
  const result: OpenAIFunctionParameters = {
    type: 'object',
    properties: {},
    required: [],
  };

  if (input.properties != null && typeof input.properties === 'object') {
    result.properties = convertProperties(
      input.properties as Record<string, unknown>,
    );
  }

  if (Array.isArray(input.required)) {
    result.required = input.required.map((r) => String(r));
  } else {
    result.required = [];
  }

  const additionalProperties = normalizeAdditionalProperties(
    input.additionalProperties,
  );
  if (additionalProperties !== undefined) {
    result.additionalProperties = additionalProperties;
  }

  for (const [key, value] of Object.entries(input)) {
    if (TOP_LEVEL_HANDLED_KEYS.has(key)) {
      continue;
    }
    result[key] = normalizePassthroughValue(value);
  }

  return result;
}

/**
 * Shape of a converted tool produced by {@link convertToolDeclarations}.
 * Per-provider wrappers narrow this to their concrete tool type.
 */
export interface ConvertedToolDeclaration {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: OpenAIFunctionParameters;
  };
}

/**
 * How to materialize a tool declaration's description.
 * - `always-string`: coerce missing descriptions to '' (classic OpenAI SDK).
 * - `preserve`: keep description as string | undefined (Vercel AI SDK).
 */
export type DescriptionStrategy = 'always-string' | 'preserve';

/**
 * Shared core that both provider wrappers delegate to. Iterates Gemini-style
 * tool groups, validates each declaration has a parametersJsonSchema, and
 * converts it to OpenAI format. Returns undefined when there are no tools.
 */
export function convertToolDeclarations(
  geminiTools: Array<{ functionDeclarations?: ToolDeclaration[] }> | undefined,
  options: { descriptionStrategy: DescriptionStrategy },
): ConvertedToolDeclaration[] | undefined {
  if (!geminiTools || geminiTools.length === 0) {
    return undefined;
  }

  const converted: ConvertedToolDeclaration[] = [];

  for (const toolGroup of geminiTools) {
    if (!toolGroup.functionDeclarations) {
      continue;
    }

    for (const decl of toolGroup.functionDeclarations) {
      if (!isSchemaObject(decl.parametersJsonSchema)) {
        throw new Error(
          `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
            `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
        );
      }
      const parameters = convertSchemaToOpenAI(decl.parametersJsonSchema);
      const description =
        options.descriptionStrategy === 'always-string'
          ? (decl.description ?? '')
          : decl.description;

      converted.push({
        type: 'function',
        function: {
          name: decl.name,
          description,
          parameters,
        },
      });
    }
  }

  return converted.length > 0 ? converted : undefined;
}
