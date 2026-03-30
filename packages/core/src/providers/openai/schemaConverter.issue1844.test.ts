/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI schema converter should consume `parametersJsonSchema` directly.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let convertToolsToOpenAI: typeof import('./schemaConverter.js').convertToolsToOpenAI;

describe('issue #1844 – OpenAI schema converter schema source', () => {
  beforeAll(async () => {
    const mod = await import('./schemaConverter.js');
    convertToolsToOpenAI = mod.convertToolsToOpenAI;
  });

  it('should use parametersJsonSchema when present', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read a file from disk',
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

  it('should return valid empty schema when parametersJsonSchema is absent', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'no_schema_tool',
            description: 'No schema',
            parameters: {
              type: 'object',
              properties: {
                ignored: { type: 'string' },
              },
              required: ['ignored'],
            },
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
