import { describe, it, expect } from 'vitest';
import { convertToolsToOpenAI } from '../schemaConverter.js';

describe('convertToolsToOpenAI — parametersJsonSchema source', () => {
  it('uses parametersJsonSchema when present', () => {
    const tools = [
      {
        functionDeclarations: [
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
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('read_file');
    expect(result![0].function.parameters.properties).toHaveProperty('path');
    expect(result![0].function.parameters.required).toContain('path');
  });

  it('returns empty schema when parametersJsonSchema is absent', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'search_code',
            description: 'Search the codebase',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                maxResults: { type: 'number', description: 'Max results' },
              },
              required: ['query'],
            },
          },
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('search_code');
    expect(result![0].function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('returns empty schema only when neither field is present', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'no_params_tool',
            description: 'A tool with no parameters',
          },
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0].function.parameters.type).toBe('object');
    expect(result![0].function.parameters.properties).toEqual({});
  });

  it('uses parametersJsonSchema when both fields are present', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'dual_field_tool',
            description: 'Has both fields',
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
        ],
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

  it('handles mixed tool groups with and without parametersJsonSchema', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'schema_tool',
            description: 'Uses parametersJsonSchema',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                schema_param: { type: 'string' },
              },
              required: ['schema_param'],
            },
          },
          {
            name: 'legacy_tool',
            description: 'Missing parametersJsonSchema',
            parameters: {
              type: 'object',
              properties: {
                legacy_param: { type: 'number' },
              },
              required: ['legacy_param'],
            },
          },
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toBeDefined();
    expect(result).toHaveLength(2);

    const schemaTool = result!.find((t) => t.function.name === 'schema_tool');
    const legacyTool = result!.find((t) => t.function.name === 'legacy_tool');

    expect(schemaTool!.function.parameters.properties).toHaveProperty(
      'schema_param',
    );
    expect(legacyTool!.function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });
});
