/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  convertSchemaToOpenAI,
  convertToolDeclarations,
} from '../schemaConverter.js';

describe('convertSchemaToOpenAI — dropped JSON-schema keywords are preserved', () => {
  it('preserves anyOf and normalizes sub-schema types', () => {
    const schema = {
      type: 'object',
      properties: {
        status: {
          anyOf: [{ type: 'STRING' }, { type: 'NULL' }],
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const status = result.properties.status as Record<string, unknown>;

    expect(Array.isArray(status.anyOf)).toBe(true);
    const branches = status.anyOf as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(2);
    expect(branches[0].type).toBe('string');
    expect(branches[1].type).toBe('null');
  });

  it('preserves oneOf and normalizes sub-schema types', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          oneOf: [{ type: 'INTEGER' }, { type: 'NUMBER' }],
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const value = result.properties.value as Record<string, unknown>;
    const branches = value.oneOf as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(2);
    expect(branches[0].type).toBe('integer');
    expect(branches[1].type).toBe('number');
  });

  it('preserves allOf and normalizes sub-schema types', () => {
    const schema = {
      type: 'object',
      properties: {
        mixed: {
          allOf: [{ type: 'OBJECT', properties: { a: { type: 'STRING' } } }],
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const mixed = result.properties.mixed as Record<string, unknown>;
    const branches = mixed.allOf as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(1);
    expect(branches[0].type).toBe('object');
    expect(branches[0].properties).toStrictEqual({ a: { type: 'string' } });
  });

  it('preserves format and pattern alongside a normalized type', () => {
    const schema = {
      type: 'object',
      properties: {
        email: {
          type: 'STRING',
          format: 'email',
          pattern: '^.+@.+$',
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const email = result.properties.email as Record<string, unknown>;

    expect(email.type).toBe('string');
    expect(email.format).toBe('email');
    expect(email.pattern).toBe('^.+@.+$');
  });

  it('preserves const', () => {
    const schema = {
      type: 'object',
      properties: {
        color: { const: 'red' },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const color = result.properties.color as Record<string, unknown>;

    expect(color.const).toBe('red');
  });

  it('preserves a non-schema object const value verbatim (uncorrupted by schema normalization)', () => {
    const schema = {
      type: 'object',
      properties: {
        config: { const: { userId: 123, active: true } },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const config = result.properties.config as Record<string, unknown>;

    expect(config.const).toStrictEqual({ userId: 123, active: true });
  });

  it('preserves $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        thing: { $ref: '#/definitions/Foo' },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const thing = result.properties.thing as Record<string, unknown>;

    expect(thing.$ref).toBe('#/definitions/Foo');
  });

  it('preserves and normalizes nested additionalProperties (object schema)', () => {
    const schema = {
      type: 'object',
      properties: {
        bag: {
          type: 'object',
          additionalProperties: { type: 'STRING' },
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const bag = result.properties.bag as Record<string, unknown>;
    const additional = bag.additionalProperties as Record<string, unknown>;

    expect(additional.type).toBe('string');
  });

  it('preserves a boolean nested additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: {
        open: { type: 'object', additionalProperties: true },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const open = result.properties.open as Record<string, unknown>;

    expect(open.additionalProperties).toBe(true);
  });

  it('preserves a false nested additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: {
        closed: { type: 'object', additionalProperties: false },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const closed = result.properties.closed as Record<string, unknown>;

    expect(closed.additionalProperties).toBe(false);
  });

  it('preserves and normalizes top-level additionalProperties (object schema)', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'STRING' } },
      required: [],
      additionalProperties: { type: 'INTEGER' },
    };

    const result = convertSchemaToOpenAI(schema);
    const additional = result.additionalProperties as Record<string, unknown>;

    expect(additional.type).toBe('integer');
  });

  it('preserves other top-level keywords (description, format) verbatim', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: [],
      description: 'root description',
      $schema: 'http://json-schema.org/draft-07/schema#',
    };

    const result = convertSchemaToOpenAI(schema);

    expect(result.description).toBe('root description');
    expect(result.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });
});

describe('convertSchemaToOpenAI — existing normalizations still apply', () => {
  it('normalizes uppercase type to lowercase', () => {
    const schema = {
      type: 'OBJECT',
      properties: { name: { type: 'STRING' } },
      required: ['name'],
    };

    const result = convertSchemaToOpenAI(schema);

    expect(result.type).toBe('object');
    expect(result.properties.name.type).toBe('string');
  });

  it('always provides required as an array', () => {
    const withRequired = convertSchemaToOpenAI({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
    expect(withRequired.required).toStrictEqual(['a']);

    const missingRequired = convertSchemaToOpenAI({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
    expect(missingRequired.required).toStrictEqual([]);
  });

  it('coerces numeric string constraints to numbers', () => {
    const schema = {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          minimum: '5',
          maximum: '10',
          minLength: '1',
          maxLength: '3',
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const count = result.properties.count;

    expect(count.minimum).toBe(5);
    expect(count.maximum).toBe(10);
    expect(count.minLength).toBe(1);
    expect(count.maxLength).toBe(3);
  });

  it('maps the Gemini numeric Type enum to a lowercase string', () => {
    const schema = {
      type: 'object',
      properties: { flag: { type: 4 } },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);

    expect(result.properties.flag.type).toBe('boolean');
  });

  it('returns an empty object schema for any non-object input', () => {
    const nonObjects = [null, undefined, 'object', 42, ['object'], true];

    for (const input of nonObjects) {
      expect(convertSchemaToOpenAI(input)).toStrictEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    }
  });

  it('normalizes a null properties value to an empty properties object', () => {
    const result = convertSchemaToOpenAI({ type: 'object', properties: null });

    expect(result.properties).toStrictEqual({});
    expect(result.required).toStrictEqual([]);
  });

  it('normalizes a missing properties key to an empty properties object', () => {
    const result = convertSchemaToOpenAI({ type: 'object' });

    expect(result.properties).toStrictEqual({});
    expect(result.required).toStrictEqual([]);
  });

  it('converts a typical tool schema without regression', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        offset: { type: 'integer', description: 'Line offset' },
      },
      required: ['path'],
    };

    const result = convertSchemaToOpenAI(schema);

    expect(result.type).toBe('object');
    expect(result.required).toStrictEqual(['path']);
    expect(result.properties.path).toStrictEqual({
      type: 'string',
      description: 'File path',
    });
    expect(result.properties.offset).toStrictEqual({
      type: 'integer',
      description: 'Line offset',
    });
  });
});

describe('convertToolDeclarations — description strategy', () => {
  const tools = [
    {
      functionDeclarations: [
        {
          name: 'read_file',
          parametersJsonSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
    },
  ];

  it('coerces a missing description to empty string for always-string strategy', () => {
    const result = convertToolDeclarations(tools, {
      descriptionStrategy: 'always-string',
    });

    expect(result).toBeDefined();
    expect(result![0].function.description).toBe('');
  });

  it('preserves an undefined description for preserve strategy', () => {
    const result = convertToolDeclarations(tools, {
      descriptionStrategy: 'preserve',
    });

    expect(result).toBeDefined();
    expect(result![0].function.description).toBeUndefined();
  });

  it('throws when parametersJsonSchema is missing', () => {
    const badTools = [
      {
        functionDeclarations: [{ name: 'no_schema', description: 'no schema' }],
      },
    ];

    expect(() =>
      convertToolDeclarations(badTools, { descriptionStrategy: 'preserve' }),
    ).toThrow('Tool "no_schema" is missing parametersJsonSchema');
  });

  it('throws when parametersJsonSchema is a non-object value', () => {
    const badTools = [
      {
        functionDeclarations: [
          {
            name: 'null_schema',
            description: 'null schema',
            parametersJsonSchema: null,
          },
        ],
      },
    ];

    expect(() =>
      convertToolDeclarations(badTools, { descriptionStrategy: 'preserve' }),
    ).toThrow('Tool "null_schema" is missing parametersJsonSchema');
  });

  it('returns undefined when there are no tools', () => {
    expect(
      convertToolDeclarations(undefined, {
        descriptionStrategy: 'always-string',
      }),
    ).toBeUndefined();
  });
});
