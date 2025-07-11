/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema } from '@google/genai';
import * as ajv from 'ajv';

const ajValidator = new ajv.Ajv();

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
    const validate = ajValidator.compile(this.toObjectSchema(schema));
    const valid = validate(data);
    if (!valid && validate.errors) {
      return ajValidator.errorsText(validate.errors, { dataVar: 'params' });
    }
    return null;
  }

  /**
   * Converts @google/genai's Schema to an object compatible with avj.
   * This is necessry because it represents Types as an Enum (with
   * UPPERCASE values) and minItems and minLength as strings, when they should be numbers.
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
        newSchema.items = newSchema.items.map((item) => this.toObjectSchema(item));
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
    if (newSchema.additionalProperties && typeof newSchema.additionalProperties === 'object') {
      newSchema.additionalProperties = this.toObjectSchema(newSchema.additionalProperties as Schema);
    }
    
    // Handle patternProperties
    if (newSchema.patternProperties && typeof newSchema.patternProperties === 'object') {
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
    
    // Convert all numeric properties from strings to numbers
    const numericProperties = [
      'minItems',
      'maxItems',
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'minProperties',
      'maxProperties',
      'multipleOf'
    ];
    
    for (const prop of numericProperties) {
      if (newSchema[prop] !== undefined) {
        newSchema[prop] = Number(newSchema[prop]);
      }
    }
    
    return newSchema;
  }
}
