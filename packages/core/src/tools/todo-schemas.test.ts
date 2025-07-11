/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  TodoSchema,
  TodoArraySchema,
  TodoStatus,
  TodoPriority,
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

  describe('TodoPriority', () => {
    it('should accept valid priority values', () => {
      expect(() => TodoPriority.parse('high')).not.toThrow();
      expect(() => TodoPriority.parse('medium')).not.toThrow();
      expect(() => TodoPriority.parse('low')).not.toThrow();
    });

    it('should reject invalid priority values', () => {
      expect(() => TodoPriority.parse('critical')).toThrow();
      expect(() => TodoPriority.parse('')).toThrow();
      expect(() => TodoPriority.parse(undefined)).toThrow();
    });
  });

  describe('TodoSchema', () => {
    it('should accept valid todo object', () => {
      const validTodo = {
        id: 'test-1',
        content: 'Test task',
        status: 'pending',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(validTodo)).not.toThrow();
    });

    it('should reject todo with empty content', () => {
      const invalidTodo = {
        id: 'test-1',
        content: '',
        status: 'pending',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(invalidTodo)).toThrow();
    });

    it('should reject todo with missing fields', () => {
      const missingId = {
        content: 'Test task',
        status: 'pending',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(missingId)).toThrow();

      const missingContent = {
        id: 'test-1',
        status: 'pending',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(missingContent)).toThrow();

      const missingStatus = {
        id: 'test-1',
        content: 'Test task',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(missingStatus)).toThrow();

      const missingPriority = {
        id: 'test-1',
        content: 'Test task',
        status: 'pending',
      };
      expect(() => TodoSchema.parse(missingPriority)).toThrow();
    });

    it('should reject todo with invalid field types', () => {
      const invalidTypes = {
        id: 123, // should be string
        content: 'Test task',
        status: 'pending',
        priority: 'high',
      };
      expect(() => TodoSchema.parse(invalidTypes)).toThrow();
    });

    it('should reject todo with extra fields', () => {
      const extraFields = {
        id: 'test-1',
        content: 'Test task',
        status: 'pending',
        priority: 'high',
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
          priority: 'high',
        },
        {
          id: 'test-2',
          content: 'Second task',
          status: 'in_progress',
          priority: 'medium',
        },
        {
          id: 'test-3',
          content: 'Third task',
          status: 'completed',
          priority: 'low',
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
          priority: 'high',
        },
        {
          id: 'test-2',
          content: '', // Invalid: empty content
          status: 'pending',
          priority: 'high',
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
});
