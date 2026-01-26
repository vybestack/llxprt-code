/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { coerceParametersToSchema } from './parameterCoercion.js';

describe('coerceParametersToSchema', () => {
  describe('string to number coercion', () => {
    it('should convert string integers to numbers when schema expects number', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
      };
      const params = { offset: '50', limit: '100' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: 50, limit: 100 });
    });

    it('should convert string floats to numbers when schema expects number', () => {
      const schema = {
        type: 'object',
        properties: {
          temperature: { type: 'number' },
        },
      };
      const params = { temperature: '0.7' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ temperature: 0.7 });
    });

    it('should convert negative string numbers to numbers', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };
      const params = { offset: '-10' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: -10 });
    });

    it('should convert string integers to integers when schema expects integer', () => {
      const schema = {
        type: 'object',
        properties: {
          start_line: { type: 'integer' },
          end_line: { type: 'integer' },
        },
      };
      const params = { start_line: '50', end_line: '120' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ start_line: 50, end_line: 120 });
    });

    it('should not convert non-numeric strings when schema expects number', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      };
      const params = { count: 'not-a-number' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ count: 'not-a-number' });
    });

    it('should leave actual numbers unchanged', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };
      const params = { offset: 50 };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: 50 });
    });
  });

  describe('string to boolean coercion', () => {
    it('should convert "true" string to boolean true', () => {
      const schema = {
        type: 'object',
        properties: {
          showLineNumbers: { type: 'boolean' },
        },
      };
      const params = { showLineNumbers: 'true' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ showLineNumbers: true });
    });

    it('should convert "false" string to boolean false', () => {
      const schema = {
        type: 'object',
        properties: {
          recursive: { type: 'boolean' },
        },
      };
      const params = { recursive: 'false' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ recursive: false });
    });

    it('should leave actual booleans unchanged', () => {
      const schema = {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      };
      const params = { enabled: true };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ enabled: true });
    });

    it('should not convert non-boolean strings when schema expects boolean', () => {
      const schema = {
        type: 'object',
        properties: {
          flag: { type: 'boolean' },
        },
      };
      const params = { flag: 'yes' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ flag: 'yes' });
    });
  });

  describe('single value to array coercion', () => {
    it('should wrap single string in array when schema expects array', () => {
      const schema = {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' } },
        },
      };
      const params = { paths: 'file.txt' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ paths: ['file.txt'] });
    });

    it('should wrap single number in array when schema expects array', () => {
      const schema = {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' } },
        },
      };
      const params = { ids: 42 };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ ids: [42] });
    });

    it('should leave arrays unchanged', () => {
      const schema = {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' } },
        },
      };
      const params = { paths: ['file1.txt', 'file2.txt'] };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ paths: ['file1.txt', 'file2.txt'] });
    });

    it('should coerce items within arrays', () => {
      const schema = {
        type: 'object',
        properties: {
          numbers: { type: 'array', items: { type: 'number' } },
        },
      };
      const params = { numbers: ['1', '2', '3'] };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ numbers: [1, 2, 3] });
    });

    it('should parse JSON string array when schema expects array', () => {
      const schema = {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
        },
      };
      const params = { items: '["a", "b", "c"]' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ items: ['a', 'b', 'c'] });
    });

    it('should parse JSON string array of objects (TodoWrite case)', () => {
      const schema = {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
      };
      const params = {
        todos: '[{"id": "1", "content": "Task one", "status": "pending"}]',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        todos: [
          {
            id: '1',
            content: 'Task one',
            status: 'pending',
          },
        ],
      });
    });

    it('should handle uppercase Type enum (ARRAY) from Gemini schemas', () => {
      const schema = {
        type: 'OBJECT',
        properties: {
          todos: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                content: { type: 'STRING' },
              },
            },
          },
        },
      };
      const params = {
        todos: '[{"id": "1", "content": "Task one"}]',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        todos: [{ id: '1', content: 'Task one' }],
      });
    });

    it('should handle uppercase NUMBER type from Gemini schemas', () => {
      const schema = {
        type: 'OBJECT',
        properties: {
          offset: { type: 'NUMBER' },
          limit: { type: 'INTEGER' },
        },
      };
      const params = { offset: '50', limit: '100' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: 50, limit: 100 });
    });

    it('should not coerce float string to integer when schema expects integer', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'integer' },
        },
      };
      const params = { count: '1.5' };

      const result = coerceParametersToSchema(params, schema);

      // Should NOT coerce because 1.5 is not an integer
      expect(result).toEqual({ count: '1.5' });
    });

    it('should coerce whole number float string to integer when schema expects integer', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'integer' },
        },
      };
      const params = { count: '10.0' };

      const result = coerceParametersToSchema(params, schema);

      // Should coerce because 10.0 is effectively an integer
      expect(result).toEqual({ count: 10 });
    });

    it('should handle complex nested JSON string arrays', () => {
      const schema = {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                subtasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      content: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const params = {
        todos:
          '[{"id": "1", "content": "Main task", "subtasks": [{"id": "1-1", "content": "Subtask A"}]}]',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        todos: [
          {
            id: '1',
            content: 'Main task',
            subtasks: [{ id: '1-1', content: 'Subtask A' }],
          },
        ],
      });
    });
  });

  describe('string to object coercion', () => {
    it('should parse JSON string to object when schema expects object', () => {
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };
      const params = { config: '{"key": "value"}' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ config: { key: 'value' } });
    });

    it('should leave non-JSON strings unchanged when schema expects object', () => {
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };
      const params = { config: 'not-json' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ config: 'not-json' });
    });

    it('should leave actual objects unchanged', () => {
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };
      const params = { config: { key: 'value' } };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ config: { key: 'value' } });
    });
  });

  describe('nested object coercion', () => {
    it('should coerce values in nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          options: {
            type: 'object',
            properties: {
              limit: { type: 'number' },
              enabled: { type: 'boolean' },
            },
          },
        },
      };
      const params = {
        options: {
          limit: '100',
          enabled: 'true',
        },
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        options: {
          limit: 100,
          enabled: true,
        },
      });
    });
  });

  describe('mixed coercion', () => {
    it('should handle multiple coercions in same object', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
          limit: { type: 'number' },
          showLineNumbers: { type: 'boolean' },
          path: { type: 'string' },
        },
      };
      const params = {
        offset: '50',
        limit: '100',
        showLineNumbers: 'true',
        path: '/some/path',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        offset: 50,
        limit: 100,
        showLineNumbers: true,
        path: '/some/path',
      });
    });

    it('should handle real-world ReadFile params from issue 1146', () => {
      const schema = {
        type: 'object',
        properties: {
          absolute_path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
      };
      const params = {
        absolute_path:
          '/Users/acoliver/projects/llxprt/branch-2/llxprt-code/packages/core/src/providers/BaseProvider.ts',
        offset: '50',
        limit: '100',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        absolute_path:
          '/Users/acoliver/projects/llxprt/branch-2/llxprt-code/packages/core/src/providers/BaseProvider.ts',
        offset: 50,
        limit: 100,
      });
    });

    it('should handle real-world ReadLineRange params from issue 1146', () => {
      const schema = {
        type: 'object',
        properties: {
          absolute_path: { type: 'string' },
          start_line: { type: 'number' },
          end_line: { type: 'number' },
        },
      };
      const params = {
        absolute_path:
          '/Users/acoliver/projects/llxprt/branch-2/llxprt-code/packages/core/src/providers/BaseProvider.ts',
        start_line: '50',
        end_line: '120',
      };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({
        absolute_path:
          '/Users/acoliver/projects/llxprt/branch-2/llxprt-code/packages/core/src/providers/BaseProvider.ts',
        start_line: 50,
        end_line: 120,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle null schema gracefully', () => {
      const params = { offset: '50' };

      const result = coerceParametersToSchema(params, null);

      expect(result).toEqual({ offset: '50' });
    });

    it('should handle undefined schema gracefully', () => {
      const params = { offset: '50' };

      const result = coerceParametersToSchema(params, undefined);

      expect(result).toEqual({ offset: '50' });
    });

    it('should handle null params gracefully', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };

      const result = coerceParametersToSchema(null, schema);

      expect(result).toBeNull();
    });

    it('should handle undefined params gracefully', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };

      const result = coerceParametersToSchema(undefined, schema);

      expect(result).toBeUndefined();
    });

    it('should handle empty object params', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };
      const params = {};

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({});
    });

    it('should handle properties not in schema (pass through unchanged)', () => {
      const schema = {
        type: 'object',
        properties: {
          offset: { type: 'number' },
        },
      };
      const params = { offset: '50', unknown: 'value' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: 50, unknown: 'value' });
    });

    it('should handle schema without properties', () => {
      const schema = { type: 'object' };
      const params = { offset: '50' };

      const result = coerceParametersToSchema(params, schema);

      expect(result).toEqual({ offset: '50' });
    });
  });
});
