/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the package-local ToolFormatter.
 *
 * Proves the four renamed conversion mappings (formerly Gemini-prefixed)
 * produce correct provider-specific output, that schema normalization is
 * applied uniformly, and that the public method surface matches the
 * IToolFormatter contract.
 *
 * These exercise the real ToolFormatter with real in-memory inputs — no mocks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolFormatter } from './ToolFormatter.js';
import type { FormatterTool, ToolFormat } from './IToolFormatter.js';

function makeDeclarations(
  overrides: Partial<{
    name: string;
    description: string;
    parametersJsonSchema: unknown;
  }> = {},
) {
  return [
    {
      functionDeclarations: [
        {
          name: overrides.name ?? 'get_weather',
          description: overrides.description ?? 'Get the weather',
          parametersJsonSchema: overrides.parametersJsonSchema ?? {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        },
      ],
    },
  ];
}

describe('ToolFormatter four conversion mappings', () => {
  const formatter = new ToolFormatter();

  describe('convertToolDeclarationsToOpenAI', () => {
    it('produces OpenAI function-tool shape with normalized schema', () => {
      const result =
        formatter.convertToolDeclarationsToOpenAI(makeDeclarations());
      expect(result).toHaveLength(1);
      expect(result?.[0]?.type).toBe('function');
      expect(result?.[0]?.function.name).toBe('get_weather');
      expect(result?.[0]?.function.description).toBe('Get the weather');
      expect(result?.[0]?.function.parameters).toMatchObject({
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      });
    });

    it('returns undefined when no declarations are provided', () => {
      expect(formatter.convertToolDeclarationsToOpenAI(undefined)).toBe(
        undefined,
      );
    });

    it('throws when parametersJsonSchema is missing (legacy fallback removed)', () => {
      expect(() =>
        formatter.convertToolDeclarationsToOpenAI([
          {
            functionDeclarations: [
              {
                name: 'no-schema',
                description: 'd',
                parametersJsonSchema: undefined,
              },
            ],
          },
        ]),
      ).toThrow(/missing parametersJsonSchema/);
    });

    it('falls back description to empty string when absent', () => {
      const result = formatter.convertToolDeclarationsToOpenAI(
        makeDeclarations({ description: '' }),
      );
      expect(result?.[0]?.function.description).toBe('');
    });
  });

  describe('convertToolDeclarationsToAnthropic', () => {
    it('produces Anthropic input_schema shape with object type', () => {
      const result =
        formatter.convertToolDeclarationsToAnthropic(makeDeclarations());
      expect(result).toHaveLength(1);
      expect(result?.[0]?.name).toBe('get_weather');
      expect(result?.[0]?.description).toBe('Get the weather');
      expect(result?.[0]?.input_schema.type).toBe('object');
      expect(result?.[0]?.input_schema).toMatchObject({
        properties: { city: { type: 'string' } },
        required: ['city'],
      });
    });

    it('returns undefined when no declarations are provided', () => {
      expect(formatter.convertToolDeclarationsToAnthropic(undefined)).toBe(
        undefined,
      );
    });

    it('throws when parametersJsonSchema is missing', () => {
      expect(() =>
        formatter.convertToolDeclarationsToAnthropic([
          {
            functionDeclarations: [
              { name: 'x', description: 'd', parametersJsonSchema: null },
            ],
          },
        ]),
      ).toThrow(/missing parametersJsonSchema/);
    });
  });

  describe('convertToolDeclarationsToFormat', () => {
    it('routes openai-family formats to OpenAI shape', () => {
      for (const format of ['openai', 'qwen', 'deepseek', 'kimi'] as const) {
        const result = formatter.convertToolDeclarationsToFormat(
          makeDeclarations(),
          format,
        ) as Array<{ type: string; function: { name: string } }>;
        expect(result).toHaveLength(1);
        expect(result[0]?.type).toBe('function');
        expect(result[0]?.function.name).toBe('get_weather');
      }
    });

    it('routes anthropic format to Anthropic shape', () => {
      const result = formatter.convertToolDeclarationsToFormat(
        makeDeclarations(),
        'anthropic',
      ) as Array<{ name: string; input_schema: { type: string } }>;
      expect(result).toHaveLength(1);
      expect(result[0]?.input_schema.type).toBe('object');
    });

    it('returns undefined when no declarations are provided', () => {
      expect(
        formatter.convertToolDeclarationsToFormat(undefined, 'openai'),
      ).toBe(undefined);
    });
  });

  describe('convertSchemaToStandard', () => {
    it('lowercases the type field', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'OBJECT',
        properties: {},
      }) as { type: string };
      expect(schema.type).toBe('object');
    });

    it('ensures required array exists for object schemas', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'object',
        properties: {},
      }) as { required: unknown };
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.required).toHaveLength(0);
    });

    it('normalizes enum values to strings', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'string',
        enum: [1, 2, 3],
      }) as { enum: unknown[] };
      expect(schema.enum).toEqual(['1', '2', '3']);
    });

    it('converts string minLength/maxLength to numbers', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'string',
        minLength: '3',
        maxLength: '10',
      }) as { minLength: unknown; maxLength: unknown };
      expect(schema.minLength).toBe(3);
      expect(schema.maxLength).toBe(10);
    });

    it('recurses into nested properties', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: { a: { type: 'string' } },
          },
        },
      }) as { properties: { nested: { required: unknown[] } } };
      expect(Array.isArray(schema.properties.nested.required)).toBe(true);
    });

    it('recurses into array items', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'array',
        items: { type: 'object', properties: { a: { type: 'string' } } },
      }) as { items: { required: unknown[] } };
      expect(Array.isArray(schema.items.required)).toBe(true);
    });

    it('passes through non-object schema unchanged structurally', () => {
      const schema = formatter.convertSchemaToStandard({
        type: 'string',
        description: 'a value',
      }) as { type: string; description: string };
      expect(schema.type).toBe('string');
      expect(schema.description).toBe('a value');
    });
  });
});

describe('ToolFormatter direct format mappings', () => {
  const formatter = new ToolFormatter();

  const genericTools: FormatterTool[] = [
    {
      function: {
        name: 'echo',
        description: 'Echo back',
        parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      },
    },
  ];

  describe('toProviderFormat', () => {
    it('converts to openai shape', () => {
      const result = formatter.toProviderFormat(
        genericTools,
        'openai',
      ) as Array<{
        type: string;
        function: { name: string };
      }>;
      expect(result[0]?.type).toBe('function');
      expect(result[0]?.function.name).toBe('echo');
    });

    it('converts to anthropic shape with input_schema', () => {
      const result = formatter.toProviderFormat(
        genericTools,
        'anthropic',
      ) as Array<{
        name: string;
        input_schema: { type: string };
      }>;
      expect(result[0]?.input_schema.type).toBe('object');
    });

    it('converts to hermes/xml shape with parameters field', () => {
      for (const format of ['hermes', 'xml'] as const) {
        const result = formatter.toProviderFormat(
          genericTools,
          format,
        ) as Array<{ name: string; parameters: unknown }>;
        expect(result[0]?.name).toBe('echo');
        expect(result[0]?.parameters).toBeDefined();
      }
    });

    it('converts to gemma shape', () => {
      const result = formatter.toProviderFormat(
        genericTools,
        'gemma',
      ) as Array<{
        type: string;
        function: { name: string };
      }>;
      expect(result[0]?.type).toBe('function');
      expect(result[0]?.function.name).toBe('echo');
    });

    it('throws on unsupported format', () => {
      expect(() => formatter.toProviderFormat(genericTools, 'mistral')).toThrow(
        /not yet implemented/,
      );
    });
  });

  describe('fromProviderFormat', () => {
    it('parses an OpenAI-format tool call', () => {
      const blocks = formatter.fromProviderFormat(
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'echo', arguments: '{"msg":"hi"}' },
        },
        'openai',
      );
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.name).toBe('echo');
      expect(blocks[0]?.id).toBe('call_1');
    });

    it('parses an Anthropic-format tool call', () => {
      const blocks = formatter.fromProviderFormat(
        { id: 'call_2', type: 'tool_use', name: 'echo', input: { msg: 'hi' } },
        'anthropic',
      );
      expect(blocks[0]?.name).toBe('echo');
      expect(blocks[0]?.parameters).toEqual({ msg: 'hi' });
    });

    it('throws on invalid OpenAI tool call', () => {
      expect(() => formatter.fromProviderFormat({ id: 'x' }, 'openai')).toThrow(
        /Invalid/,
      );
    });
  });

  describe('toResponsesTool', () => {
    it('produces Responses API shape with null defaults', () => {
      const result = formatter.toResponsesTool(genericTools);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('function');
      expect(result[0]?.name).toBe('echo');
      expect(result[0]?.strict).toBeNull();
      expect(result[0]?.parameters).toMatchObject({ type: 'object' });
    });
  });
});

describe('ToolFormatter public method surface', () => {
  it('exposes the four renamed conversion mappings plus interface methods', () => {
    const proto = ToolFormatter.prototype;
    expect(typeof proto.convertToolDeclarationsToOpenAI).toBe('function');
    expect(typeof proto.convertToolDeclarationsToAnthropic).toBe('function');
    expect(typeof proto.convertToolDeclarationsToFormat).toBe('function');
    expect(typeof proto.convertSchemaToStandard).toBe('function');
    expect(typeof proto.toProviderFormat).toBe('function');
    expect(typeof proto.fromProviderFormat).toBe('function');
    expect(typeof proto.toResponsesTool).toBe('function');
  });

  it('no longer exposes old Gemini-prefixed method names in source', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, 'ToolFormatter.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/convertGeminiToOpenAI/);
    expect(source).not.toMatch(/convertGeminiToAnthropic/);
    expect(source).not.toMatch(/convertGeminiToFormat/);
    expect(source).not.toMatch(/convertGeminiSchemaToStandard/);
    expect(source).not.toMatch(/isMissingGeminiSchema/);
  });

  it('implements the IToolFormatter contract (toProviderFormat, fromProviderFormat, toResponsesTool)', () => {
    const formatter = new ToolFormatter();
    const sample: FormatterTool[] = [
      {
        function: {
          name: 't',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    expect(formatter.toProviderFormat(sample, 'openai')).toBeInstanceOf(Array);
    expect(formatter.toResponsesTool(sample)).toBeInstanceOf(Array);
    const fmt: ToolFormat = 'openai';
    expect(
      Array.isArray(
        formatter.fromProviderFormat(
          { id: 'a', function: { name: 't', arguments: '{}' } },
          fmt,
        ),
      ),
    ).toBe(true);
  });
});
