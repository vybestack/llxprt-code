/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ToolFormatter } from './ToolFormatter.js';
import { Type } from '@google/genai';

describe('ToolFormatter', () => {
  describe('convertGeminiToOpenAI', () => {
    it('should convert TodoWrite tool from Gemini format to OpenAI format with proper parameters', () => {
      const formatter = new ToolFormatter();

      // Real TodoWrite schema in Gemini format (from todo-write.ts)
      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'todo_write',
              description:
                'Create and manage a structured task list for the current coding session. Updates the entire todo list.',
              parametersJsonSchema: {
                type: Type.OBJECT,
                properties: {
                  todos: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: {
                          type: Type.STRING,
                          description: 'Unique identifier for the todo item',
                        },
                        content: {
                          type: Type.STRING,
                          description: 'Description of the todo item',
                          minLength: '1',
                        },
                        status: {
                          type: Type.STRING,
                          enum: ['pending', 'in_progress', 'completed'],
                          description: 'Current status of the todo item',
                        },
                      },
                      required: ['id', 'content', 'status'],
                    },
                    description: 'List of todo items',
                  },
                },
                required: ['todos'],
              },
            },
          ],
        },
      ];

      const result = formatter.convertGeminiToOpenAI(geminiTools);

      // Check that we got a result
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);

      const tool = result![0];

      // Check basic structure
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe('todo_write');
      expect(tool.function.description).toBe(
        'Create and manage a structured task list for the current coding session. Updates the entire todo list.',
      );

      // Check that parameters were converted properly
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters).not.toEqual({});

      // Parameters should have the expected structure
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.properties).toBeDefined();
      expect(tool.function.parameters.properties.todos).toBeDefined();
      expect(tool.function.parameters.properties.todos.type).toBe('array');
      expect(tool.function.parameters.properties.todos.items).toBeDefined();
      expect(tool.function.parameters.properties.todos.items.type).toBe(
        'object',
      );
      expect(
        tool.function.parameters.properties.todos.items.properties,
      ).toBeDefined();
      expect(
        tool.function.parameters.properties.todos.items.properties.id,
      ).toBeDefined();
      expect(
        tool.function.parameters.properties.todos.items.properties.content,
      ).toBeDefined();
      expect(
        tool.function.parameters.properties.todos.items.properties.status,
      ).toBeDefined();
      expect(tool.function.parameters.required).toEqual(['todos']);

      // Check that enums are preserved
      expect(
        tool.function.parameters.properties.todos.items.properties.status.enum,
      ).toEqual(['pending', 'in_progress', 'completed']);

      // Check that minLength was converted from string to number
      expect(
        tool.function.parameters.properties.todos.items.properties.content
          .minLength,
      ).toBe(1);
      expect(
        typeof tool.function.parameters.properties.todos.items.properties
          .content.minLength,
      ).toBe('number');
    });

    it('should handle tools with undefined parameters', () => {
      const formatter = new ToolFormatter();

      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'simple_tool',
              description: 'A simple tool',
              parameters: undefined,
            },
          ],
        },
      ];

      const result = formatter.convertGeminiToOpenAI(geminiTools);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);

      const tool = result![0];
      expect(tool.function.parameters).toEqual({});
    });

    it('should handle tools with empty object parameters', () => {
      const formatter = new ToolFormatter();

      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'simple_tool',
              description: 'A simple tool',
              parameters: {},
            },
          ],
        },
      ];

      const result = formatter.convertGeminiToOpenAI(geminiTools);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);

      const tool = result![0];
      expect(tool.function.parameters).toEqual({});
    });

    it('should convert list_directory tool properly', () => {
      const formatter = new ToolFormatter();

      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'list_directory',
              description:
                'Lists the names of files and subdirectories directly within a specified directory path.',
              parametersJsonSchema: {
                type: Type.OBJECT,
                properties: {
                  path: {
                    type: Type.STRING,
                    description: 'The absolute path to the directory to list',
                  },
                  ignore: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                    },
                    description: 'List of glob patterns to ignore',
                  },
                },
                required: ['path'],
              },
            },
          ],
        },
      ];

      const result = formatter.convertGeminiToOpenAI(geminiTools);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);

      const tool = result![0];

      // Check that parameters were converted properly
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.properties).toBeDefined();
      expect(tool.function.parameters.properties.path).toBeDefined();
      expect(tool.function.parameters.properties.path.type).toBe('string');
      expect(tool.function.parameters.properties.ignore).toBeDefined();
      expect(tool.function.parameters.properties.ignore.type).toBe('array');
      expect(tool.function.parameters.required).toEqual(['path']);
    });
  });

  describe('convertGeminiSchemaToStandard', () => {
    it('should convert Type enum values to lowercase strings', () => {
      const formatter = new ToolFormatter();

      const geminiSchema = {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
          },
          count: {
            type: Type.NUMBER,
          },
        },
      };

      const result = formatter.convertGeminiSchemaToStandard(
        geminiSchema,
      ) as Record<string, unknown>;

      expect(result.type).toBe('object');
      expect((result.properties as Record<string, unknown>).name).toBeDefined();
      expect(
        (
          (result.properties as Record<string, unknown>).name as Record<
            string,
            unknown
          >
        ).type,
      ).toBe('string');
      expect(
        (result.properties as Record<string, unknown>).count,
      ).toBeDefined();
      expect(
        (
          (result.properties as Record<string, unknown>).count as Record<
            string,
            unknown
          >
        ).type,
      ).toBe('number');
    });

    it('should handle nested objects and arrays', () => {
      const formatter = new ToolFormatter();

      const geminiSchema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: {
                  type: Type.STRING,
                },
              },
            },
          },
        },
      };

      const result = formatter.convertGeminiSchemaToStandard(
        geminiSchema,
      ) as Record<string, unknown>;

      expect(result.type).toBe('object');
      const props = result.properties as Record<string, unknown>;
      const items = props.items as Record<string, unknown>;
      expect(items.type).toBe('array');
      const itemsItems = items.items as Record<string, unknown>;
      expect(itemsItems.type).toBe('object');
      const itemProps = itemsItems.properties as Record<string, unknown>;
      const id = itemProps.id as Record<string, unknown>;
      expect(id.type).toBe('string');
    });

    it('should convert minLength and maxLength from string to number', () => {
      const formatter = new ToolFormatter();

      const geminiSchema = {
        type: Type.STRING,
        minLength: '5',
        maxLength: '100',
      };

      const result = formatter.convertGeminiSchemaToStandard(
        geminiSchema,
      ) as Record<string, unknown>;

      expect(result.minLength).toBe(5);
      expect(typeof result.minLength).toBe('number');
      expect(result.maxLength).toBe(100);
      expect(typeof result.maxLength).toBe('number');
    });

    it('should preserve enum values as strings', () => {
      const formatter = new ToolFormatter();

      const geminiSchema = {
        type: Type.STRING,
        enum: ['pending', 'in_progress', 'completed'],
      };

      const result = formatter.convertGeminiSchemaToStandard(
        geminiSchema,
      ) as Record<string, unknown>;

      expect(result.enum).toEqual(['pending', 'in_progress', 'completed']);
    });

    it('should return empty object when given empty object', () => {
      const formatter = new ToolFormatter();

      const result = formatter.convertGeminiSchemaToStandard({}) as Record<
        string,
        unknown
      >;

      expect(result).toEqual({});
    });

    it('should return undefined when given undefined', () => {
      const formatter = new ToolFormatter();

      const result = formatter.convertGeminiSchemaToStandard(undefined);

      expect(result).toBeUndefined();
    });
  });
});
