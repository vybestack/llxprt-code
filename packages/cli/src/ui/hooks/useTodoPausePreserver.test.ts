/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { type Todo } from '@vybestack/llxprt-code-core';
import { shouldClearTodos } from './useTodoPausePreserver.js';

/**
 * @plan PLAN-20260129-TODOPERSIST.P02
 * @requirement REQ-001
 * Behavioral tests for conditional TODO clearing logic.
 */
describe('shouldClearTodos', () => {
  describe('behavioral tests', () => {
    it('should return true for empty TODO list (clear)', () => {
      const todos: Todo[] = [];
      expect(shouldClearTodos(todos)).toBe(true);
    });

    it('should return true when all TODOs are completed (clear)', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'First task',
          status: 'completed',
        },
        {
          id: '2',
          content: 'Second task',
          status: 'completed',
        },
        {
          id: '3',
          content: 'Third task',
          status: 'completed',
        },
      ];
      expect(shouldClearTodos(todos)).toBe(true);
    });

    it('should return false for mix of completed and pending TODOs (keep)', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'Completed task',
          status: 'completed',
        },
        {
          id: '2',
          content: 'Pending task',
          status: 'pending',
        },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });

    it('should return false when all TODOs are pending (keep)', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'First pending',
          status: 'pending',
        },
        {
          id: '2',
          content: 'Second pending',
          status: 'pending',
        },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });

    it('should return false when all TODOs are in_progress (keep)', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'First in progress',
          status: 'in_progress',
        },
        {
          id: '2',
          content: 'Second in progress',
          status: 'in_progress',
        },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });

    it('should return false for mix of all three statuses (keep)', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'Completed task',
          status: 'completed',
        },
        {
          id: '2',
          content: 'Pending task',
          status: 'pending',
        },
        {
          id: '3',
          content: 'In progress task',
          status: 'in_progress',
        },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });
  });

  describe('property-based tests', () => {
    it('should always return true for empty lists', () => {
      fc.assert(
        fc.property(fc.constant([] as Todo[]), (todos) => {
          expect(shouldClearTodos(todos)).toBe(true);
        }),
      );
    });

    it('should return true only when all TODOs are completed', () => {
      const completedTodoArb = fc.record({
        id: fc.string(),
        content: fc.string().filter((s) => s.length > 0),
        status: fc.constant('completed' as const),
      });

      fc.assert(
        fc.property(fc.array(completedTodoArb, { minLength: 1 }), (todos) => {
          expect(shouldClearTodos(todos)).toBe(true);
        }),
      );
    });

    it('should return false when at least one TODO is not completed', () => {
      const todoArb = fc.record({
        id: fc.string(),
        content: fc.string().filter((s) => s.length > 0),
        status: fc.oneof(
          fc.constant('pending' as const),
          fc.constant('in_progress' as const),
          fc.constant('completed' as const),
        ),
      });

      fc.assert(
        fc.property(
          fc
            .array(todoArb, { minLength: 1 })
            .filter((todos) => todos.some((t) => t.status !== 'completed')),
          (todos) => {
            expect(shouldClearTodos(todos)).toBe(false);
          },
        ),
      );
    });
  });
});
