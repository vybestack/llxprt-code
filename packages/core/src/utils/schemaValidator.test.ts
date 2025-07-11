/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SchemaValidator } from './schemaValidator.js';
import { Type } from '@google/genai';

describe('SchemaValidator', () => {
  describe('validate', () => {
    it('should return null for valid data', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          age: { type: Type.NUMBER },
        },
        required: ['name'],
      };

      const validData = { name: 'John', age: 30 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();
    });

    it('should return error for invalid data', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          age: { type: Type.NUMBER },
        },
        required: ['name'],
      };

      const invalidData = { age: 30 }; // missing required 'name'
      const error = SchemaValidator.validate(schema, invalidData);
      expect(error).toContain('must have required property');
    });

    it('should handle numeric validation properties', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            minItems: '2', // @google/genai Schema expects strings for numeric properties
            maxItems: '5',
          },
          text: {
            type: Type.STRING,
            minLength: '3',
            maxLength: '10',
          },
          count: {
            type: Type.NUMBER,
            minimum: 0,
            maximum: 100,
          },
        },
      };

      // Valid data
      const validData = {
        items: [1, 2, 3],
        text: 'hello',
        count: 50,
      };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();

      // Too few items
      const tooFewItems = {
        items: [1],
        text: 'hello',
        count: 50,
      };
      const error1 = SchemaValidator.validate(schema, tooFewItems);
      expect(error1).toContain('must NOT have fewer than 2 items');

      // Text too short
      const textTooShort = {
        items: [1, 2],
        text: 'hi',
        count: 50,
      };
      const error2 = SchemaValidator.validate(schema, textTooShort);
      expect(error2).toContain('must NOT have fewer than 3 characters');
    });

    it('should handle nested schemas with anyOf, allOf, oneOf', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          value: {
            anyOf: [{ type: Type.STRING }, { type: Type.NUMBER }],
          },
        },
      };

      expect(SchemaValidator.validate(schema, { value: 'test' })).toBeNull();
      expect(SchemaValidator.validate(schema, { value: 123 })).toBeNull();

      const error = SchemaValidator.validate(schema, { value: true });
      expect(error).toContain('must match a schema in anyOf');
    });

    it('should handle arrays with item schemas', () => {
      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.NUMBER },
            name: { type: Type.STRING },
          },
          required: ['id'],
        },
      };

      const validData = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];
      expect(SchemaValidator.validate(schema, validData)).toBeNull();

      const invalidData = [
        { id: 1, name: 'Item 1' },
        { name: 'Item 2' }, // missing required 'id'
      ];
      const error = SchemaValidator.validate(schema, invalidData);
      expect(error).toContain('must have required property');
    });

    it('should handle additionalProperties', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
        },
        additionalProperties: { type: Type.NUMBER },
      };

      const validData = { name: 'test', extra: 123 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();

      const invalidData = { name: 'test', extra: 'not a number' };
      const error = SchemaValidator.validate(schema, invalidData);
      expect(error).toContain('must be number');
    });

    it('should convert UPPERCASE type enums to lowercase', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          count: { type: Type.NUMBER },
        },
      };

      const validData = { name: 'test', count: 5 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();
    });
  });
});
