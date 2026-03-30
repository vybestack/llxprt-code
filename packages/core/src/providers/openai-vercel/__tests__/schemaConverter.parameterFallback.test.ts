import { describe, it, expect } from 'vitest';
import { convertToolsToOpenAIVercel } from '../schemaConverter.js';

describe('convertToolsToOpenAIVercel — parametersJsonSchema source', () => {
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

    const result = convertToolsToOpenAIVercel(tools);

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

    const result = convertToolsToOpenAIVercel(tools);

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

    const result = convertToolsToOpenAIVercel(tools);

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

    const result = convertToolsToOpenAIVercel(tools);

    expect(result).toBeDefined();
    expect(result![0].function.parameters.properties).toHaveProperty(
      'fromJsonSchema',
    );
    expect(result![0].function.parameters.properties).not.toHaveProperty(
      'fromParameters',
    );
  });
});
