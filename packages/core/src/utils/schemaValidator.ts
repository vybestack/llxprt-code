/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema } from '@google/genai';
import AjvPkg from 'ajv';
// Ajv's ESM/CJS interop: use 'any' for compatibility as recommended by Ajv docs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (AjvPkg as any).default || AjvPkg;
const ajValidator = new AjvClass();

/**
 * Simple utility to validate objects against JSON Schemas
 */
export class SchemaValidator {
  /**
   * Returns null if the data confroms to the schema described by schema (or if schema
   *  is null). Otherwise, returns a string describing the error.
   */
  static validate(schema: Schema | undefined, data: unknown): string | null {
    if (!schema) {
      return null;
    }
    if (typeof data !== 'object' || data === null) {
      return 'Value of params must be an object';
    }

    const objectSchema = this.toObjectSchema(schema);
    const validate = ajValidator.compile(objectSchema);
    const valid = validate(data);

    if (!valid && validate.errors) {
      const errorText = ajValidator.errorsText(validate.errors, {
        dataVar: 'params',
      });
      return errorText;
    }

    return null;
  }

  /**
   * Converts @google/genai's Schema to an object compatible with avj.
   * This is necessary because it represents Types as an Enum (with
   * UPPERCASE values) and some numeric properties (minItems, maxItems, minLength, maxLength,
   * minProperties, maxProperties) as strings, when they should be numbers for AJV.
   */
  private static toObjectSchema(schema: Schema): object {
    const newSchema: Record<string, unknown> = { ...schema };

    // Handle schema composition keywords
    if (newSchema.anyOf && Array.isArray(newSchema.anyOf)) {
      newSchema.anyOf = newSchema.anyOf.map((v) => this.toObjectSchema(v));
    }
    if (newSchema.allOf && Array.isArray(newSchema.allOf)) {
      newSchema.allOf = newSchema.allOf.map((v) => this.toObjectSchema(v));
    }
    if (newSchema.oneOf && Array.isArray(newSchema.oneOf)) {
      newSchema.oneOf = newSchema.oneOf.map((v) => this.toObjectSchema(v));
    }

    // Handle items (can be a schema or array of schemas for tuples)
    if (newSchema.items) {
      if (Array.isArray(newSchema.items)) {
        newSchema.items = newSchema.items.map((item) =>
          this.toObjectSchema(item),
        );
      } else {
        newSchema.items = this.toObjectSchema(newSchema.items);
      }
    }

    // Handle properties
    if (newSchema.properties && typeof newSchema.properties === 'object') {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.toObjectSchema(value as Schema);
      }
      newSchema.properties = newProperties;
    }

    // Handle additionalProperties if it's a schema
    if (
      newSchema.additionalProperties &&
      typeof newSchema.additionalProperties === 'object'
    ) {
      newSchema.additionalProperties = this.toObjectSchema(
        newSchema.additionalProperties as Schema,
      );
    }

    // Handle patternProperties
    if (
      newSchema.patternProperties &&
      typeof newSchema.patternProperties === 'object'
    ) {
      const newPatternProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.patternProperties)) {
        newPatternProperties[key] = this.toObjectSchema(value as Schema);
      }
      newSchema.patternProperties = newPatternProperties;
    }

    // Handle dependencies (can be array of property names or schema)
    if (newSchema.dependencies && typeof newSchema.dependencies === 'object') {
      const newDependencies: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.dependencies)) {
        if (Array.isArray(value)) {
          // Property dependencies (array of property names)
          newDependencies[key] = value;
        } else {
          // Schema dependencies
          newDependencies[key] = this.toObjectSchema(value as Schema);
        }
      }
      newSchema.dependencies = newDependencies;
    }

    // Handle if/then/else
    if (newSchema.if) {
      newSchema.if = this.toObjectSchema(newSchema.if as Schema);
    }
    if (newSchema.then) {
      newSchema.then = this.toObjectSchema(newSchema.then as Schema);
    }
    if (newSchema.else) {
      newSchema.else = this.toObjectSchema(newSchema.else as Schema);
    }

    // Handle not
    if (newSchema.not) {
      newSchema.not = this.toObjectSchema(newSchema.not as Schema);
    }

    // Convert type from UPPERCASE enum to lowercase string
    if (newSchema.type) {
      newSchema.type = String(newSchema.type).toLowerCase();
    }

    // Convert string-based numeric properties to numbers for AJV
    const stringNumericProperties = [
      'minItems',
      'maxItems',
      'minLength',
      'maxLength',
      'minProperties',
      'maxProperties',
    ];

    for (const prop of stringNumericProperties) {
      if (newSchema[prop] !== undefined) {
        newSchema[prop] = Number(newSchema[prop]);
      }
    }

    // These properties are already numbers in @google/genai Schema,
    // but ensure they are numbers for AJV compatibility
    const numericProperties = ['minimum', 'maximum', 'multipleOf'];
    for (const prop of numericProperties) {
      if (
        newSchema[prop] !== undefined &&
        typeof newSchema[prop] === 'string'
      ) {
        newSchema[prop] = Number(newSchema[prop]);
      }
    }

    return newSchema;
  }
}
