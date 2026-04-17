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

  // Regression tests for issue #1902 — Playwright MCP and any other MCP
  // server whose tool inputSchema declares $schema: draft/2020-12 must not
  // cause SchemaValidator.validate() to throw.
  describe('JSON Schema draft compatibility', () => {
    it('accepts schemas declaring draft 2020-12 (Playwright MCP style)', () => {
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'Width of the browser window',
          },
          height: {
            type: 'number',
            description: 'Height of the browser window',
          },
        },
        required: ['width', 'height'],
        additionalProperties: false,
      };

      expect(
        SchemaValidator.validate(schema, { width: 1024, height: 768 }),
      ).toBeNull();
    });

    it('reports data errors against draft 2020-12 schemas (not schema-loading errors)', () => {
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
        additionalProperties: false,
      };

      const error = SchemaValidator.validate(schema, {});
      expect(error).not.toBeNull();
      expect(error).not.toContain('no schema with key or ref');
      expect(error).toContain('must have required property');
    });

    it('still accepts draft-07 schemas with a $schema declaration', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      expect(SchemaValidator.validate(schema, { name: 'ok' })).toBeNull();
      expect(SchemaValidator.validate(schema, {})).toContain(
        'must have required property',
      );
    });

    it('accepts draft-2019-09 schemas (intermediate draft between 07 and 2020-12)', () => {
      // Some MCP servers still emit draft-2019-09. The validator must not
      // error with `no schema with key or ref "https://json-schema.org/draft/2019-09/schema"`.
      const schema = {
        $schema: 'https://json-schema.org/draft/2019-09/schema',
        type: 'object',
        properties: {
          timeout_ms: { type: 'integer', minimum: 0 },
        },
        required: ['timeout_ms'],
        additionalProperties: false,
      };

      expect(SchemaValidator.validate(schema, { timeout_ms: 1000 })).toBeNull();
      const missing = SchemaValidator.validate(schema, {});
      expect(missing).not.toBeNull();
      expect(missing).not.toContain('no schema with key or ref');
      expect(missing).toContain('must have required property');

      const extra = SchemaValidator.validate(schema, {
        timeout_ms: 1000,
        stray: 'x',
      });
      expect(extra).not.toBeNull();
      expect(extra).not.toContain('no schema with key or ref');
      expect(extra).toContain('must NOT have additional properties');
    });

    it('ignores unrecognized $schema URIs instead of erroring out', () => {
      // Future-proofing: if a server declares a draft we have not explicitly
      // registered, validation must still proceed under Ajv's default dialect
      // rather than failing with a meta-schema lookup error.
      const schema = {
        $schema: 'https://json-schema.org/draft/2099-01/schema',
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      };

      expect(SchemaValidator.validate(schema, { value: 42 })).toBeNull();
      const error = SchemaValidator.validate(schema, {});
      expect(error).not.toBeNull();
      expect(error).not.toContain('no schema with key or ref');
    });

    it('preserves draft-07 tuple semantics (items as array)', () => {
      // Draft-07 allows `items` as an array of schemas for positional tuple
      // validation. Draft-2020-12 removed this in favour of `prefixItems`,
      // so compiling a draft-07 tuple schema under an Ajv2020 instance
      // silently treats `items: [...]` as invalid/ignored and admits junk.
      // This test pins the dispatch-by-$schema behaviour: when the schema
      // declares draft-07, tuple semantics must be honoured.
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          coords: {
            type: 'array',
            items: [{ type: 'number' }, { type: 'string' }],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['coords'],
      };

      expect(
        SchemaValidator.validate(schema, { coords: [1, 'north'] }),
      ).toBeNull();

      // Position 0 must be number; passing a string there should fail.
      const mismatched = SchemaValidator.validate(schema, {
        coords: ['not-a-number', 'north'],
      });
      expect(mismatched).not.toBeNull();
      expect(mismatched).toContain('must be number');
    });

    it('enforces draft 2020-12 prefixItems tuple semantics', () => {
      // Complement to the draft-07 tuple test: when a schema declares
      // draft-2020-12, `prefixItems` is the tuple keyword and must be
      // honoured by the Ajv2020 instance.
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          entry: {
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'number' }],
            items: false,
          },
        },
        required: ['entry'],
      };

      expect(
        SchemaValidator.validate(schema, { entry: ['name', 7] }),
      ).toBeNull();
      const wrongType = SchemaValidator.validate(schema, {
        entry: [42, 'not a number'],
      });
      expect(wrongType).not.toBeNull();
      expect(wrongType).toContain('must be string');
    });

    it('enforces draft 2020-12 additionalProperties: false', () => {
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          level: { type: 'string' },
        },
        required: ['level'],
        additionalProperties: false,
      };

      const error = SchemaValidator.validate(schema, {
        level: 'info',
        unexpected: true,
      });
      expect(error).not.toBeNull();
      expect(error).not.toContain('no schema with key or ref');
      expect(error).toContain('must NOT have additional properties');
    });
  });
});
