/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { type Todo } from '@vybestack/llxprt-code-core';
import { shouldClearTodos } from './useTodoPausePreserver.js';

/**
 * @requirement FIX-1336-EMPTY-CLEAR
 * Bug fix: shouldClearTodos should return false for empty lists.
 *
 * Rationale: When todos are empty (e.g., after --continue with wrong sessionId,
 * or brand new session), returning true causes unnecessary writes of []
 * to disk. Empty means "nothing to clear" - the correct behavior is to
 * return false and not trigger any clearing action.
 *
 * The "clear" action should only happen when:
 * - All todos are completed (user finished their work)
 *
 * NOT when:
 * - List is empty (nothing to clear)
 */
describe('shouldClearTodos bug fix #1336', () => {
  describe('empty list should NOT trigger clear', () => {
    it('should return false for empty TODO list (nothing to clear)', () => {
      const todos: Todo[] = [];
      // Empty list means nothing to clear - this is the fix for issue #1336
      expect(shouldClearTodos(todos)).toBe(false);
    });
  });

  describe('all completed should still trigger clear (unchanged behavior)', () => {
    it('should return true when all TODOs are completed', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Task 1', status: 'completed' },
        { id: '2', content: 'Task 2', status: 'completed' },
      ];
      expect(shouldClearTodos(todos)).toBe(true);
    });

    it('should return true for single completed TODO', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Only task', status: 'completed' },
      ];
      expect(shouldClearTodos(todos)).toBe(true);
    });
  });

  describe('incomplete todos should NOT trigger clear (unchanged behavior)', () => {
    it('should return false when any TODO is pending', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Completed', status: 'completed' },
        { id: '2', content: 'Pending', status: 'pending' },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });

    it('should return false when any TODO is in_progress', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Completed', status: 'completed' },
        { id: '2', content: 'In progress', status: 'in_progress' },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });

    it('should return false for all pending', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Pending 1', status: 'pending' },
        { id: '2', content: 'Pending 2', status: 'pending' },
      ];
      expect(shouldClearTodos(todos)).toBe(false);
    });
  });
});
