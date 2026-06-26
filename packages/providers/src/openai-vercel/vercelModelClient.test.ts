/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import { buildVercelTools } from './vercelModelClient.js';
import type { OpenAIVercelTool } from './schemaConverter.js';

describe('buildVercelTools', () => {
  it('returns undefined when no tools are provided', () => {
    expect(buildVercelTools(undefined)).toBeUndefined();
  });

  it('returns undefined when tools array is empty', () => {
    expect(buildVercelTools([])).toBeUndefined();
  });

  it('produces a tools record keyed by tool name', () => {
    const tools: OpenAIVercelTool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
        },
      },
    ];

    const result = buildVercelTools(tools);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toStrictEqual(['search', 'read_file']);
    expect(result!.search).toBeDefined();
    expect(result!.read_file).toBeDefined();
  });

  it('deduplicates tools with the same name', () => {
    const tools: OpenAIVercelTool[] = [
      {
        type: 'function',
        function: {
          name: 'dup_tool',
          description: 'first',
        },
      },
      {
        type: 'function',
        function: {
          name: 'dup_tool',
          description: 'second',
        },
      },
    ];

    const result = buildVercelTools(tools);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toStrictEqual(['dup_tool']);
  });

  it('produces a tool object with description and inputSchema', () => {
    const tools: OpenAIVercelTool[] = [
      {
        type: 'function',
        function: {
          name: 'weather',
          description: 'Get weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      },
    ];

    const result = buildVercelTools(tools);
    expect(result).toBeDefined();
    expect(result!.weather).toMatchObject({
      description: 'Get weather',
      inputSchema: {
        jsonSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    });
  });
});
