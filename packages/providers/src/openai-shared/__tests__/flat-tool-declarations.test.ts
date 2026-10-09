/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { convertToolsToOpenAI } from '../../openai/schemaConverter.js';
import { convertToolsToOpenAIVercel } from '../../openai-vercel/schemaConverter.js';
import { convertToolsToOpenAIResponses } from '../../openai-responses/schemaConverter.js';
import { convertToolsToAnthropic } from '../../anthropic/schemaConverter.js';

const declarations: ToolDeclaration[] = [
  {
    name: 'search',
    description: 'Find a file',
    parametersJsonSchema: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
        limit: { type: 'INTEGER', minimum: '1', default: 10 },
      },
      required: ['query'],
    },
  },
  { name: 'status', parametersJsonSchema: {} },
];
const searchParameters: {
  type: 'object';
  properties: Record<
    string,
    { type: string; minimum?: number; default?: number }
  >;
  required: string[];
} = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, default: 10 },
  },
  required: ['query'],
};
const emptyParameters: {
  type: 'object';
  properties: Record<string, never>;
  required: string[];
} = { type: 'object', properties: {}, required: [] };

describe('flat neutral declarations at provider boundaries', () => {
  it('emits ordered classic OpenAI tools and defaults absent descriptions', () => {
    expect(convertToolsToOpenAI(declarations)).toStrictEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Find a file',
          parameters: searchParameters,
        },
      },
      {
        type: 'function',
        function: {
          name: 'status',
          description: '',
          parameters: emptyParameters,
        },
      },
    ]);
  });

  it('emits Vercel tools while preserving an absent description', () => {
    expect(convertToolsToOpenAIVercel(declarations)).toStrictEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Find a file',
          parameters: searchParameters,
        },
      },
      {
        type: 'function',
        function: {
          name: 'status',
          description: undefined,
          parameters: emptyParameters,
        },
      },
    ]);
  });

  it('emits Responses tools with null strictness and absent descriptions', () => {
    expect(convertToolsToOpenAIResponses(declarations)).toStrictEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Find a file',
        parameters: searchParameters,
        strict: null,
      },
      {
        type: 'function',
        name: 'status',
        description: null,
        parameters: emptyParameters,
        strict: null,
      },
    ]);
  });

  it('emits Anthropic schemas and OAuth-prefixed names in declaration order', () => {
    expect(convertToolsToAnthropic(declarations, true)).toStrictEqual([
      {
        name: 'llxprt_search',
        description: 'Find a file',
        input_schema: searchParameters,
      },
      { name: 'llxprt_status', description: '', input_schema: emptyParameters },
    ]);
  });

  for (const [name, convert] of Object.entries({
    openai: convertToolsToOpenAI,
    vercel: convertToolsToOpenAIVercel,
    responses: convertToolsToOpenAIResponses,
    anthropic: convertToolsToAnthropic,
  })) {
    it.each([false, true])(
      `${name} rejects boolean schema %s rather than widening it`,
      (schema) => {
        expect(() =>
          convert([{ name: 'denied', parametersJsonSchema: schema }]),
        ).toThrow('Tool "denied" is missing parametersJsonSchema');
      },
    );
    it(`${name} leaves input schemas unchanged and omits empty tool payloads`, () => {
      const before = structuredClone(declarations);
      convert(declarations);
      expect(declarations).toStrictEqual(before);
      expect(convert([])).toBeUndefined();
      expect(convert(undefined)).toBeUndefined();
    });
  }
});
