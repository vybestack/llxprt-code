import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { describe, it, expect } from 'bun:test';
import { convertToolsToOpenAI } from '../schemaConverter.js';

describe('convertToolsToOpenAI — parametersJsonSchema source', () => {
  it('uses parametersJsonSchema when present', () => {
    const tools = [
      {
        name: 'read_file',
        description: 'Read a file',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('read_file');
    expect(result![0].function.parameters.properties).toHaveProperty('path');
    expect(result![0].function.parameters.required).toContain('path');
  });

  it('uses parametersJsonSchema when both schema fields are present', () => {
    const tools = [
      {
        name: 'dual_field_tool',
        description: 'Has both schema fields',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            fromJsonSchema: { type: 'string' },
          },
          required: [],
        },
        parameters: {
          type: 'object',
          properties: {
            fromParameters: { type: 'string' },
          },
          required: [],
        },
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result![0].function.parameters.properties).toHaveProperty(
      'fromJsonSchema',
    );
    expect(result![0].function.parameters.properties).not.toHaveProperty(
      'fromParameters',
    );
  });

  it('throws when parametersJsonSchema is absent', () => {
    const tools = [
      Object.assign<ToolDeclaration, { parametersJsonSchema: unknown }>(
        {
          ...{
            name: 'search_code',
            description: 'Search the codebase',
          },
          parametersJsonSchema: {},
        },
        { parametersJsonSchema: undefined },
      ),
    ];

    expect(() => convertToolsToOpenAI(tools)).toThrow(
      'Tool "search_code" is missing parametersJsonSchema',
    );
  });

  it('throws for mixed tool group when any declaration lacks parametersJsonSchema', () => {
    const tools = [
      {
        name: 'schema_tool',
        description: 'Has schema',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            schema_param: { type: 'string' },
          },
          required: ['schema_param'],
        },
      },
      Object.assign<ToolDeclaration, { parametersJsonSchema: unknown }>(
        {
          ...{
            name: 'legacy_tool',
            description: 'Missing schema',
          },
          parametersJsonSchema: {},
        },
        { parametersJsonSchema: undefined },
      ),
    ];

    expect(() => convertToolsToOpenAI(tools)).toThrow(
      'Tool "legacy_tool" is missing parametersJsonSchema',
    );
  });
});
