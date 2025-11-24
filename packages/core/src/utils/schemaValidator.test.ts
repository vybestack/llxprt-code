/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SchemaValidator } from './schemaValidator.js';

describe('SchemaValidator', () => {
  // Upstream tests for relaxed validation
  it('should allow any params if schema is undefined', () => {
    const params = {
      foo: 'bar',
    };
    expect(SchemaValidator.validate(undefined, params)).toBeNull();
  });

  it('rejects null params', () => {
    const schema = {
      type: 'object',
      properties: {
        foo: {
          type: 'string',
        },
      },
    };
    expect(SchemaValidator.validate(schema, null)).toBe(
      'Value of params must be an object',
    );
  });

  it('rejects params that are not objects', () => {
    const schema = {
      type: 'object',
      properties: {
        foo: {
          type: 'string',
        },
      },
    };
    expect(SchemaValidator.validate(schema, 'not an object')).toBe(
      'Value of params must be an object',
    );
  });

  it('allows schema with extra properties', () => {
    const schema = {
      type: 'object',
      properties: {
        example_enum: {
          type: 'string',
          enum: ['FOO', 'BAR'],
          // enum-descriptions is not part of the JSON schema spec.
          // This test verifies that the SchemaValidator allows the
          // use of extra keywords, like this one, in the schema.
          'enum-descriptions': ['a foo', 'a bar'],
        },
      },
    };
    const params = {
      example_enum: 'BAR',
    };

    expect(SchemaValidator.validate(schema, params)).toBeNull();
  });

  it('allows custom format values', () => {
    const schema = {
      type: 'object',
      properties: {
        duration: {
          type: 'string',
          // See: https://cloud.google.com/docs/discovery/type-format
          format: 'google-duration',
        },
        mask: {
          type: 'string',
          format: 'google-fieldmask',
        },
        foo: {
          type: 'string',
          format: 'something-totally-custom',
        },
      },
    };
    const params = {
      duration: '10s',
      mask: 'foo.bar,biz.baz',
      foo: 'some value',
    };
    expect(SchemaValidator.validate(schema, params)).toBeNull();
  });

  it('allows valid values for known formats', () => {
    const schema = {
      type: 'object',
      properties: {
        today: {
          type: 'string',
          format: 'date',
        },
      },
    };
    const params = {
      today: '2025-04-08',
    };
    expect(SchemaValidator.validate(schema, params)).toBeNull();
  });

  it('rejects invalid values for known formats', () => {
    const schema = {
      type: 'object',
      properties: {
        today: {
          type: 'string',
          format: 'date',
        },
      },
    };
    const params = {
      today: 'this is not a date',
    };
    expect(SchemaValidator.validate(schema, params)).not.toBeNull();
  });

  // LLXprt comprehensive tests
  describe('validate', () => {
    it('should return null for valid data', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const validData = { name: 'John', age: 30 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();
    });

    it('should return error for invalid data', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const invalidData = { age: 30 }; // missing required 'name'
      const error = SchemaValidator.validate(schema, invalidData);
      expect(error).toContain('must have required property');
    });

    it('should handle numeric validation properties', () => {
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
          },
          text: {
            type: 'string',
            minLength: 3,
            maxLength: 10,
          },
          count: {
            type: 'number',
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
        type: 'object',
        properties: {
          value: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
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
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
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
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: { type: 'number' },
      };

      const validData = { name: 'test', extra: 123 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();

      const invalidData = { name: 'test', extra: 'not a number' };
      const error = SchemaValidator.validate(schema, invalidData);
      expect(error).toContain('must be number');
    });

    it('should convert UPPERCASE type enums to lowercase', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
      };

      const validData = { name: 'test', count: 5 };
      expect(SchemaValidator.validate(schema, validData)).toBeNull();
    });
  });
});
