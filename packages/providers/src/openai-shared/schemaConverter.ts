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
  // Non-string, non-enum values default to 'string'. This preserves the
  // original converters' tolerant fallback rather than throwing on malformed
  // input; a bad enum value still yields a usable (if imprecise) schema.
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
    // parseFloat is intentionally tolerant (e.g. "10px" -> 10). This matches
    // the original converters' coercion; tightening to Number() would turn
    // partially-numeric constraints into undefined and silently drop them.
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
 * JSON-schema keywords whose values are arrays of sub-schemas. Each element is
 * normalized so types inside unions (anyOf/oneOf/allOf) are lowercased.
 */
const SCHEMA_ARRAY_KEYS: ReadonlySet<string> = new Set([
  'anyOf',
  'oneOf',
  'allOf',
]);

/**
 * JSON-schema keywords whose values are a single sub-schema. The value is
 * normalized so its type is lowercased.
 */
const SCHEMA_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'not',
  'if',
  'then',
  'else',
]);

/**
 * Normalize an array of sub-schemas (the value of anyOf/oneOf/allOf). Each
 * element that is a schema object is normalized; non-schema elements (and
 * non-array values) are returned verbatim so malformed input is not corrupted.
 */
function normalizeSchemaArray(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((element) => {
    if (isSchemaObject(element)) {
      return normalizeSchemaNode(element);
    }
    return element;
  });
}

/**
 * Normalize a single sub-schema (the value of not/if/then/else). Returns the
 * value verbatim when it is not a schema object.
 */
function normalizeSchemaValue(value: unknown): unknown {
  if (isSchemaObject(value)) {
    return normalizeSchemaNode(value);
  }
  return value;
}

/**
 * Normalize a passthrough keyword value by its known JSON-schema position.
 * - anyOf/oneOf/allOf hold arrays of sub-schemas → each element normalized.
 * - not/if/then/else hold a single sub-schema → normalized.
 * - additionalProperties holds a sub-schema or a boolean → normalized.
 * - every other keyword (const, default, examples, format, pattern, $ref,
 *   title, ...) is copied VERBATIM. This is intentional: those values are
 *   arbitrary data, never schemas, so recursively normalizing them would
 *   corrupt plain data objects that merely happen to use schema-ish key names.
 */
function normalizePassthroughField(key: string, value: unknown): unknown {
  if (SCHEMA_ARRAY_KEYS.has(key)) {
    return normalizeSchemaArray(value);
  }
  if (SCHEMA_OBJECT_KEYS.has(key)) {
    return normalizeSchemaValue(value);
  }
  if (key === 'additionalProperties') {
    return normalizeAdditionalProperties(value);
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
    // Coerce to strings: OpenAI's JSON Schema enum expects string members,
    // and Gemini may supply numeric enum codes.
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
  }

  // `required` is handled independently of `properties` so that a nested
  // object schema declaring `required` without an inline `properties` block
  // (e.g. one referencing $defs) does not silently drop its required fields.
  // OpenAI requires `required` to always be present as an array, so object
  // schemas without an explicit `required` default to an empty array.
  if (Array.isArray(node.required)) {
    result.required = node.required.map((r) => String(r));
  } else if (result.type === 'object' && result.properties !== undefined) {
    result.required = [];
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
    result[key] = normalizePassthroughField(key, value);
  }

  return result;
}

/**
 * Convert a properties object recursively. Non-schema property values
 * (strings/numbers/booleans/null) are skipped: per JSON Schema, each
 * `properties` entry must itself be a schema object, so a non-object value is
 * malformed input rather than data to preserve. This matches the original
 * converters' behavior.
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
    result[key] = normalizePassthroughField(key, value);
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
 *
 * @throws {Error} when any tool declaration lacks a valid
 *   `parametersJsonSchema` object. The error names the offending tool so
 *   callers can identify the misconfigured declaration.
 */
export function convertToolDeclarations(
  toolDeclarations:
    | Array<{ functionDeclarations?: ToolDeclaration[] }>
    | undefined,
  options: { descriptionStrategy: DescriptionStrategy },
): ConvertedToolDeclaration[] | undefined {
  if (!toolDeclarations || toolDeclarations.length === 0) {
    return undefined;
  }

  const converted: ConvertedToolDeclaration[] = [];

  for (const toolGroup of toolDeclarations) {
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
