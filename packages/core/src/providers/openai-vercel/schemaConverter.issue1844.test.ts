/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI-Vercel schema converter should consume `parametersJsonSchema` directly.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let convertToolsToOpenAIVercel: typeof import('./schemaConverter.js').convertToolsToOpenAIVercel;

describe('issue #1844 – OpenAI-Vercel schema converter schema source', () => {
  beforeAll(async () => {
    const mod = await import('./schemaConverter.js');
    convertToolsToOpenAIVercel = mod.convertToolsToOpenAIVercel;
  });

  it('should use parametersJsonSchema when present', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'write_file',
            description: 'Write a file to disk',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
                content: { type: 'string', description: 'File content' },
              },
              required: ['path', 'content'],
            },
          },
        ],
      },
    ];

    const result = convertToolsToOpenAIVercel(tools);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe('write_file');
    expect(result![0].function.parameters?.properties).toHaveProperty('path');
    expect(result![0].function.parameters?.properties).toHaveProperty(
      'content',
    );
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

    const result = convertToolsToOpenAIVercel(tools);
    expect(result).toBeDefined();
    expect(result![0].function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });
});
