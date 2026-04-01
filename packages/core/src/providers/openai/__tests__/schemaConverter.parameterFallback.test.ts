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

  it('throws when parametersJsonSchema is absent', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'search_code',
            description: 'Search the codebase',
          },
        ],
      },
    ];

    expect(() => convertToolsToOpenAI(tools)).toThrow(
      'Tool "search_code" is missing parametersJsonSchema',
    );
  });

  it('throws for mixed tool group when any declaration lacks parametersJsonSchema', () => {
    const tools = [
      {
        functionDeclarations: [
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
          {
            name: 'legacy_tool',
            description: 'Missing schema',
          },
        ],
      },
    ];

    expect(() => convertToolsToOpenAI(tools)).toThrow(
      'Tool "legacy_tool" is missing parametersJsonSchema',
    );
  });
});
