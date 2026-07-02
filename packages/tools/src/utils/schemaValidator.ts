/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local SchemaValidator for tool parameter validation.
 *
 * This is a self-contained copy of the SchemaValidator utility that
 * was in packages/core/src/utils/schemaValidator.ts. It uses the `ajv`
 * package directly with zero core imports.
 *
 * Tool files (tools.ts, ripGrep.ts, and the pause tool) need schema validation
 * for their parameter schemas. Moving this utility into the tools package
 * eliminates the core dependency.
 */

// ajv v8 does not declare package "exports", so subpath imports like
// "ajv/dist/2020" are the only supported way to pull in the draft-2020-12
// build. See https://ajv.js.org/json-schema.html#draft-2020-12
import Ajv2020Pkg from 'ajv/dist/2020.js';
import AjvPkg from 'ajv';
import type { ErrorObject } from 'ajv';
// Ajv's ESM/CJS interop: default/namespace dual export.
type AjvValidateFunction = ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};
type AjvConstructor = new (options: unknown) => {
  compile: (schema: unknown) => AjvValidateFunction;
  addMetaSchema: (schema: unknown, key?: string) => void;
  addFormat: (name: string, format: unknown) => unknown;
};
const Ajv2020Class: AjvConstructor =
  (Ajv2020Pkg as unknown as { default?: AjvConstructor } & AjvConstructor)
    .default ?? (Ajv2020Pkg as unknown as AjvConstructor);
const AjvClass: AjvConstructor =
  (AjvPkg as unknown as { default?: AjvConstructor } & AjvConstructor)
    .default ?? (AjvPkg as unknown as AjvConstructor);

/**
 * The JSON Schema draft-07 meta-schema, inlined verbatim from ajv's
 * `dist/refs/json-schema-draft-07.json`.
 *
 * This is inlined (rather than resolved via `createRequire` or a JSON
 * import) so that the meta-schema is available at module scope without a
 * runtime file lookup.
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
const ajvOptions = { strictSchema: false } as const;

/**
 * Two Ajv instances because draft-07 and draft-2020-12 are NOT
 * behaviourally compatible. See the long comment in the core version
 * of this file for details.
 */
const ajValidator2020 = new Ajv2020Class(ajvOptions);
ajValidator2020.addMetaSchema(draft07MetaSchema);

const ajValidator07 = new AjvClass(ajvOptions);

/** Register custom formats on a given Ajv instance. */
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
  instance.addFormat('date', {
    type: 'string',
    validate: (value: string) => isValidDateString(value),
  });
}
registerCustomFormats(ajValidator2020);
registerCustomFormats(ajValidator07);

/**
 * Validates a date string in YYYY-MM-DD format without regex.
 */
function isValidDateString(value: string): boolean {
  if (value.length !== 10) {
    return false;
  }
  if (value[4] !== '-' || value[7] !== '-') {
    return false;
  }
  const year = value.slice(0, 4);
  const month = value.slice(5, 7);
  const day = value.slice(8, 10);
  return (
    year.split('').every((c) => c >= '0' && c <= '9') &&
    month.split('').every((c) => c >= '0' && c <= '9') &&
    day.split('').every((c) => c >= '0' && c <= '9')
  );
}

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
  requireOne?: string[][];
  [key: string]: unknown;
}

/** Resolves the error path from AJV instancePath or dataPath. */
function resolveErrorPath(instancePath: unknown, dataPath: unknown): string {
  if (typeof instancePath === 'string' && instancePath !== '') {
    return instancePath;
  }
  if (typeof dataPath === 'string' && dataPath !== '') {
    return dataPath;
  }
  return '';
}

/**
 * Package-local SchemaValidator utility for tool parameter validation.
 * Zero core imports — uses ajv directly.
 */
export class SchemaValidator {
  static validate(schema: unknown | undefined, data: unknown): string | null {
    if (schema === undefined || schema === null) {
      return null;
    }
    if (typeof data !== 'object' || data === null) {
      return 'Value of params must be an object';
    }

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

    const declaredSchemaUri = extSchema.$schema;
    const instance = isDraft07SchemaUri(declaredSchemaUri)
      ? ajValidator07
      : ajValidator2020;

    const ajvSchema = { ...extSchema };
    delete ajvSchema.requireOne;
    delete ajvSchema.$schema;

    const validate = instance.compile(ajvSchema);
    const valid = validate(data);

    if (
      valid === false &&
      validate.errors != null &&
      validate.errors.length > 0
    ) {
      return SchemaValidator.formatErrors(validate.errors);
    }

    return null;
  }

  private static formatPath(rawPath: string): string {
    if (rawPath === '') {
      return 'params';
    }

    const normalized = rawPath
      .replace(/\[(\d+)\]/g, '/$1')
      .replace(/\.+/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '');

    return `params/${normalized}`;
  }

  private static formatErrors(errors: ErrorObject[]): string {
    const formattedErrors = errors.map((err: ErrorObject) => {
      const errorRecord = err as ErrorObject & {
        instancePath?: string;
        dataPath?: string;
      };
      const instancePath = errorRecord.instancePath;
      const dataPath = errorRecord.dataPath;
      const path = resolveErrorPath(instancePath, dataPath);
      const basePath = SchemaValidator.formatPath(path);
      const message = err.message ?? 'is invalid';
      return `${basePath} ${message}`;
    });

    const errorTextRaw = formattedErrors.join('; ');
    const replaced =
      typeof errorTextRaw === 'string' && errorTextRaw !== ''
        ? errorTextRaw.replace(/\bshould\b/gi, 'must')
        : null;
    let errorText = replaced ?? errorTextRaw;
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
}
