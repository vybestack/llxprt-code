import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { describe, it, expect } from 'bun:test';
import { convertToolsToOpenAIVercel } from '../schemaConverter.js';

describe('convertToolsToOpenAIVercel — parametersJsonSchema source', () => {
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

    const result = convertToolsToOpenAIVercel(tools);

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

    const result = convertToolsToOpenAIVercel(tools);

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

    expect(() => convertToolsToOpenAIVercel(tools)).toThrow(
      'Tool "search_code" is missing parametersJsonSchema',
    );
  });

  it('throws when parametersJsonSchema is a non-plain object', () => {
    const tools = [
      Object.assign<ToolDeclaration, { parametersJsonSchema: unknown }>(
        {
          name: 'date_schema_tool',
          description: 'Invalid schema',
          parametersJsonSchema: {},
        },
        { parametersJsonSchema: new Date() },
      ),
    ];

    expect(() => convertToolsToOpenAIVercel(tools)).toThrow(
      'Tool "date_schema_tool" is missing parametersJsonSchema',
    );
  });
});
