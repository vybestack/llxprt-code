/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cycle-safety and non-mutation tests for cleanGeminiSchema hardening.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-011.1, REQ-011.2, REQ-011.3
 * @pseudocode lines 80-88
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { cleanGeminiSchema } from './geminiSchemaHelpers.js';
import { sortedJson } from './__tests__/sortedJson.js';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  return {};
}

describe('cleanGeminiSchema — cycle safety (REQ-011.2)', () => {
  it('terminates on a self-referential (cyclic) object schema', () => {
    // Build a cyclic schema: s.properties.self === s
    const s: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    s.properties = { self: s };

    // Must not hang. Returns a cleaned object (cycle edge dropped → {}).
    const cleaned = cleanGeminiSchema(s);

    expect(cleaned).toBeDefined();
    expect(typeof cleaned).toBe('object');
  });

  it('drops the cycle edge as {} in the output (lossy-by-design)', () => {
    const s: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    s.properties = { self: s };

    const cleaned = asRecord(cleanGeminiSchema(s));
    const props = asRecord(cleaned['properties']);
    // The self-referential property becomes {} (visited hit), not a cycle.
    expect(props['self']).toStrictEqual({});
  });

  it('terminates on mutual cycle between two schema objects', () => {
    const a: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    const b: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    asRecord(a['properties'])['b'] = b;
    asRecord(b['properties'])['a'] = a;

    const cleaned = cleanGeminiSchema(a);
    expect(typeof cleaned).toBe('object');
  });

  it('terminates on cyclic items array element', () => {
    const s: Record<string, unknown> = {
      type: 'array',
      items: { type: 'object', properties: {} },
    };
    // Cycle through whitelisted keys: s → items → properties.back → s
    asRecord(asRecord(s['items'])['properties'])['back'] = s;

    expect(() => cleanGeminiSchema(s)).not.toThrow();
  });

  it('terminates on cyclic anyOf member', () => {
    const member: Record<string, unknown> = {
      type: 'object',
      properties: { back: null },
    };
    const s: Record<string, unknown> = { anyOf: [member] };
    // Create the cycle: member → properties.back → s
    asRecord(member['properties'])['back'] = s;

    expect(() => cleanGeminiSchema(s)).not.toThrow();
  });

  it('shared (diamond) reference — both occurrences cleaned, not replaced by {}', () => {
    // A non-cyclic DAG: the SAME child object referenced by two sibling
    // properties. Path-based cycle detection must clean BOTH occurrences
    // (the old global-WeakSet bug replaced the second with {}).
    const shared = { type: 'string' };
    const schema = {
      type: 'object',
      properties: { a: shared, b: shared },
    };

    const cleaned = asRecord(cleanGeminiSchema(schema));
    const props = asRecord(cleaned['properties']);
    expect(props['a']).toStrictEqual({ type: 'string' });
    expect(props['b']).toStrictEqual({ type: 'string' });
  });
});

describe('cleanGeminiSchema — non-mutation (REQ-011.1)', () => {
  it('does not mutate the input object', () => {
    const input: Record<string, unknown> = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      // unsupported key that the whitelist drops
      $ref: '#/$defs/Foo',
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    cleanGeminiSchema(input);

    expect(input).toStrictEqual(snapshot);
  });

  it('returns a NEW reference for object inputs (not the same object)', () => {
    const input = { type: 'string' };
    const result = cleanGeminiSchema(input);
    expect(result).not.toBe(input);
  });

  it('does not mutate a deep-frozen nested properties schema', () => {
    const nested = { type: 'string', exclusiveMinimum: 5 };
    const input = {
      type: 'object',
      properties: { nested },
    };
    Object.freeze(nested);
    Object.freeze(input);

    // Must not throw (no mutation of frozen inputs) and must terminate.
    expect(() => cleanGeminiSchema(input)).not.toThrow();
  });

  it('returns primitives unchanged (non-object)', () => {
    expect(cleanGeminiSchema(false)).toBe(false);
    expect(cleanGeminiSchema(true)).toBe(true);
    expect(cleanGeminiSchema(undefined)).toBeUndefined();
    expect(cleanGeminiSchema(null)).toBeNull();
    expect(cleanGeminiSchema('hello')).toBe('hello');
    expect(cleanGeminiSchema(42)).toBe(42);
  });
});

describe('cleanGeminiSchema — $ref/$defs stripping (documented lossiness)', () => {
  it('strips $ref from the output', () => {
    const input = { type: 'string', $ref: '#/$defs/Foo' };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).not.toHaveProperty('$ref');
    expect(result).toHaveProperty('type', 'string');
  });

  it('strips $defs from the output', () => {
    const input = {
      type: 'object',
      $defs: { Foo: { type: 'string' } },
      properties: {},
    };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).not.toHaveProperty('$defs');
  });

  it('strips oneOf from the output (not in whitelist)', () => {
    const input = {
      oneOf: [{ type: 'string' }, { type: 'number' }],
    };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).not.toHaveProperty('oneOf');
  });

  it('strips allOf from the output (not in whitelist)', () => {
    const input = {
      allOf: [{ type: 'string' }],
    };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).not.toHaveProperty('allOf');
  });

  it('preserves items:null verbatim (isRecord rejects null, not recursed, but copied)', () => {
    // items:null is not a record, so it is not recursed into (no cycle risk),
    // but the else branch copies it verbatim. The Gemini API expects items to
    // be a schema object or absent; null is preserved as-is for compatibility.
    const input = { type: 'array', items: null };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).toHaveProperty('items', null);
    expect(result).toHaveProperty('type', 'array');
  });

  it('cleans each member of an items tuple array (strips $ref from members)', () => {
    // JSON Schema draft-04 tuple-validation: items is an array of sub-schemas.
    // Each member must be cleaned independently so unsupported keys ($ref,
    // $defs, etc.) are stripped from every member.
    const input = {
      type: 'array',
      items: [
        { type: 'string', $ref: '#/$defs/Foo' },
        { type: 'number', $ref: '#/$defs/Bar' },
      ],
    };
    const result = asRecord(cleanGeminiSchema(input));
    const items = result['items'];
    expect(items).toBeInstanceOf(Array);
    const members = items as unknown[];
    expect(members).toHaveLength(2);
    expect(members[0]).toStrictEqual({ type: 'string' });
    expect(members[1]).toStrictEqual({ type: 'number' });
    // $ref must be stripped from each member
    expect(asRecord(members[0])).not.toHaveProperty('$ref');
    expect(asRecord(members[1])).not.toHaveProperty('$ref');
  });

  it('strips additionalProperties from the output (not in whitelist)', () => {
    const input = {
      type: 'object',
      additionalProperties: false,
      properties: {},
    };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).not.toHaveProperty('additionalProperties');
  });

  it('preserves whitelisted keys (type, description, properties)', () => {
    const input = {
      type: 'object',
      description: 'a thing',
      properties: { x: { type: 'string' } },
      required: ['x'],
    };
    const result = asRecord(cleanGeminiSchema(input));
    expect(result).toStrictEqual({
      type: 'object',
      description: 'a thing',
      properties: { x: { type: 'string' } },
      required: ['x'],
    });
  });

  it('drops prototype-polluting property names (__proto__, constructor, prototype)', () => {
    const input = {
      type: 'object',
      properties: JSON.parse(
        '{"safe":{"type":"string"},"__proto__":{"type":"string"},"constructor":{"type":"number"},"prototype":{"type":"boolean"}}',
      ) as Record<string, unknown>,
    };
    const result = asRecord(cleanGeminiSchema(input));
    const props = asRecord(result['properties']);
    expect(Object.keys(props)).toStrictEqual(['safe']);
    // The output object's prototype chain is untouched.
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
  });
});

describe('property-based — cleanGeminiSchema invariants', () => {
  function deepFreeze<T>(value: T): Readonly<T> {
    if (typeof value === 'object' && value !== null) {
      Object.freeze(value);
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    return value;
  }

  it('arbitrary JSON-object schemas never mutate the input (deep-freeze + clone compare)', () => {
    const schemaArb = fc.letrec((tie) => ({
      // maxDepth guarantees termination of schema generation across all seeds
      // and library versions. Once maxDepth is reached, only the first
      // (leaf, non-recursive) arbitrary is selected.
      self: fc.oneof(
        { maxDepth: 5 },
        fc.record({
          type: fc.constantFrom(
            'string',
            'number',
            'boolean',
            'object',
            'array',
          ),
        }),
        fc.record({
          type: fc.constant('object'),
          description: fc.string(),
          properties: fc.dictionary(fc.string({ minLength: 1 }), tie('self')),
        }),
        fc.record({
          type: fc.constant('array'),
          items: tie('self'),
        }),
        fc.record({
          $ref: fc.string({ minLength: 1 }),
          oneOf: fc.array(tie('self')),
        }),
      ),
    })).self;

    fc.assert(
      fc.property(schemaArb, (schema) => {
        const snapshot = JSON.parse(JSON.stringify(schema));
        deepFreeze(schema);
        // Separately verify: (1) no throw, (2) input not mutated,
        // (3) result is a well-formed record.
        let result: unknown;
        expect(() => {
          result = cleanGeminiSchema(schema);
        }).not.toThrow();
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(sortedJson(schema)).toBe(sortedJson(snapshot));
      }),
    );
  });

  it('arbitrary schemas with shared child references clean both occurrences identically', () => {
    const childArb = fc.record({
      type: fc.constantFrom('string', 'number', 'boolean'),
      description: fc.option(fc.string()),
    });

    fc.assert(
      fc.property(
        childArb,
        fc
          .tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }))
          .filter(
            ([a, b]) =>
              a !== b &&
              // Prototype-polluting keys are intentionally DROPPED by
              // cleanPropertiesObject (security guard) — excluded here and
              // covered by the dedicated example test below.
              !['__proto__', 'constructor', 'prototype'].includes(a) &&
              !['__proto__', 'constructor', 'prototype'].includes(b),
          ),
        (child, [keyA, keyB]) => {
          const schema = {
            type: 'object',
            properties: { [keyA]: child, [keyB]: child },
          };
          const cleaned = asRecord(cleanGeminiSchema(schema));
          const props = asRecord(cleaned['properties']);
          // Both occurrences must be cleaned (not {} — that would indicate a
          // global-visited bug), and must be structurally identical.
          const a = sortedJson(props[keyA]);
          const b = sortedJson(props[keyB]);
          expect(a).not.toBe('{}');
          expect(a).toBe(b);
        },
      ),
    );
  });
});
