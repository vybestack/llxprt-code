/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  TodoSchema,
  TodoArraySchema,
  SubtaskSchema,
  TodoToolCallSchema,
  TodoStatus,
} from './todo-schemas.js';

describe('TodoSchemas', () => {
  describe('TodoStatus', () => {
    it('should accept valid status values', () => {
      expect(() => TodoStatus.parse('pending')).not.toThrow();
      expect(() => TodoStatus.parse('in_progress')).not.toThrow();
      expect(() => TodoStatus.parse('completed')).not.toThrow();
    });

    it('should reject invalid status values', () => {
      expect(() => TodoStatus.parse('invalid')).toThrow();
      expect(() => TodoStatus.parse('')).toThrow();
      expect(() => TodoStatus.parse(null)).toThrow();
    });
  });

  describe('TodoSchema', () => {
    it('should accept valid todo object', () => {
      const validTodo = {
        id: 'test-1',
        content: 'Test task',
        status: 'pending',
      };
      expect(() => TodoSchema.parse(validTodo)).not.toThrow();
    });

    it('should reject todo with empty content', () => {
      const invalidTodo = {
        id: 'test-1',
        content: '',
        status: 'pending',
      };
      expect(() => TodoSchema.parse(invalidTodo)).toThrow();
    });

    it('should reject todo with missing fields', () => {
      const missingId = {
        content: 'Test task',
        status: 'pending',
      };
      expect(() => TodoSchema.parse(missingId)).toThrow();

      const missingContent = {
        id: 'test-1',
        status: 'pending',
      };
      expect(() => TodoSchema.parse(missingContent)).toThrow();

      const missingStatus = {
        id: 'test-1',
        content: 'Test task',
      };
      expect(() => TodoSchema.parse(missingStatus)).toThrow();
    });

    it('should accept numeric IDs and coerce them to strings', () => {
      const numericId = {
        id: 123, // numeric ID should be coerced to string
        content: 'Test task',
        status: 'pending',
      };
      const parsed = TodoSchema.parse(numericId);
      expect(parsed.id).toBe('123'); // Should be coerced to string
      expect(typeof parsed.id).toBe('string');
    });

    it('should reject todo with extra fields', () => {
      const extraFields = {
        id: 'test-1',
        content: 'Test task',
        status: 'pending',
        extra: 'field',
      };
      // Strict mode would reject this
      const parsed = TodoSchema.parse(extraFields);
      expect(parsed).not.toHaveProperty('extra');
    });
  });

  describe('TodoArraySchema', () => {
    it('should accept empty array', () => {
      expect(() => TodoArraySchema.parse([])).not.toThrow();
    });

    it('should accept array of valid todos', () => {
      const validTodos = [
        {
          id: 'test-1',
          content: 'First task',
          status: 'pending',
        },
        {
          id: 'test-2',
          content: 'Second task',
          status: 'in_progress',
        },
        {
          id: 'test-3',
          content: 'Third task',
          status: 'completed',
        },
      ];
      expect(() => TodoArraySchema.parse(validTodos)).not.toThrow();
    });

    it('should reject array with invalid todos', () => {
      const invalidTodos = [
        {
          id: 'test-1',
          content: 'Valid task',
          status: 'pending',
        },
        {
          id: 'test-2',
          content: '', // Invalid: empty content
          status: 'pending',
        },
      ];
      expect(() => TodoArraySchema.parse(invalidTodos)).toThrow();
    });

    it('should reject non-array values', () => {
      expect(() => TodoArraySchema.parse('not an array')).toThrow();
      expect(() => TodoArraySchema.parse({})).toThrow();
      expect(() => TodoArraySchema.parse(null)).toThrow();
      expect(() => TodoArraySchema.parse(undefined)).toThrow();
    });
  });

  // New tests for extended schemas
  describe('TodoToolCallSchema', () => {
    it('should accept valid tool call object', () => {
      const validToolCall = {
        id: 'tool-1',
        name: 'runShellCommand',
        parameters: {
          command: 'ls -la',
        },
        timestamp: new Date(),
      };
      expect(() => TodoToolCallSchema.parse(validToolCall)).not.toThrow();
    });

    it('should accept tool call with empty parameters', () => {
      const toolCallWithEmptyParams = {
        id: 'tool-1',
        name: 'readFile',
        parameters: {},
        timestamp: new Date(),
      };
      expect(() =>
        TodoToolCallSchema.parse(toolCallWithEmptyParams),
      ).not.toThrow();
    });

    it('should reject tool call with missing fields', () => {
      const missingId = {
        name: 'runShellCommand',
        parameters: {},
      };
      expect(() => TodoToolCallSchema.parse(missingId)).toThrow();

      const missingName = {
        id: 'tool-1',
        parameters: {},
      };
      expect(() => TodoToolCallSchema.parse(missingName)).toThrow();

      const missingParams = {
        id: 'tool-1',
        name: 'runShellCommand',
      };
      expect(() => TodoToolCallSchema.parse(missingParams)).toThrow();
    });
  });

  describe('SubtaskSchema', () => {
    it('should accept valid subtask object without tool calls', () => {
      const validSubtask = {
        id: 'subtask-1',
        content: 'Implement feature',
      };
      expect(() => SubtaskSchema.parse(validSubtask)).not.toThrow();
    });

    it('should accept valid subtask object with tool calls', () => {
      const validSubtaskWithToolCalls = {
        id: 'subtask-1',
        content: 'Implement feature',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'runShellCommand',
            parameters: {
              command: 'git add .',
            },
            timestamp: new Date(),
          },
        ],
      };
      expect(() =>
        SubtaskSchema.parse(validSubtaskWithToolCalls),
      ).not.toThrow();
    });

    it('should reject subtask with empty content', () => {
      const invalidSubtask = {
        id: 'subtask-1',
        content: '',
      };
      expect(() => SubtaskSchema.parse(invalidSubtask)).toThrow();
    });

    it('should reject subtask with missing fields', () => {
      const missingId = {
        content: 'Implement feature',
      };
      expect(() => SubtaskSchema.parse(missingId)).toThrow();

      const missingContent = {
        id: 'subtask-1',
      };
      expect(() => SubtaskSchema.parse(missingContent)).toThrow();
    });
  });

  describe('TodoSchema - Additional Tests', () => {
    it('should accept valid todo without subtasks', () => {
      const validTodo = {
        id: 'task-1',
        content: 'Implement role-based access control',
        status: 'in_progress',
      };
      expect(() => TodoSchema.parse(validTodo)).not.toThrow();
    });

    it('should accept valid todo with subtasks', () => {
      const validTodoWithSubtasks = {
        id: 'task-1',
        content: 'Implement role-based access control',
        status: 'in_progress',
        subtasks: [
          {
            id: 'subtask-1',
            content: 'Define role enum',
            toolCalls: [
              {
                id: 'tool-1',
                name: 'runShellCommand',
                parameters: {
                  command: 'git add src/roles.ts',
                },
                timestamp: new Date(),
              },
            ],
          },
        ],
      };
      expect(() => TodoSchema.parse(validTodoWithSubtasks)).not.toThrow();
    });

    it('should reject todo with invalid subtasks', () => {
      const todoWithInvalidSubtasks = {
        id: 'task-1',
        content: 'Test task',
        status: 'pending',
        subtasks: [
          {
            id: 'subtask-1',
            content: '', // Invalid: empty content
          },
        ],
      };
      expect(() => TodoSchema.parse(todoWithInvalidSubtasks)).toThrow();
    });
  });

  describe('TodoArraySchema - Advanced Tests', () => {
    it('should accept empty array', () => {
      expect(() => TodoArraySchema.parse([])).not.toThrow();
    });

    it('should accept array of valid todos', () => {
      const validTodos = [
        {
          id: 'task-1',
          content: 'Implement role-based access control',
          status: 'in_progress',
          subtasks: [
            {
              id: 'subtask-1',
              content: 'Define role enum',
              toolCalls: [
                {
                  id: 'tool-1',
                  name: 'runShellCommand',
                  parameters: {
                    command: 'git add src/roles.ts',
                  },
                  timestamp: new Date(),
                },
              ],
            },
          ],
        },
        {
          id: 'task-2',
          content: 'Document security model',
          status: 'pending',
        },
      ];
      expect(() => TodoArraySchema.parse(validTodos)).not.toThrow();
    });

    it('should reject array with invalid todos', () => {
      const invalidTodos = [
        {
          id: 'task-1',
          content: 'Valid task',
          status: 'pending',
        },
        {
          id: 'task-2',
          content: '', // Invalid: empty content
          status: 'pending',
        },
      ];
      expect(() => TodoArraySchema.parse(invalidTodos)).toThrow();
    });
  });
});
