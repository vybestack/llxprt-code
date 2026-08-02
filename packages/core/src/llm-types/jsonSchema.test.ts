/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-002.1, REQ-002.2, REQ-002.3
 * @pseudocode lines 30-37
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  isJsonSchema,
  type JsonSchema,
  type JsonSchemaObject,
} from './jsonSchema.js';

describe('isJsonSchema', () => {
  it('accepts boolean true', () => {
    expect(isJsonSchema(true)).toBe(true);
  });

  it('accepts boolean false', () => {
    expect(isJsonSchema(false)).toBe(true);
  });

  it('accepts empty object', () => {
    expect(isJsonSchema({})).toBe(true);
  });

  it('accepts object with type keyword', () => {
    expect(isJsonSchema({ type: 'string' })).toBe(true);
  });

  it('accepts object with $ref', () => {
    expect(isJsonSchema({ $ref: '#/$defs/foo' })).toBe(true);
  });

  it('accepts object with $defs and definitions', () => {
    expect(isJsonSchema({ $defs: {}, definitions: {} })).toBe(true);
  });

  it('accepts object with anyOf/oneOf/allOf/not', () => {
    expect(isJsonSchema({ anyOf: [], oneOf: [], allOf: [], not: false })).toBe(
      true,
    );
  });

  it('accepts object with additionalProperties boolean', () => {
    expect(isJsonSchema({ additionalProperties: false })).toBe(true);
  });

  it('accepts deeply nested object schema', () => {
    expect(
      isJsonSchema({
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/$defs/item' } },
        },
      }),
    ).toBe(true);
  });

  it('rejects null', () => {
    expect(isJsonSchema(null)).toBe(false);
  });

  it('rejects number', () => {
    expect(isJsonSchema(42)).toBe(false);
  });

  it('rejects string', () => {
    expect(isJsonSchema('string')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isJsonSchema('')).toBe(false);
  });

  it('rejects array', () => {
    expect(isJsonSchema([1, 2, 3])).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isJsonSchema(undefined)).toBe(false);
  });
});

describe('JsonSchemaObject structural type usage', () => {
  it('allows arbitrary keyword access as documented', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Person',
    };
    expect(isJsonSchema(schema)).toBe(true);
    // The type is open structural — any keyword is allowed
    const custom: JsonSchemaObject = { 'x-custom-keyword': 42 };
    expect(isJsonSchema(custom)).toBe(true);
  });

  it('JsonSchema union admits boolean and object', () => {
    const a: JsonSchema = true;
    const b: JsonSchema = { type: 'string' };
    const c: JsonSchema = false;
    expect(isJsonSchema(a)).toBe(true);
    expect(isJsonSchema(b)).toBe(true);
    expect(isJsonSchema(c)).toBe(true);
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('jsonSchema property-based', () => {
  it('isJsonSchema is true for any boolean', () =>
    fc.assert(
      fc.property(fc.boolean(), (v: boolean) => isJsonSchema(v) === true),
    ));

  it('isJsonSchema is true for any plain object', () =>
    fc.assert(
      fc.property(
        fc.object({ maxDepth: 3 }),
        (v: object) => isJsonSchema(v) === true,
      ),
    ));

  it('isJsonSchema is false for numbers, strings, null, and undefined', () =>
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (v: unknown) => isJsonSchema(v) === false,
      ),
    ));

  it('isJsonSchema is false for arrays', () =>
    fc.assert(
      fc.property(
        fc.array(fc.string()),
        (v: string[]) => isJsonSchema(v) === false,
      ),
    ));

  it('schema with type and properties is recognized as JsonSchema', () =>
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant('object'),
          properties: fc.object({ maxDepth: 2 }),
        }),
        (schema) => isJsonSchema(schema) === true,
      ),
    ));

  it('schema with $ref keyword is recognized as JsonSchema', () =>
    fc.assert(
      fc.property(
        fc.record({ $ref: fc.string({ minLength: 1, maxLength: 30 }) }),
        (schema) => isJsonSchema(schema) === true,
      ),
    ));

  it('arbitrary-keyed object schema is always recognized as JsonSchema', () =>
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.nat()),
        (schema) => isJsonSchema(schema) === true,
      ),
    ));
});
