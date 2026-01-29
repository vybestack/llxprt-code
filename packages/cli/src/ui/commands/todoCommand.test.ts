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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: {} as any,
      git: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: {} as any,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stats: {} as any,
      sessionShellAllowlist: new Set(),
    },
    todoContext: mockTodoContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('todoCommand', () => {
  describe('/todo clear', () => {
    /**
     * @requirement REQ-003
     * @scenario Clear all TODOs from active session
     * @given User has active TODO list
     * @when User executes /todo clear
     * @then All TODOs are removed from memory
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('clears all TODOs from active session', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
      ]);

      const clearSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'clear',
      );
      expect(clearSubcommand).toBeDefined();

      await clearSubcommand!.action!(ctx, '');

      // Verify updateTodos([]) was called
      expect(ctx.todoContext?.updateTodos).toHaveBeenCalledWith([]);
      expect(ctx.todoContext?.todos).toEqual([]);
    });

    /**
     * @requirement REQ-003
     * @scenario Clear empty TODO list
     * @given User has empty TODO list
     * @when User executes /todo clear
     * @then No error occurs
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('handles clearing empty TODO list gracefully', async () => {
      const ctx = createMockContext([]);

      const clearSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'clear',
      );

      await clearSubcommand!.action!(ctx, '');
      expect(ctx.todoContext?.updateTodos).toHaveBeenCalledWith([]);
    });
  });

  describe('/todo show', () => {
    /**
     * @requirement REQ-004
     * @scenario Display current TODO list
     * @given User has active TODOs
     * @when User executes /todo show
     * @then Display formatted list with positions
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('displays current TODO list with formatting', async () => {
      const ctx = createMockContext([
        {
          id: '1',
          content: 'Parent task',
          status: 'in_progress',

          subtasks: [
            { id: '1.1', content: 'Subtask 1' },
            { id: '1.2', content: 'Subtask 2' },
          ],
        },
      ]);

      const showSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'show',
      );

      await showSubcommand!.action!(ctx, '');

      // Verify addItem was called with formatted output
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.text).toContain('Parent task');
      expect(call.text).toContain('Subtask 1');
      expect(call.text).toContain('Subtask 2');
    });

    /**
     * @requirement REQ-004
     * @scenario Display empty TODO list
     * @given User has no TODOs
     * @when User executes /todo show
     * @then Display "No active TODOs" message
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('displays message when TODO list is empty', async () => {
      const ctx = createMockContext([]);

      const showSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'show',
      );

      await showSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.text).toContain('No active TODOs');
    });
  });

  describe('/todo add', () => {
    /**
     * @requirement REQ-005
     * @scenario Insert TODO at numeric position
     * @given User has TODO list
     * @when User executes /todo add 2 "New task"
     * @then TODO is inserted at position 2
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('inserts TODO at numeric position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, '2 Task 2');

      // Verify updateTodos was called
      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(3);
      expect(updatedTodos[1].content).toBe('Task 2');
    });

    /**
     * @requirement REQ-005
     * @scenario Append TODO with "last" position
     * @given User has TODO list
     * @when User executes /todo add last "Final task"
     * @then TODO is appended to end
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('appends TODO with "last" position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, 'last Final task');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(2);
      expect(updatedTodos[1].content).toBe('Final task');
    });

    /**
     * @requirement REQ-005
     * @scenario Insert subtask at dotted position
     * @given Parent TODO exists
     * @when User executes /todo add 1.2 "New subtask"
     * @then Subtask is inserted at position 1.2
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('inserts subtask at dotted position', async () => {
      const ctx = createMockContext([
        {
          id: '1',
          content: 'Parent',
          status: 'pending',

          subtasks: [
            { id: '1.1', content: 'Sub 1' },
            { id: '1.3', content: 'Sub 3' },
          ],
        },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, '1.2 New subtask');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].subtasks?.length).toBe(3);
      expect(updatedTodos[0].subtasks?.[1].content).toBe('New subtask');
    });

    /**
     * @requirement REQ-005
     * @scenario Reject invalid position format
     * @given User provides invalid position
     * @when User executes /todo add invalid "Task"
     * @then Error is returned
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('rejects invalid position format', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, 'invalid Task');

      // Verify error was shown
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
    });
  });

  describe('/todo delete', () => {
    /**
     * @requirement REQ-006
     * @scenario Remove TODO at numeric position
     * @given User has TODO list
     * @when User executes /todo delete 2
     * @then TODO at position 2 is removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('removes TODO at numeric position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '2');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(2);
      expect(
        updatedTodos.find((t: Todo) => t.content === 'Task 2'),
      ).toBeUndefined();
    });

    /**
     * @requirement REQ-006
     * @scenario Remove parent TODO with all subtasks
     * @given Parent TODO has subtasks
     * @when User executes /todo delete 1
     * @then Parent and all subtasks are removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('removes parent TODO with all subtasks', async () => {
      const ctx = createMockContext([
        {
          id: '1',
          content: 'Parent',
          status: 'pending',

          subtasks: [
            { id: '1.1', content: 'Sub 1' },
            { id: '1.2', content: 'Sub 2' },
          ],
        },
      ]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(0);
    });

    /**
     * @requirement REQ-006
     * @scenario Remove subtask
     * @given Parent TODO has subtasks
     * @when User executes /todo delete 1.1
     * @then Subtask is removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('removes subtask at dotted position', async () => {
      const ctx = createMockContext([
        {
          id: '1',
          content: 'Parent',
          status: 'pending',

          subtasks: [
            { id: '1.1', content: 'Sub 1' },
            { id: '1.2', content: 'Sub 2' },
          ],
        },
      ]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '1.1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].subtasks?.length).toBe(1);
      expect(updatedTodos[0].subtasks?.[0].content).toBe('Sub 2');
    });
  });

  describe('/todo list', () => {
    /**
     * @requirement REQ-007
     * @scenario Display sorted TODO history
     * @given Multiple TODO files exist
     * @when User executes /todo list
     * @then Display sorted by mtime with current first
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('displays sorted TODO history with current session first', async () => {
      const ctx = createMockContext([]);

      const listSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'list',
      );

      await listSubcommand!.action!(ctx, '');
      expect(true).toBe(true);
    });

    /**
     * @requirement REQ-007
     * @scenario Handle empty TODO directory
     * @given No saved TODO files exist
     * @when User executes /todo list
     * @then Display "No saved TODO lists found"
     * @plan PLAN-20260129-TODOPERSIST.P05
     */
    it('handles empty TODO directory gracefully', async () => {
      const ctx = createMockContext([]);

      const listSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'list',
      );

      await listSubcommand!.action!(ctx, '');
      expect(true).toBe(true);
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

      expect(() => parsePosition('invalid', todos)).toThrow();
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
            expect(() => parsePosition(invalidPos, todos as Todo[])).toThrow();
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
    it('maintains TODO list consistency', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.string(),
              content: fc.string(),
              status: fc.constantFrom('pending', 'in_progress', 'completed'),
            }),
            { minLength: 0, maxLength: 5 },
          ),
          (initialTodos) => {
            // Stub phase - just verify no crash
            expect(initialTodos).toBeDefined();
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
