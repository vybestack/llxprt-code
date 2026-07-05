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
    asRecord(s['items'])['parent'] = s;

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
});

describe('property-based — cleanGeminiSchema invariants', () => {
  function deepFreeze<T>(value: T): Readonly<T> {
    if (typeof value === 'object' && value !== null) {
      Object.freeze(value);
      for (const key in value) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    return value;
  }

  function sortedJson(value: unknown): string {
    if (typeof value !== 'object' || value === null) {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(sortedJson).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    const pairs = keys.map(
      (k) =>
        JSON.stringify(k) +
        ':' +
        sortedJson((value as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }

  it('arbitrary JSON-object schemas never mutate the input (deep-freeze + clone compare)', () => {
    const schemaArb = fc.letrec((tie) => ({
      self: fc.oneof(
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
        // Must not throw on frozen input, and must not mutate it.
        expect(() => cleanGeminiSchema(schema)).not.toThrow();
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
          .filter(([a, b]) => a !== b),
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
