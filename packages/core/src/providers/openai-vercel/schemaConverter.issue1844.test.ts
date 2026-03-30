/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI-Vercel schema converter should fall back to `parameters` when
 * `parametersJsonSchema` is absent — subagent declarations set `parameters`.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let convertToolsToOpenAIVercel: typeof import('./schemaConverter.js').convertToolsToOpenAIVercel;

describe('issue #1844 – OpenAI-Vercel schema converter fallback', () => {
  beforeAll(async () => {
    const mod = await import('./schemaConverter.js');
    convertToolsToOpenAIVercel = mod.convertToolsToOpenAIVercel;
  });

  it('should use parameters when parametersJsonSchema is absent (subagent path)', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'write_file',
            description: 'Write a file to disk',
            parameters: {
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

  it('should prefer parametersJsonSchema when both are present', () => {
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

    const result = convertToolsToOpenAIVercel(tools);
    expect(result).toBeDefined();
    expect(result![0].function.parameters?.properties).toHaveProperty('query');
  });
});
