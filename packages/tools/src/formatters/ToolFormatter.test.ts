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

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolFormatter } from './ToolFormatter.js';
import type {
  FormatterTool,
  ToolCallBlock,
  ToolFormat,
} from './IToolFormatter.js';

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
      expect(schema.enum).toStrictEqual(['1', '2', '3']);
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
      expect(blocks[0]?.parameters).toStrictEqual({ msg: 'hi' });
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

describe('ToolFormatter streaming argument accumulation', () => {
  const formatter = new ToolFormatter();

  it('concatenates chunks split mid-key and mid-value into parsed parameters', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_1', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '{"ci' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: 'ty":"SF' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '"}' } },
      blocks,
      'openai',
    );

    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
  });

  it('leaves no _argumentsString own property on the block during or after accumulation', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_2', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '{"city' } },
      blocks,
      'openai',
    );
    expect(blocks[0]).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(blocks[0], '_argumentsString'),
    ).toBe(false);
    expect(Object.keys(blocks[0] ?? {}).sort()).toStrictEqual([
      'id',
      'name',
      'parameters',
      'type',
    ]);
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '":"SF"}' } },
      blocks,
      'openai',
    );
    expect(
      Object.prototype.hasOwnProperty.call(blocks[0], '_argumentsString'),
    ).toBe(false);
    expect(Object.keys(blocks[0] ?? {}).sort()).toStrictEqual([
      'id',
      'name',
      'parameters',
      'type',
    ]);
  });

  it('accumulates arguments that arrive before the tool name is known', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_3', function: { arguments: '{"ci' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: 'ty":"SF"}' } },
      blocks,
      'openai',
    );

    expect(blocks[0]?.name).toBe('get_weather');
    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
    expect(
      Object.prototype.hasOwnProperty.call(blocks[0], '_argumentsString'),
    ).toBe(false);
  });

  it('ignores a delta with no index, creating no state', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      {
        id: 'no-index',
        function: { name: 'get_weather', arguments: '{"a":1}' },
      },
      blocks,
      'openai',
    );
    expect(blocks).toHaveLength(0);
  });

  it('keeps an indexed block while ignoring a delta with no index', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_indexed', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '{"a":1}' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      {
        id: 'no-index',
        function: { name: 'get_weather', arguments: '{"b":2}' },
      },
      blocks,
      'openai',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.parameters).toStrictEqual({ a: 1 });
  });

  it('keeps initial parameters untouched when only whitespace chunks arrive', () => {
    const sentinel = { seeded: true };
    const blocks: ToolCallBlock[] = [
      {
        type: 'tool_call',
        id: 'call_4',
        name: 'get_weather',
        parameters: sentinel,
      },
    ];
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: ' ' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '  ' } },
      blocks,
      'openai',
    );

    expect(blocks[0]?.parameters).toBe(sentinel);
  });

  it('keeps independently accumulating interleaved tool calls without cross-talk', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_a', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 1, id: 'call_b', function: { name: 'set_temperature' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '{"ci' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 1, function: { arguments: '{"tem' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: 'ty":"SF' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 1, function: { arguments: 'p":72}' } },
      blocks,
      'openai',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '"}' } },
      blocks,
      'openai',
    );

    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
    expect(blocks[1]?.parameters).toStrictEqual({ temp: 72 });
  });

  it('keeps the fully concatenated raw string when arguments never become valid JSON', () => {
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_5', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    expect(() =>
      formatter.accumulateStreamingToolCall(
        { index: 0, function: { arguments: '{"a":' } },
        blocks,
        'openai',
      ),
    ).not.toThrow();
    expect(() =>
      formatter.accumulateStreamingToolCall(
        { index: 0, function: { arguments: 'oops}' } },
        blocks,
        'openai',
      ),
    ).not.toThrow();

    expect(blocks[0]).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(blocks[0], '_argumentsString'),
    ).toBe(false);
    expect(blocks[0]?.parameters).toStrictEqual('{"a":oops}');
  });

  it('swallows a throw on an incomplete fragment and still completes from the buffer', () => {
    const initial = { before: true };
    const target: ToolCallBlock = {
      type: 'tool_call',
      id: 'call_5b',
      name: 'get_weather',
      parameters: initial,
    };
    let parametersWrites = 0;
    const proxied: ToolCallBlock = new Proxy(target, {
      set(tgt, property, value) {
        if (property === 'parameters') {
          parametersWrites += 1;
          if (parametersWrites === 1) {
            throw new Error('simulated parse failure');
          }
        }
        return Reflect.set(tgt, property, value);
      },
    });
    const blocks = [proxied];

    expect(() =>
      formatter.accumulateStreamingToolCall(
        { index: 0, function: { arguments: '{"a":' } },
        blocks,
        'openai',
      ),
    ).not.toThrow();
    expect(blocks[0]?.parameters).toBe(initial);

    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '1}' } },
      blocks,
      'openai',
    );
    expect(blocks[0]?.parameters).toStrictEqual({ a: 1 });
  });

  it('repairs a qwen double-escaped payload delivered in a single chunk', () => {
    const full = '"{\\"city\\":\\"SF\\"}"';
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_6', function: { name: 'get_weather' } },
      blocks,
      'qwen',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: full } },
      blocks,
      'qwen',
    );

    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
  });

  it('repairs a qwen double-escaped payload split across chunks', () => {
    const c1 = '"{\\"city';
    const c2 = '\\":\\"SF\\"}"';
    const blocks: ToolCallBlock[] = [];
    formatter.accumulateStreamingToolCall(
      { index: 0, id: 'call_7', function: { name: 'get_weather' } },
      blocks,
      'qwen',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: c1 } },
      blocks,
      'qwen',
    );
    formatter.accumulateStreamingToolCall(
      { index: 0, function: { arguments: c2 } },
      blocks,
      'qwen',
    );

    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
  });

  it('keeps buffering across separate ToolFormatter instances for the same block', () => {
    const blocks: ToolCallBlock[] = [];
    const first = new ToolFormatter();
    const second = new ToolFormatter();
    first.accumulateStreamingToolCall(
      { index: 0, id: 'call_8', function: { name: 'get_weather' } },
      blocks,
      'openai',
    );
    first.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '{"ci' } },
      blocks,
      'openai',
    );
    second.accumulateStreamingToolCall(
      { index: 0, function: { arguments: 'ty":"SF' } },
      blocks,
      'openai',
    );
    first.accumulateStreamingToolCall(
      { index: 0, function: { arguments: '"}' } },
      blocks,
      'openai',
    );

    expect(blocks[0]?.parameters).toStrictEqual({ city: 'SF' });
  });
});
