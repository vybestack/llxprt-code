/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ajv v8 does not declare package "exports", so subpath imports like
// "ajv/dist/2020" are the only supported way to pull in the draft-2020-12
// build. See https://ajv.js.org/json-schema.html#draft-2020-12
// eslint-disable-next-line import/no-internal-modules
import Ajv2020Pkg from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
// Ajv's ESM/CJS interop: default/namespace dual export.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Class = (Ajv2020Pkg as any).default ?? Ajv2020Pkg;

/**
 * The JSON Schema draft-07 meta-schema, inlined verbatim from ajv's
 * `dist/refs/json-schema-draft-07.json`.
 *
 * This is inlined (rather than resolved via `createRequire` or a JSON
 * import) so that it survives esbuild bundling into `bundle/llxprt.js`
 * unchanged — dynamic `require()` calls are not statically analyzable
 * by the bundler, which caused runtime `MODULE_NOT_FOUND` failures in
 * the shipped bundle.
 *
 * We register it on the Ajv2020 instance so tool parameter schemas that
 * still declare `"$schema": "http://json-schema.org/draft-07/schema#"`
 * continue to validate alongside draft-2020-12 schemas emitted by
 * servers such as `@playwright/mcp`.
 */
const draft07MetaSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'http://json-schema.org/draft-07/schema#',
  title: 'Core schema meta-schema',
  definitions: {
    schemaArray: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#' },
    },
    nonNegativeInteger: {
      type: 'integer',
      minimum: 0,
    },
    nonNegativeIntegerDefault0: {
      allOf: [{ $ref: '#/definitions/nonNegativeInteger' }, { default: 0 }],
    },
    simpleTypes: {
      enum: [
        'array',
        'boolean',
        'integer',
        'null',
        'number',
        'object',
        'string',
      ],
    },
    stringArray: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      default: [],
    },
  },
  type: ['object', 'boolean'],
  properties: {
    $id: { type: 'string', format: 'uri-reference' },
    $schema: { type: 'string', format: 'uri' },
    $ref: { type: 'string', format: 'uri-reference' },
    $comment: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    default: true,
    readOnly: { type: 'boolean', default: false },
    examples: { type: 'array', items: true },
    multipleOf: { type: 'number', exclusiveMinimum: 0 },
    maximum: { type: 'number' },
    exclusiveMaximum: { type: 'number' },
    minimum: { type: 'number' },
    exclusiveMinimum: { type: 'number' },
    maxLength: { $ref: '#/definitions/nonNegativeInteger' },
    minLength: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    pattern: { type: 'string', format: 'regex' },
    additionalItems: { $ref: '#' },
    items: {
      anyOf: [{ $ref: '#' }, { $ref: '#/definitions/schemaArray' }],
      default: true,
    },
    maxItems: { $ref: '#/definitions/nonNegativeInteger' },
    minItems: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    uniqueItems: { type: 'boolean', default: false },
    contains: { $ref: '#' },
    maxProperties: { $ref: '#/definitions/nonNegativeInteger' },
    minProperties: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    required: { $ref: '#/definitions/stringArray' },
    additionalProperties: { $ref: '#' },
    definitions: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      default: {},
    },
    properties: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      default: {},
    },
    patternProperties: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      propertyNames: { format: 'regex' },
      default: {},
    },
    dependencies: {
      type: 'object',
      additionalProperties: {
        anyOf: [{ $ref: '#' }, { $ref: '#/definitions/stringArray' }],
      },
    },
    propertyNames: { $ref: '#' },
    const: true,
    enum: {
      type: 'array',
      items: true,
      minItems: 1,
      uniqueItems: true,
    },
    type: {
      anyOf: [
        { $ref: '#/definitions/simpleTypes' },
        {
          type: 'array',
          items: { $ref: '#/definitions/simpleTypes' },
          minItems: 1,
          uniqueItems: true,
        },
      ],
    },
    format: { type: 'string' },
    contentMediaType: { type: 'string' },
    contentEncoding: { type: 'string' },
    if: { $ref: '#' },
    then: { $ref: '#' },
    else: { $ref: '#' },
    allOf: { $ref: '#/definitions/schemaArray' },
    anyOf: { $ref: '#/definitions/schemaArray' },
    oneOf: { $ref: '#/definitions/schemaArray' },
    not: { $ref: '#' },
  },
  default: true,
};

// Use Ajv2020 so tool inputSchemas declaring
// "$schema": "https://json-schema.org/draft/2020-12/schema"
// (e.g. every tool advertised by @playwright/mcp) compile successfully.
// Ajv2020 is also backwards-compatible with schemas that omit $schema. To
// keep existing tools that still declare draft-07 working, we register the
// draft-07 meta-schema as well.
const ajValidator = new Ajv2020Class(
  // See: https://ajv.js.org/options.html#strict-mode-options
  {
    // strictSchema defaults to true and prevents use of JSON schemas that
    // include unrecognized keywords. The JSON schema spec specifically allows
    // for the use of non-standard keywords and the spec-compliant behavior
    // is to ignore those keywords. Note that setting this to false also
    // allows use of non-standard or custom formats (the unknown format value
    // will be logged but the schema will still be considered valid).
    strictSchema: false,
  },
);
ajValidator.addMetaSchema(draft07MetaSchema);
// Register custom formats used by upstream schemas
ajValidator.addFormat('google-duration', {
  type: 'string',
  validate: () => true,
});
ajValidator.addFormat('google-fieldmask', {
  type: 'string',
  validate: () => true,
});
ajValidator.addFormat('something-totally-custom', {
  type: 'string',
  validate: () => true,
});
// Ensure date format is available when ajv-formats is not installed
ajValidator.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);

/**
 * Extended JSON Schema type with custom properties
 */
interface ExtendedSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  requireOne?: string[][]; // Array of arrays - at least one property from each array must be present
  [key: string]: unknown;
}

/**
 * Simple utility to validate objects against JSON Schemas
 */
export class SchemaValidator {
  /**
   * Returns null if the data conforms to the schema described by schema (or if schema
   *  is null). Otherwise, returns a string describing the error.
   */
  static validate(schema: unknown | undefined, data: unknown): string | null {
    if (!schema) {
      return null;
    }
    if (typeof data !== 'object' || data === null) {
      return 'Value of params must be an object';
    }

    // Handle our custom requireOne validation first
    const extSchema = schema as ExtendedSchema;
    if (extSchema.requireOne) {
      for (const oneOfGroup of extSchema.requireOne) {
        const hasOne = oneOfGroup.some(
          (prop) =>
            (data as Record<string, unknown>)[prop] !== undefined &&
            (data as Record<string, unknown>)[prop] !== null &&
            (data as Record<string, unknown>)[prop] !== '',
        );
        if (!hasOne) {
          return `params must have at least one of required properties: ${oneOfGroup.join(', ')}`;
        }
      }
    }

    // Create a copy of the schema without our custom properties for AJV
    const ajvSchema = { ...extSchema };
    delete ajvSchema.requireOne;

    const validate = ajValidator.compile(ajvSchema);
    const valid = validate(data);

    if (!valid && validate.errors) {
      const formatPath = (path: string): string => {
        if (!path) {
          return 'params';
        }

        const normalized = path
          .replace(/\[(\d+)\]/g, '/$1')
          .replace(/\.+/g, '/')
          .replace(/\/+/g, '/')
          .replace(/^\/+/, '');

        return `params/${normalized}`;
      };

      const formattedErrors = validate.errors.map((err: ErrorObject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const path = (err as any).instancePath || (err as any).dataPath || '';
        const basePath = formatPath(path as string);
        const message = err.message ?? 'is invalid';
        return `${basePath} ${message}`;
      });

      const errorTextRaw = formattedErrors.join('; ');
      let errorText =
        errorTextRaw?.replace(/\bshould\b/gi, 'must') ?? errorTextRaw;
      if (errorText) {
        errorText = errorText.replace(
          /must NOT be shorter than (\d+) characters/gi,
          'must NOT have fewer than $1 characters',
        );
        if (
          /anyOf/i.test(errorText) &&
          !/must match a schema in anyOf/i.test(errorText)
        ) {
          errorText = `${errorText}; must match a schema in anyOf`;
        }
      }
      return errorText;
    }

    return null;
  }
}
