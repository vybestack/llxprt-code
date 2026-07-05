/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.1, REQ-003.2, REQ-003.3
 * @pseudocode lines 40-53
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  toolDeclarationsFromLegacyToolset,
  type ToolDeclaration,
  type ToolChoice,
} from './toolDeclaration.js';

describe('toolDeclarationsFromLegacyToolset', () => {
  it('converts a single group with parametersJsonSchema', () => {
    const input = [
      {
        functionDeclarations: [
          {
            name: 'getWeather',
            description: 'Get weather',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual<
      ToolDeclaration[]
    >([
      {
        name: 'getWeather',
        description: 'Get weather',
        parametersJsonSchema: { type: 'object', properties: {} },
      },
    ]);
  });

  it('falls back to legacy parameters when parametersJsonSchema is absent', () => {
    const input = [
      {
        functionDeclarations: [
          {
            name: 'searchWeb',
            parameters: {
              type: 'object',
              properties: { q: { type: 'string' } },
            },
          },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      {
        name: 'searchWeb',
        parametersJsonSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
        },
      },
    ]);
  });

  it('uses empty object schema when both parametersJsonSchema and parameters are absent', () => {
    const input = [
      {
        functionDeclarations: [{ name: 'noArgs' }],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'noArgs', parametersJsonSchema: {} },
    ]);
  });

  it('prefers parametersJsonSchema over parameters when both are present', () => {
    const input = [
      {
        functionDeclarations: [
          {
            name: 'tool',
            parametersJsonSchema: { type: 'object' },
            parameters: { type: 'string' },
          },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'tool', parametersJsonSchema: { type: 'object' } },
    ]);
  });

  it('falls back to legacy parameters when parametersJsonSchema is non-schema (e.g. string)', () => {
    const input = [
      {
        functionDeclarations: [
          {
            name: 'tool',
            parametersJsonSchema: 'not-a-schema',
            parameters: { type: 'object' },
          },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'tool', parametersJsonSchema: { type: 'object' } },
    ]);
  });

  it('falls back to {} when both are non-schema', () => {
    const input = [
      {
        functionDeclarations: [
          {
            name: 'tool',
            parametersJsonSchema: 42,
            parameters: null,
          },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'tool', parametersJsonSchema: {} },
    ]);
  });

  it('falls back to {} when parametersJsonSchema is an array', () => {
    const input = [
      {
        functionDeclarations: [
          { name: 'tool', parametersJsonSchema: [1, 2, 3] },
        ],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'tool', parametersJsonSchema: {} },
    ]);
  });

  it('handles multiple groups with multiple declarations', () => {
    const input = [
      {
        functionDeclarations: [
          { name: 'a', parametersJsonSchema: { type: 'object' } },
          { name: 'b', parameters: { type: 'string' } },
        ],
      },
      {
        functionDeclarations: [{ name: 'c' }],
      },
    ];
    expect(toolDeclarationsFromLegacyToolset(input)).toStrictEqual([
      { name: 'a', parametersJsonSchema: { type: 'object' } },
      { name: 'b', parametersJsonSchema: { type: 'string' } },
      { name: 'c', parametersJsonSchema: {} },
    ]);
  });

  it('returns empty array for empty toolset', () => {
    expect(toolDeclarationsFromLegacyToolset([])).toStrictEqual([]);
  });

  it('handles group with empty functionDeclarations', () => {
    expect(
      toolDeclarationsFromLegacyToolset([{ functionDeclarations: [] }]),
    ).toStrictEqual([]);
  });

  it('preserves boolean false as parametersJsonSchema', () => {
    const input = [
      {
        functionDeclarations: [{ name: 'tool', parametersJsonSchema: false }],
      },
    ];
    const result = toolDeclarationsFromLegacyToolset(input);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).toStrictEqual({
      name: 'tool',
      parametersJsonSchema: false,
    });
  });

  it('omits description key entirely when null (null != null is false)', () => {
    // Build the input with a description field set to null at runtime.
    // The LegacyToolsetLike type declares description?: string, but the
    // implementation guards with `!= null`, so a null value is treated the
    // same as undefined and the description key is omitted from the result.
    const decl: {
      name: string;
      description?: string;
      parametersJsonSchema?: unknown;
    } = {
      name: 'tool',
      parametersJsonSchema: { type: 'object' },
    };
    Object.assign(decl, { description: null });
    const input = [{ functionDeclarations: [decl] }];
    const result = toolDeclarationsFromLegacyToolset(input);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
    expect(result[0]).not.toHaveProperty('description');
  });
});

describe('ToolChoice orthogonality', () => {
  it('auto mode without allowedToolNames', () => {
    const choice: ToolChoice = { mode: 'auto' };
    expect(choice.mode).toBe('auto');
    expect(choice.allowedToolNames).toBeUndefined();
  });

  it('required mode with allowedToolNames', () => {
    const choice: ToolChoice = {
      mode: 'required',
      allowedToolNames: ['a', 'b'],
    };
    expect(choice.mode).toBe('required');
    expect(choice.allowedToolNames).toStrictEqual(['a', 'b']);
  });

  it('none mode ignores allowedToolNames', () => {
    const choice: ToolChoice = { mode: 'none' };
    expect(choice.mode).toBe('none');
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('toolDeclaration property-based', () => {
  it.prop([
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      description: fc.option(fc.string({ maxLength: 30 })),
      schema: fc.object({ maxDepth: 3 }),
    }),
  ])(
    'preserves parametersJsonSchema byte-identically when present and valid',
    ({ name, description, schema }) => {
      const toolset = [
        {
          functionDeclarations: [
            { name, description, parametersJsonSchema: schema },
          ],
        },
      ];
      const result = toolDeclarationsFromLegacyToolset(toolset);
      if (result.length !== 1) return false;
      if (result[0].name !== name) return false;
      if (result[0].parametersJsonSchema !== schema) return false;
      // null is omitted by the `!= null` guard → description is undefined.
      if (description === null) {
        if (result[0].description !== undefined) return false;
      } else if (result[0].description !== description) {
        return false;
      }
      return true;
    },
  );

  it.prop([
    fc.array(
      fc.record({
        functionDeclarations: fc.array(
          fc.record({ name: fc.string({ minLength: 1 }) }),
        ),
      }),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'produces one ToolDeclaration per functionDeclaration across multiple groups',
    (toolset) => {
      const expectedCount = toolset.reduce(
        (sum, g) => sum + g.functionDeclarations.length,
        0,
      );
      const result = toolDeclarationsFromLegacyToolset(toolset);
      const expectedNames = toolset.flatMap((g) =>
        g.functionDeclarations.map((d) => d.name),
      );
      const actualNames = result.map((r) => r.name);
      return (
        result.length === expectedCount &&
        actualNames.every((n, i) => n === expectedNames[i])
      );
    },
  );

  it.prop([
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      description: fc.string({ maxLength: 50 }),
      parameters: fc.object({ maxDepth: 2 }),
    }),
  ])(
    'legacy parameters fallback schema is preserved byte-identically',
    ({ name, description, parameters }) => {
      const toolset = [
        { functionDeclarations: [{ name, description, parameters }] },
      ];
      const result = toolDeclarationsFromLegacyToolset(toolset);
      return (
        result.length === 1 &&
        result[0].name === name &&
        result[0].parametersJsonSchema === parameters &&
        result[0].description === description
      );
    },
  );

  it.prop([
    fc.array(fc.record({ name: fc.string({ minLength: 1 }) }), {
      minLength: 1,
      maxLength: 10,
    }),
  ])(
    'every declaration without schema gets empty object {} as parametersJsonSchema',
    (decls) => {
      const toolset = [{ functionDeclarations: decls }];
      const result = toolDeclarationsFromLegacyToolset(toolset);
      return result.every(
        (r) =>
          typeof r.parametersJsonSchema === 'object' &&
          Object.keys(r.parametersJsonSchema).length === 0,
      );
    },
  );

  it.prop([
    fc.record({
      name: fc.string({ minLength: 1 }),
      description: fc.string({ maxLength: 30 }),
      schema: fc.boolean(),
    }),
  ])(
    'boolean schema is preserved as parametersJsonSchema',
    ({ name, description, schema }) => {
      const toolset = [
        {
          functionDeclarations: [
            { name, description, parametersJsonSchema: schema },
          ],
        },
      ];
      const result = toolDeclarationsFromLegacyToolset(toolset);
      return (
        result.length === 1 &&
        result[0].parametersJsonSchema === schema &&
        result[0].description === description
      );
    },
  );
});
