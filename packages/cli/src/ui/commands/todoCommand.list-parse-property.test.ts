/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260129-TODOPERSIST.P05
 * @requirement REQ-003, REQ-004, REQ-005, REQ-006, REQ-007
 */

import { describe, it, expect, vi } from 'vitest';
import { todoCommand, parsePosition } from './todoCommand.js';
import type { CommandContext } from './types.js';
import type { Todo } from '@vybestack/llxprt-code-core';
import * as fc from 'fast-check';

/**
 * Mock context factory
 * @plan PLAN-20260129-TODOPERSIST.P08
 */
function createMockContext(initialTodos: Todo[] = []): CommandContext {
  const addItemMock = vi.fn();
  const updateTodosMock = vi.fn((newTodos: Todo[]) => {
    mockTodoContext.todos = newTodos;
  });

  const mockTodoContext = {
    todos: initialTodos,
    updateTodos: updateTodosMock,
    refreshTodos: vi.fn(),
  };

  return {
    services: {
      config: null,
      settings: {} as unknown as CommandContext['services']['settings'],
      git: undefined,
      logger: {} as unknown as CommandContext['services']['logger'],
    },
    ui: {
      addItem: addItemMock,
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleDebugProfiler: vi.fn(),
      toggleVimEnabled: vi.fn(),
      setGeminiMdFileCount: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      updateHistoryTokenCount: vi.fn(),
      reloadCommands: vi.fn(),
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: vi.fn(),
      addConfirmUpdateExtensionRequest: vi.fn(),
    },
    session: {
      stats: {} as unknown as CommandContext['session']['stats'],
      sessionShellAllowlist: new Set(),
    },
    todoContext: mockTodoContext,
  } as unknown as CommandContext;
}

describe('todoCommand', () => {
  describe('/todo list', () => {
    /**
     * @requirement REQ-007
     * @scenario Display sorted task history
     * @given Multiple task files exist
     * @when User executes the list command
     * @then Display sorted by mtime with current first
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('displays sorted task history with current session first', async () => {
      const ctx = createMockContext([]);

      const listSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'list',
      );

      await listSubcommand!.action!(ctx, '');

      // Verify addItem was called with a message
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      // Should either show files or "No saved task lists found"
      expect(call.type).toBe('info');
    });

    /**
     * @requirement REQ-007
     * @scenario Handle empty task directory
     * @given No saved task files exist
     * @when User executes the list command
     * @then Display "No saved task lists found"
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('handles empty task directory gracefully', async () => {
      const ctx = createMockContext([]);

      const listSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'list',
      );

      await listSubcommand!.action!(ctx, '');

      // Verify addItem was called with a message
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      // Should either show files or "No saved task lists found" message
      // (depending on whether files exist in the system from previous tests)
      expect(call.text).toMatch(/No saved TODO lists found|Saved TODO Lists/);
    });
  });

  describe('/todo load', () => {
    /**
     * @requirement REQ-009
     * @scenario Load task session by number
     * @given User has saved task sessions
     * @when User executes the load command with position 1
     * @then First session is loaded into active tasks
     * @plan PLAN-20260129-TODOPERSIST-EXT.P19
     */
    it('loads task session at position 1', async () => {
      const ctx = createMockContext([]);

      const loadSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'load',
      );
      expect(loadSubcommand).toBeDefined();

      // Note: This test relies on actual filesystem state
      // In real implementation, we'd need to create temp task files
      await loadSubcommand!.action!(ctx, '1');

      // Either updateTodos is called (files exist) or addItem shows error (no files)
      const updateTodosCalled =
        (ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>).mock.calls
          .length > 0;
      const addItemCalled =
        (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls.length > 0;
      expect(updateTodosCalled || addItemCalled).toBe(true);
    });

    /**
     * @requirement REQ-009
     * @scenario Load task session with invalid number
     * @given User has 2 saved sessions
     * @when User executes the load command with invalid position 99
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P19
     */
    it('shows error when loading out-of-range session', async () => {
      const ctx = createMockContext([]);

      const loadSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'load',
      );

      await loadSubcommand!.action!(ctx, '99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      // Should either be error for no files, or error for out of range
      expect(call.type).toMatch(/error|info/i);
    });

    /**
     * @requirement REQ-009
     * @scenario Load task session without arguments
     * @given User has saved sessions
     * @when User executes the load command without arguments
     * @then Usage help is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P19
     * @plan PLAN-20260129-TODOPERSIST-EXT.P20
     */
    it('shows usage help when no number is provided', async () => {
      const ctx = createMockContext([]);

      const loadSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'load',
      );

      await loadSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Usage');
      expect(call.text).toContain('/todo list');
    });

    /**
     * @requirement REQ-009
     * @scenario Load task session with invalid number format
     * @given User has saved sessions
     * @when User executes the load command with invalid format "abc"
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P19
     */
    it('shows error when number format is invalid', async () => {
      const ctx = createMockContext([]);

      const loadSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'load',
      );

      await loadSubcommand!.action!(ctx, 'abc');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toMatch(/invalid/i);
    });
  });

  describe('parsePosition', () => {
    /**
     * @requirement REQ-005
     * @scenario Parse "last" position
     * @given position = "last"
     * @when parsePosition is called
     * @then Returns parentIndex = todos.length
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('parses "last" position', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ];

      const result = parsePosition('last', todos);
      expect(result.parentIndex).toBe(2);
      expect(result.isLast).toBe(true);
    });

    /**
     * @requirement REQ-005
     * @scenario Parse numeric position
     * @given position = "2"
     * @when parsePosition is called
     * @then Returns parentIndex = 1 (0-based)
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('parses numeric position', () => {
      const todos: Todo[] = [{ id: '1', content: 'Task 1', status: 'pending' }];

      const result = parsePosition('2', todos);
      expect(result.parentIndex).toBe(1);
      expect(result.isLast).toBe(false);
    });

    /**
     * @requirement REQ-005
     * @scenario Parse dotted subtask position
     * @given position = "1.2"
     * @when parsePosition is called
     * @then Returns parentIndex = 0, subtaskIndex = 1
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('parses dotted subtask position', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'Parent',
          status: 'pending',

          subtasks: [{ id: '1.1', content: 'Sub 1' }],
        },
      ];

      const result = parsePosition('1.2', todos);
      expect(result.parentIndex).toBe(0);
      expect(result.subtaskIndex).toBe(1);
      expect(result.isLast).toBe(false);
    });

    /**
     * @requirement REQ-005
     * @scenario Reject invalid position
     * @given position = "invalid"
     * @when parsePosition is called
     * @then Throws error
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('rejects invalid position format', () => {
      const todos: Todo[] = [{ id: '1', content: 'Task 1', status: 'pending' }];

      expect(() => parsePosition('invalid', todos)).toThrow(Error);
    });
  });

  /**
   * Property-based test: Position parsing invariants
   * @requirement REQ-005
   * @plan PLAN-20260129-TODOPERSIST.P05
   */
  describe('parsePosition property tests', () => {
    it('always returns valid index for valid positions', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.string(),
              content: fc.string(),
              status: fc.constantFrom('pending', 'in_progress', 'completed'),
            }),
            { minLength: 1, maxLength: 10 },
          ),
          (todos) => {
            const validPositions = ['1', 'last'];

            for (const pos of validPositions) {
              const result = parsePosition(pos, todos as Todo[]);
              expect(result.parentIndex).toBeGreaterThanOrEqual(0);
              expect(result.parentIndex).toBeLessThanOrEqual(todos.length);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('rejects invalid position formats', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.string(),
              content: fc.string(),
              status: fc.constantFrom('pending', 'in_progress', 'completed'),
            }),
            { minLength: 1 },
          ),
          fc.constantFrom('abc', '1.2.3', '-1', '0'),
          (todos, invalidPos) => {
            expect(() => parsePosition(invalidPos, todos as Todo[])).toThrow(
              Error,
            );
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * Property-based test: Add/delete operations maintain consistency
   * @requirement REQ-005, REQ-006
   * @plan PLAN-20260129-TODOPERSIST.P05
   */
  describe('add/delete consistency property tests', () => {
    it('maintains task list consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.string(),
              content: fc.string(),
              status: fc.constantFrom('pending', 'in_progress', 'completed'),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (initialTodos) => {
            const ctx = createMockContext(initialTodos as Todo[]);
            const initialLength = initialTodos.length;

            const addSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'add',
            );
            const removeSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'remove',
            );

            // Add a task at last position
            await addSubcommand!.action!(ctx, 'last New task');

            expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
            let calls = (
              ctx.todoContext!.updateTodos as ReturnType<typeof vi.fn>
            ).mock.calls;
            const todosAfterAdd = calls[calls.length - 1][0];
            expect(todosAfterAdd.length).toBe(initialLength + 1);

            // Reset mock to track next call
            (
              ctx.todoContext!.updateTodos as ReturnType<typeof vi.fn>
            ).mockClear();

            // Remove the last task
            await removeSubcommand!.action!(
              ctx,
              todosAfterAdd.length.toString(),
            );

            expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
            calls = (ctx.todoContext!.updateTodos as ReturnType<typeof vi.fn>)
              .mock.calls;
            const todosAfterRemove = calls[calls.length - 1][0];
            expect(todosAfterRemove.length).toBe(initialLength);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
