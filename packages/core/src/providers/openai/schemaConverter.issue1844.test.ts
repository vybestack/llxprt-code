/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI schema converter should fall back to `parameters` when
 * `parametersJsonSchema` is absent — subagent declarations set `parameters`.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let convertToolsToOpenAI: typeof import('./schemaConverter.js').convertToolsToOpenAI;

describe('issue #1844 – OpenAI schema converter fallback', () => {
  beforeAll(async () => {
    const mod = await import('./schemaConverter.js');
    convertToolsToOpenAI = mod.convertToolsToOpenAI;
  });

  it('should use parameters when parametersJsonSchema is absent (subagent path)', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read a file from disk',
            parameters: {
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

  it('should prefer parametersJsonSchema over parameters when both are present', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'my_tool',
            description: 'A tool',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
            parameters: {
              type: 'object',
              properties: {
                other: { type: 'string' },
              },
            },
          },
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);
    expect(result).toBeDefined();
    expect(result![0].function.parameters.properties).toHaveProperty('query');
    expect(result![0].function.parameters.properties).not.toHaveProperty(
      'other',
    );
  });

  it('should return valid empty schema when neither field exists', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'no_schema_tool',
            description: 'No schema',
          },
        ],
      },
    ];

    const result = convertToolsToOpenAI(tools);
    expect(result).toBeDefined();
    expect(result![0].function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });
});
