/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { buildGeminiTools } from './geminiRequestBuilding.js';

describe('Gemini tool transport boundary', () => {
  it('groups flat declarations for transport while retaining order and schema cleaning', () => {
    expect(
      buildGeminiTools([
        {
          name: 'search',
          description: 'Search',
          parametersJsonSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
        { name: 'status', parametersJsonSchema: {} },
      ]),
    ).toStrictEqual({
      geminiTools: [
        {
          functionDeclarations: [
            {
              name: 'search',
              description: 'Search',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
              },
            },
            {
              name: 'status',
              description: undefined,
              parameters: { type: 'OBJECT' },
            },
          ],
        },
      ],
      toolNamesForPrompt: ['search', 'status'],
    });
  });
  it('retains the distinction between missing tools and an empty tool list', () => {
    expect(buildGeminiTools(undefined)).toStrictEqual({
      geminiTools: undefined,
      toolNamesForPrompt: undefined,
    });
    expect(buildGeminiTools([])).toStrictEqual({
      geminiTools: [],
      toolNamesForPrompt: [],
    });
  });
  it('continues to reject a false parameter schema', () => {
    expect(() =>
      buildGeminiTools([{ name: 'denied', parametersJsonSchema: false }]),
    ).toThrow('Tool "denied" is missing parametersJsonSchema');
  });
});
