/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
// ajv v8 does not declare package "exports", so subpath imports like
// "ajv/dist/2020" are the only supported way to pull in the draft-2020-12
// build and its meta-schema. See https://ajv.js.org/json-schema.html#draft-2020-12
// eslint-disable-next-line import/no-internal-modules
import Ajv2020Pkg from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
// Ajv's ESM/CJS interop: use 'any' for compatibility as recommended by Ajv docs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Class = (Ajv2020Pkg as any).default ?? Ajv2020Pkg;
// The draft-07 meta-schema ships as a .json file inside the ajv package. Using
// createRequire keeps us compatible with both ESM runtimes (Node ESM, Vitest)
// and the TypeScript build without relying on JSON import attributes.
const requireFromHere = createRequire(import.meta.url);
const draft07MetaSchema = requireFromHere(
  'ajv/dist/refs/json-schema-draft-07.json',
);
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
