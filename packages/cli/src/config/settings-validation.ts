/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  getSettingsSchema,
  type SettingDefinition,
  type SettingCollectionDefinition,
  SETTINGS_SCHEMA_DEFINITIONS,
} from './settingsSchema.js';

type JsonSchemaLike = Record<string, unknown>;

function isJsonSchemaLike(value: unknown): value is JsonSchemaLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unionJsonSchemas(schemas: z.ZodTypeAny[]): z.ZodTypeAny {
  if (schemas.length === 0) return z.unknown();
  if (schemas.length === 1) return schemas[0];
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function buildTypeArraySchema(def: JsonSchemaLike): z.ZodTypeAny {
  const members = (def.type as unknown[]).map((memberType) =>
    buildZodSchemaFromJsonSchema({
      ...def,
      anyOf: undefined,
      type: memberType,
    }),
  );
  return unionJsonSchemas(members);
}

function buildAnyOfSchema(def: JsonSchemaLike): z.ZodTypeAny {
  const members = (def.anyOf as unknown[]).map((schemaDef) =>
    buildZodSchemaFromJsonSchema(schemaDef),
  );
  return unionJsonSchemas(members);
}

function buildStringJsonSchema(def: JsonSchemaLike): z.ZodTypeAny {
  if (def.enum !== undefined && def.enum !== null) {
    return z.enum(def.enum as [string, ...string[]]);
  }
  return z.string();
}

function applyNumberBounds(
  schema: z.ZodNumber,
  def: { minimum?: unknown; maximum?: unknown; multipleOf?: unknown },
): z.ZodNumber {
  let boundedSchema = schema;
  if (typeof def.minimum === 'number') {
    boundedSchema = boundedSchema.min(def.minimum);
  }
  if (typeof def.maximum === 'number') {
    boundedSchema = boundedSchema.max(def.maximum);
  }
  if (typeof def.multipleOf === 'number') {
    boundedSchema = boundedSchema.multipleOf(def.multipleOf);
  }
  return boundedSchema;
}

function buildNumberJsonSchema(def: JsonSchemaLike): z.ZodTypeAny {
  return applyNumberBounds(z.number(), def);
}

function buildBooleanJsonSchema(def: JsonSchemaLike): z.ZodTypeAny {
  if ('const' in def) {
    return z.literal(def.const as never);
  }
  return z.boolean();
}

function buildArrayJsonSchema(def: JsonSchemaLike): z.ZodTypeAny {
  if (def.items !== undefined && def.items !== null) {
    return z.array(buildZodSchemaFromJsonSchema(def.items));
  }
  return z.array(z.unknown());
}

function buildJsonObjectShape(
  def: JsonSchemaLike,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredArray = def.required;
  const requiredKeys = Array.isArray(requiredArray) ? requiredArray : [];

  if (!isJsonSchemaLike(def.properties)) {
    return shape;
  }

  for (const [key, propDef] of Object.entries(def.properties)) {
    const propSchema = buildZodSchemaFromJsonSchema(propDef);
    shape[key] = requiredKeys.includes(key)
      ? propSchema
      : propSchema.optional();
  }
  return shape;
}

function buildObjectJsonSchema(def: JsonSchemaLike): z.ZodTypeAny {
  const shape = buildJsonObjectShape(def);
  const baseSchema = z.object(shape).passthrough();

  if (def.additionalProperties === false) {
    return baseSchema.strict();
  }
  if (isJsonSchemaLike(def.additionalProperties)) {
    return baseSchema.catchall(
      buildZodSchemaFromJsonSchema(def.additionalProperties),
    );
  }

  return baseSchema;
}

/**
 * Builds a Zod schema from JSON-schema-like definitions used in
 * SETTINGS_SCHEMA_DEFINITIONS.
 *
 * Handles: type, anyOf, properties, additionalProperties, required, enum, items
 */
function buildZodSchemaFromJsonSchema(def: unknown): z.ZodTypeAny {
  if (!isJsonSchemaLike(def)) return z.unknown();
  if (Array.isArray(def.type)) return buildTypeArraySchema(def);
  if (Array.isArray(def.anyOf)) return buildAnyOfSchema(def);

  switch (def.type) {
    case 'string':
      return buildStringJsonSchema(def);
    case 'number':
      return buildNumberJsonSchema(def);
    case 'boolean':
      return buildBooleanJsonSchema(def);
    case 'array':
      return buildArrayJsonSchema(def);
    case 'object':
      return buildObjectJsonSchema(def);
    default:
      return z.unknown();
  }
}

/**
 * Builds a Zod enum schema from options array.
 */
function buildEnumSchema(
  options:
    | ReadonlyArray<{ value: string | number | boolean; label: string }>
    | undefined,
): z.ZodTypeAny {
  if (!options || options.length === 0) {
    throw new Error(
      'Enum type must have options defined. Check your settings schema definition.',
    );
  }
  const values = options.map((opt) => opt.value);
  if (values.every((v) => typeof v === 'string')) {
    return z.enum(values as [string, ...string[]]);
  } else if (values.every((v) => typeof v === 'number')) {
    return z.union(
      values.map((v) => z.literal(v)) as [
        z.ZodLiteral<number>,
        z.ZodLiteral<number>,
        ...Array<z.ZodLiteral<number>>,
      ],
    );
  }
  return z.union(
    values.map((v) => z.literal(v)) as [
      z.ZodLiteral<unknown>,
      z.ZodLiteral<unknown>,
      ...Array<z.ZodLiteral<unknown>>,
    ],
  );
}

/**
 * Builds a Zod object shape from properties record.
 */
function buildObjectShapeFromProperties(
  properties: Record<string, SettingDefinition>,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, childDef] of Object.entries(properties)) {
    shape[key] = buildZodSchemaFromDefinition(childDef);
  }
  return shape;
}

/**
 * Shape accepted by buildPrimitiveSchema — captures numeric constraints.
 */
interface PrimitiveSchemaDefinition {
  type: 'string' | 'number' | 'boolean';
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
}

/**
 * Builds a Zod schema for primitive types (string, number, boolean).
 */
function buildPrimitiveSchema(
  definition: PrimitiveSchemaDefinition,
): z.ZodTypeAny {
  switch (definition.type) {
    case 'string':
      return z.string();
    case 'number':
      return applyNumberBounds(z.number(), definition);
    case 'boolean':
      return z.boolean();
    default:
      return z.unknown();
  }
}

const REF_SCHEMAS: Record<string, z.ZodTypeAny> = {};

// Initialize REF_SCHEMAS from SETTINGS_SCHEMA_DEFINITIONS
for (const [name, def] of Object.entries(SETTINGS_SCHEMA_DEFINITIONS)) {
  REF_SCHEMAS[name] = buildZodSchemaFromJsonSchema(def);
}

/**
 * Recursively builds a Zod schema from a SettingDefinition.
 */
function buildZodSchemaFromDefinition(
  definition: SettingDefinition,
): z.ZodTypeAny {
  let baseSchema: z.ZodTypeAny;

  // Handle refs using registry
  if (definition.ref && definition.ref in REF_SCHEMAS) {
    return REF_SCHEMAS[definition.ref].optional();
  }
  if (definition.type === 'union' && definition.refs) {
    return unionJsonSchemas(
      definition.refs.map((ref) => REF_SCHEMAS[ref] ?? z.unknown()),
    ).optional();
  }

  switch (definition.type) {
    case 'string':
    case 'number':
    case 'boolean':
      baseSchema = buildPrimitiveSchema(
        definition as PrimitiveSchemaDefinition,
      );
      break;

    case 'enum': {
      baseSchema = buildEnumSchema(definition.options);
      break;
    }

    case 'array':
      if (definition.items) {
        const itemSchema = buildZodSchemaFromCollection(definition.items);
        baseSchema = z.array(itemSchema);
      } else {
        baseSchema = z.array(z.unknown());
      }
      break;

    case 'object':
      if (definition.properties) {
        const shape = buildObjectShapeFromProperties(definition.properties);
        baseSchema = z.object(shape).passthrough();

        if (definition.additionalProperties === false) {
          baseSchema = z.object(shape).strict();
        } else if (definition.additionalProperties) {
          const additionalSchema = buildZodSchemaFromCollection(
            definition.additionalProperties,
          );
          baseSchema = z.object(shape).catchall(additionalSchema);
        }
      } else if (definition.additionalProperties !== undefined) {
        const additionalProperties = definition.additionalProperties;
        baseSchema =
          additionalProperties === false
            ? z.record(z.string(), z.never())
            : z.record(
                z.string(),
                buildZodSchemaFromCollection(additionalProperties),
              );
      } else {
        baseSchema = z.record(z.string(), z.unknown());
      }
      break;

    default:
      baseSchema = z.unknown();
  }

  // Make all fields optional since settings are partial
  return baseSchema.optional();
}

/**
 * Builds a Zod schema from a SettingCollectionDefinition.
 */
function buildZodSchemaFromCollection(
  collection: SettingCollectionDefinition,
): z.ZodTypeAny {
  if (collection.ref && collection.ref in REF_SCHEMAS) {
    return REF_SCHEMAS[collection.ref];
  }

  switch (collection.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return buildPrimitiveSchema(collection as PrimitiveSchemaDefinition);

    case 'enum': {
      return buildEnumSchema(collection.options);
    }

    case 'array':
      if (collection.properties) {
        const shape = buildObjectShapeFromProperties(collection.properties);
        return z.array(z.object(shape));
      }
      return z.array(z.unknown());

    case 'object':
      if (collection.properties) {
        const shape = buildObjectShapeFromProperties(collection.properties);
        return z.object(shape).passthrough();
      }
      return z.record(z.string(), z.unknown());
    case 'union':
      return unionJsonSchemas(
        (collection.refs ?? []).map((ref) => REF_SCHEMAS[ref] ?? z.unknown()),
      );

    default:
      return z.unknown();
  }
}

/**
 * Builds the complete Zod schema for Settings from SETTINGS_SCHEMA.
 */
function buildSettingsZodSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schema = getSettingsSchema();
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, definition] of Object.entries(schema)) {
    shape[key] = buildZodSchemaFromDefinition(definition);
  }

  return z.object(shape).passthrough();
}

export const settingsZodSchema = buildSettingsZodSchema();

/**
 * Validates settings data against the Zod schema.
 */
export function validateSettings(data: unknown): {
  success: boolean;
  data?: unknown;
  error?: z.ZodError;
} {
  const result = settingsZodSchema.safeParse(data);
  return result;
}

function getValidationGuidance(
  path: string,
  message?: string,
): string | undefined {
  if (
    path === 'chatCompression' &&
    message?.includes('compressionThreshold') === true
  ) {
    return 'Use model.compressionThreshold instead of chatCompression.compressionThreshold.';
  }
  if (path === 'model' && message?.includes('chatCompression') === true) {
    return 'model.chatCompression is not supported. Use model.compressionThreshold.';
  }

  switch (path) {
    case 'accessibility':
    case 'accessibility.screenReader':
    case 'accessibility.enableLoadingPhrases':
      return 'Use ui.accessibility.* for V2 settings; root accessibility.* remains accepted for legacy compatibility.';
    case 'chatCompression':
    case 'chatCompression.contextPercentageThreshold':
      return 'Use model.compressionThreshold for V2 settings; root chatCompression.contextPercentageThreshold remains accepted for legacy compatibility.';
    case 'chatCompression.compressionThreshold':
      return 'Use model.compressionThreshold instead of chatCompression.compressionThreshold.';
    case 'model.chatCompression':
      return 'model.chatCompression is not supported. Use model.compressionThreshold.';
    case 'model.compressionThreshold':
      return 'model.compressionThreshold must be a number between 0 and 1.';
    case 'model':
      return 'Use either a model name string or { name, compressionThreshold }.';
    default:
      return undefined;
  }
}

/**
 * Format a Zod error into a helpful error message for end users.
 */
export function formatValidationError(
  error: z.ZodError,
  filePath: string,
): string {
  const lines: string[] = [];
  lines.push(`Invalid configuration in ${filePath}:`);
  lines.push('');

  const MAX_ERRORS_TO_DISPLAY = 5;
  const displayedIssues = error.issues.slice(0, MAX_ERRORS_TO_DISPLAY);

  for (const issue of displayedIssues) {
    const path = issue.path.reduce<string>(
      (acc, curr) =>
        typeof curr === 'number'
          ? `${acc}[${curr}]`
          :
            `${acc.length > 0 ? acc + '.' : ''}${curr}`,
      '',
    );
    lines.push(`Error in: ${path.length > 0 ? path : '(root)'}`);
    lines.push(`    ${issue.message}`);

    if (issue.code === 'invalid_type') {
      const expected = issue.expected;
      const received = issue.received;
      lines.push(`Expected: ${expected}, but received: ${received}`);
    }
    const guidance = getValidationGuidance(path, issue.message);
    if (guidance) {
      lines.push(`Guidance: ${guidance}`);
    }

    lines.push('');
  }

  if (error.issues.length > MAX_ERRORS_TO_DISPLAY) {
    lines.push(
      `...and ${error.issues.length - MAX_ERRORS_TO_DISPLAY} more errors.`,
    );
    lines.push('');
  }

  lines.push('Please fix the configuration and try again.');
  lines.push(
    'See: https://github.com/vybestack/llxprt-code/blob/main/docs/cli/configuration.md',
  );

  return lines.join('\n');
}
