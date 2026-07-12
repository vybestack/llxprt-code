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

  it('preserves and normalizes not/if/then/else single-sub-schema keywords', () => {
    const schema = {
      type: 'object',
      properties: {
        conditional: {
          if: { type: 'STRING' },
          then: { type: 'INTEGER' },
          else: { type: 'BOOLEAN' },
          not: { type: 'NULL' },
        },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const conditional = result.properties.conditional as Record<
      string,
      unknown
    >;

    expect((conditional.if as Record<string, unknown>).type).toBe('string');
    expect((conditional.then as Record<string, unknown>).type).toBe('integer');
    expect((conditional.else as Record<string, unknown>).type).toBe('boolean');
    expect((conditional.not as Record<string, unknown>).type).toBe('null');
  });

  it('normalizes uppercase types recursively inside array items', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const tags = result.properties.tags as Record<string, unknown>;

    expect(tags.type).toBe('array');
    expect((tags.items as Record<string, unknown>).type).toBe('string');
  });

  it('preserves primitive const/default values that coincidentally match keyword names', () => {
    // The literal strings 'string' and 'object' are valid JSON-schema type
    // names but here they are plain const/default DATA and must survive
    // verbatim (not be mistaken for schema structure).
    const schema = {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'string' },
        fallback: { type: 'string', default: 'object' },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const kind = result.properties.kind as Record<string, unknown>;
    const fallback = result.properties.fallback as Record<string, unknown>;

    expect(kind.const).toBe('string');
    expect(fallback.default).toBe('object');
  });

  it('preserves required on a nested object schema that has no inline properties', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: { type: 'object', required: ['ref'] },
      },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const nested = result.properties.nested as Record<string, unknown>;

    expect(nested.required).toStrictEqual(['ref']);
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

  it('preserves a const object that uses schema-ish key names verbatim', () => {
    // A plain data object whose keys happen to match JSON-schema keyword names
    // (type, properties). It must NOT be mistaken for a schema node and
    // re-normalized, which would corrupt the data.
    const descriptor = {
      type: 'widget',
      properties: ['a', 'b'],
      title: 'my widget',
    };
    const schema = {
      type: 'object',
      properties: { descriptor: { const: descriptor } },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const prop = result.properties.descriptor as Record<string, unknown>;

    expect(prop.const).toStrictEqual(descriptor);
  });

  it('preserves a default object that uses schema-ish key names verbatim', () => {
    const fallback = { type: 'number', properties: { x: 1 } };
    const schema = {
      type: 'object',
      properties: { value: { type: 'object', default: fallback } },
      required: [],
    };

    const result = convertSchemaToOpenAI(schema);
    const value = result.properties.value as Record<string, unknown>;

    expect(value.default).toStrictEqual(fallback);
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

  it('maps the Gemini numeric Type enum to a lowercase string for all values', () => {
    const cases: Array<[unknown, string]> = [
      [1, 'string'],
      [2, 'number'],
      [3, 'integer'],
      [4, 'boolean'],
      [5, 'array'],
      [6, 'object'],
    ];

    for (const [enumValue, expected] of cases) {
      const result = convertSchemaToOpenAI({
        type: 'object',
        properties: { f: { type: enumValue } },
        required: [],
      });
      expect(result.properties.f.type).toBe(expected);
    }
  });

  it('falls back to string for an unknown numeric Type enum value', () => {
    const result = convertSchemaToOpenAI({
      type: 'object',
      properties: { f: { type: 999 } },
      required: [],
    });

    expect(result.properties.f.type).toBe('string');
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
    ).toThrow('no_schema');
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
    ).toThrow('null_schema');
  });

  it('returns undefined when there are no tools', () => {
    expect(
      convertToolDeclarations(undefined, {
        descriptionStrategy: 'always-string',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when functionDeclarations is an empty array', () => {
    expect(
      convertToolDeclarations([{ functionDeclarations: [] }], {
        descriptionStrategy: 'preserve',
      }),
    ).toBeUndefined();
  });

  it('passes through a declaration missing the name property', () => {
    // documents current behavior
    const result = convertToolDeclarations(
      [
        {
          functionDeclarations: [
            {
              description: 'no name',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
      { descriptionStrategy: 'preserve' },
    );

    expect(result).toBeDefined();
    expect(result![0].function.name).toBeUndefined();
  });

  it('throws when functionDeclarations is not an array', () => {
    expect(() =>
      convertToolDeclarations(
        [
          {
            functionDeclarations: 'not-an-array' as unknown as never[],
          },
        ],
        { descriptionStrategy: 'preserve' },
      ),
    ).toThrow('undefined');
  });
});

describe('convertToolDeclarations — full output mapping', () => {
  it('converts a complex nested tool declaration end-to-end', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'search',
            description: 'Search things',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Query text' },
                filters: {
                  type: 'object',
                  properties: {
                    region: { type: 'STRING' },
                    tags: { type: 'ARRAY', items: { type: 'STRING' } },
                  },
                  required: ['region'],
                },
                mode: { anyOf: [{ type: 'STRING' }, { type: 'NULL' }] },
              },
              required: ['query'],
            },
          },
        ],
      },
    ];

    const result = convertToolDeclarations(tools, {
      descriptionStrategy: 'always-string',
    });

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);

    const tool = result![0];
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('search');
    expect(tool.function.description).toBe('Search things');

    const params = tool.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toStrictEqual(['query']);

    const filters = params.properties.filters as Record<string, unknown>;
    expect(filters.required).toStrictEqual(['region']);
    expect(
      (filters.properties as Record<string, unknown>).region,
    ).toStrictEqual({
      type: 'string',
    });
    const tags = (filters.properties as Record<string, unknown>).tags as Record<
      string,
      unknown
    >;
    expect(tags.type).toBe('array');
    expect((tags.items as Record<string, unknown>).type).toBe('string');

    const mode = params.properties.mode as Record<string, unknown>;
    const branches = mode.anyOf as Array<Record<string, unknown>>;
    expect(branches[0].type).toBe('string');
    expect(branches[1].type).toBe('null');
  });
});
