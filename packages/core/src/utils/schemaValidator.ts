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
import AjvPkg from 'ajv';
import type { ErrorObject } from 'ajv';
// Ajv's ESM/CJS interop: default/namespace dual export.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Class = (Ajv2020Pkg as any).default ?? Ajv2020Pkg;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (AjvPkg as any).default ?? AjvPkg;

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

// See: https://ajv.js.org/options.html#strict-mode-options
//
// strictSchema defaults to true and prevents use of JSON schemas that
// include unrecognized keywords. The JSON schema spec specifically allows
// for the use of non-standard keywords and the spec-compliant behavior
// is to ignore those keywords. Note that setting this to false also
// allows use of non-standard or custom formats (the unknown format value
// will be logged but the schema will still be considered valid).
const ajvOptions = { strictSchema: false } as const;

/**
 * We maintain two Ajv instances because draft-07 and draft-2020-12 are NOT
 * behaviourally compatible: draft-2020-12 replaced tuple `items: [<schema>, …]`
 * with `prefixItems`, and enforcing 2020-12 rules against a draft-07 tuple
 * schema rejects the schema at compile time (`data/properties/X/items must
 * be object,boolean`). See
 * https://ajv.js.org/json-schema.html#draft-2020-12 and the Ajv docs:
 * "draft-2020-12 is not backwards compatible. You cannot use draft-2020-12
 * and previous JSON Schema versions in the same Ajv instance."
 *
 * Dispatch at `validate()` time based on the schema's declared `$schema`:
 *   - draft-07 URIs → `ajValidator07` (supports tuple `items: [...]`,
 *     plus all earlier keyword semantics).
 *   - draft-2020-12 URIs, unknown URIs, or no `$schema` → `ajValidator2020`
 *     (default; supports `prefixItems` tuple semantics and remains the
 *     target for schemas emitted by modern MCP servers such as
 *     `@playwright/mcp`).
 *
 * Draft-2019-09 is accepted by the 2020 instance because the two drafts
 * are keyword-compatible for every feature we exercise; MCP servers that
 * declare 2019-09 do not use tuple form or the handful of vocabularies
 * that actually diverge between 2019-09 and 2020-12.
 */
const ajValidator2020 = new Ajv2020Class(ajvOptions);
// Register draft-07 meta-schema on the 2020 instance too, so schemas that
// $ref it explicitly (without declaring it in `$schema`) still resolve.
ajValidator2020.addMetaSchema(draft07MetaSchema);

const ajValidator07 = new AjvClass(ajvOptions);

/** Register the custom formats we rely on on a given Ajv instance. */
function registerCustomFormats(instance: {
  addFormat: (name: string, format: unknown) => unknown;
}): void {
  instance.addFormat('google-duration', {
    type: 'string',
    validate: () => true,
  });
  instance.addFormat('google-fieldmask', {
    type: 'string',
    validate: () => true,
  });
  instance.addFormat('something-totally-custom', {
    type: 'string',
    validate: () => true,
  });
  // Ensure date format is available when ajv-formats is not installed
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  instance.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
}
registerCustomFormats(ajValidator2020);
registerCustomFormats(ajValidator07);

/** Returns true if the declared `$schema` URI refers to JSON Schema draft-07. */
function isDraft07SchemaUri(uri: unknown): boolean {
  return typeof uri === 'string' && /\/draft-07\/schema/.test(uri);
}

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
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- Preserve original falsy no-schema behavior for malformed schemas.
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

    // Pick the Ajv instance whose dialect matches the schema's `$schema`.
    // draft-07 schemas MUST go through ajValidator07 so tuple `items: [...]`
    // is preserved (2020-12 replaced that with `prefixItems` and Ajv2020
    // rejects the draft-07 form at compile time). Anything else — including
    // draft-2020-12, draft-2019-09, unknown drafts, and schemas without a
    // `$schema` declaration — goes through ajValidator2020, which is the
    // dialect emitted by modern MCP servers (e.g. `@playwright/mcp`).
    const declaredSchemaUri = extSchema.$schema;
    const instance = isDraft07SchemaUri(declaredSchemaUri)
      ? ajValidator07
      : ajValidator2020;

    // Create a copy of the schema without our custom properties for AJV.
    // We also strip `$schema` before compiling so that unrecognized draft
    // URIs (e.g. draft-2019-09 routed through the 2020 instance, or a
    // hypothetical future draft) don't fail with
    // `no schema with key or ref "<uri>"` when Ajv tries to resolve the
    // meta-schema. The dialect decision has already been made above by
    // inspecting `declaredSchemaUri`, so dropping the field now has no
    // effect on which keyword rules are applied.
    const ajvSchema = { ...extSchema };
    delete ajvSchema.requireOne;
    delete ajvSchema.$schema;

    const validate = instance.compile(ajvSchema);
    const valid = validate(data);

    // Check validation result - valid is boolean, errors may be undefined/null
    if (
      valid === false &&
      validate.errors != null &&
      validate.errors.length > 0
    ) {
      const formatPath = (path: string): string => {
        // Empty path should return 'params'
        if (path === '') {
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
        // Intentional falsy coalescing: empty path strings should fall through to next option
        // instancePath and dataPath may be empty strings, '', null, or undefined
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const instancePath = (err as any).instancePath;
        const dataPath = (err as any).dataPath;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const path =
          // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          (typeof instancePath === 'string' && instancePath !== ''
            ? instancePath
            : null) ??
          (typeof dataPath === 'string' && dataPath !== '' ? dataPath : null) ??
          '';
        const basePath = formatPath(path);
        const message = err.message ?? 'is invalid';
        return `${basePath} ${message}`;
      });

      const errorTextRaw = formattedErrors.join('; ');
      // Apply text replacements; nullish coalescing for optional chaining result
      const replaced =
        typeof errorTextRaw === 'string' && errorTextRaw !== ''
          ? errorTextRaw.replace(/\bshould\b/gi, 'must')
          : null;
      let errorText = replaced ?? errorTextRaw;
      // Only process non-empty error text
      if (typeof errorText === 'string' && errorText !== '') {
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
