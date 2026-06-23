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
import { todoCommand } from './todoCommand.js';
import type { CommandContext } from './types.js';
import type { Todo } from '@vybestack/llxprt-code-core';
import * as fc from 'fast-check';
import { assertTrue } from '../../test-utils/assertions.js';

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
  describe('/todo clear', () => {
    /**
     * @requirement REQ-003
     * @scenario Clear all tasks from active session
     * @given User has active task list
     * @when User executes the clear command
     * @then All tasks are removed from memory
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('clears all tasks from active session', async () => {
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
      expect(ctx.todoContext?.todos).toStrictEqual([]);
    });

    /**
     * @requirement REQ-003
     * @scenario Clear empty task list
     * @given User has empty task list
     * @when User executes the clear command
     * @then No error occurs
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('handles clearing empty task list gracefully', async () => {
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
     * @scenario Display current task list
     * @given User has active tasks
     * @when User executes the show command
     * @then Display formatted list with positions
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('displays current task list with formatting', async () => {
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
     * @scenario Display empty task list
     * @given User has no tasks
     * @when User executes the show command
     * @then Display "No active tasks" message
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('displays message when task list is empty', async () => {
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
     * @scenario Insert task at numeric position
     * @given User has task list
     * @when User executes the add command 2 "New task"
     * @then Task is inserted at position 2
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('inserts task at numeric position', async () => {
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
     * @scenario Append task with "last" position
     * @given User has task list
     * @when User executes the add command last "Final task"
     * @then Task is appended to end
     * @plan PLAN-20260129-TODOPERSIST.P08
     */
    it('appends task with "last" position', async () => {
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
     * @given Parent task exists
     * @when User executes the add command 1.2 "New subtask"
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
     * @when User executes the add command invalid "Task"
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

    it('rejects zero subtask position without mutating subtasks', async () => {
      const ctx = createMockContext([
        {
          id: '1',
          content: 'Parent',
          status: 'pending',
          subtasks: [{ id: '1.1', content: 'Sub 1' }],
        },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, '1.0 New subtask');

      expect(ctx.todoContext?.updateTodos).not.toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Subtask position 0 out of range');
    });
    /**
     * @requirement REQ-005
     * @scenario Show help when no arguments provided
     * @given User has task list
     * @when User executes the add command without arguments
     * @then Help text is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P20
     */
    it('shows help text when no arguments provided', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
      ]);

      const addSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'add',
      );

      await addSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Position formats');
      expect(call.text).toContain('last');
      expect(call.text).toContain('1.1');
    });
  });

  describe('/todo remove', () => {
    /**
     * @requirement REQ-006
     * @scenario Remove task at numeric position
     * @given User has task list
     * @when User executes the remove command with position 2
     * @then Task at position 2 is removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes task at numeric position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '2');

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
     * @scenario Remove parent task with all subtasks
     * @given Parent task has subtasks
     * @when User executes the remove command with position 1
     * @then Parent and all subtasks are removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes parent task with all subtasks', async () => {
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

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(0);
    });

    /**
     * @requirement REQ-006
     * @scenario Remove subtask
     * @given Parent task has subtasks
     * @when User executes the remove command with position 1.1
     * @then Subtask is removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
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

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '1.1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].subtasks?.length).toBe(1);
      expect(updatedTodos[0].subtasks?.[0].content).toBe('Sub 2');
    });

    it('rejects zero subtask removal without removing from the end', async () => {
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

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '1.0');

      expect(ctx.todoContext?.updateTodos).not.toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Subtask position 0 out of range');
    });
    /**
     * @requirement REQ-006
     * @scenario Remove range of tasks
     * @given User has 5 tasks
     * @when User executes the remove command with range 2-4
     * @then Tasks 2, 3, 4 are removed, 2 remain
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes range of tasks', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
        { id: '4', content: 'Task 4', status: 'pending' },
        { id: '5', content: 'Task 5', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '2-4');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(2);
      expect(updatedTodos[0].content).toBe('Task 1');
      expect(updatedTodos[1].content).toBe('Task 5');
    });

    /**
     * @requirement REQ-006
     * @scenario Remove all tasks
     * @given User has 3 tasks
     * @when User executes the remove command with "all"
     * @then All tasks are removed, 0 remain
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes all tasks with "all" keyword', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, 'all');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(0);
    });

    /**
     * @requirement REQ-006
     * @scenario Remove single task using range (1-1)
     * @given User has 3 tasks
     * @when User executes the remove command with range 1-1
     * @then Only task 1 is removed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes single task with range syntax (1-1)', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '1-1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos.length).toBe(2);
      expect(updatedTodos[0].content).toBe('Task 2');
      expect(updatedTodos[1].content).toBe('Task 3');
    });

    /**
     * @requirement REQ-006
     * @scenario Error on invalid range (start > end)
     * @given User has 5 tasks
     * @when User executes the remove command with invalid range 5-2
     * @then Error is shown
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows error for invalid range (start > end)', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
        { id: '4', content: 'Task 4', status: 'pending' },
        { id: '5', content: 'Task 5', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '5-2');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Invalid range');
    });

    /**
     * @requirement REQ-006
     * @scenario Error on out of bounds range
     * @given User has 3 tasks
     * @when User executes the remove command with out of bounds range 1-99
     * @then Error is shown
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows error for out of bounds range', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '1-99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toMatch(/out of (range|bounds)/i);
    });

    /**
     * @requirement REQ-006
     * @scenario Property test: range removal count
     * @given User has N tasks
     * @when User removes range start-end
     * @then Removed count equals (end - start + 1)
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('property test: range removal count equals (end - start + 1)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .array(
              fc.record({
                id: fc.string(),
                content: fc.string(),
                status: fc.constantFrom('pending', 'in_progress', 'completed'),
              }),
              { minLength: 5, maxLength: 10 },
            )
            .chain((todos) =>
              fc.tuple(
                fc.constant(todos),
                fc.integer({ min: 1, max: todos.length }),
              ),
            )
            .chain(([todos, start]) =>
              fc.tuple(
                fc.constant(todos),
                fc.constant(start),
                fc.integer({ min: start, max: todos.length }),
              ),
            ),
          async ([todos, start, end]) => {
            const ctx = createMockContext(todos as Todo[]);

            const removeSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'remove',
            );

            await removeSubcommand!.action!(ctx, `${start}-${end}`);

            assertTrue(ctx.todoContext?.updateTodos);
            const calls = (
              ctx.todoContext.updateTodos as ReturnType<typeof vi.fn>
            ).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            const updatedTodos = calls[0][0];
            const expectedRemoved = end - start + 1;
            const actualRemoved = todos.length - updatedTodos.length;
            expect(actualRemoved).toBe(expectedRemoved);
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * @requirement REQ-006
     * @scenario Show help when no arguments provided
     * @given User has task list
     * @when User executes the remove command without arguments
     * @then Help text is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P20
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows help text when no arguments provided', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
      ]);

      const removeSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'remove',
      );

      await removeSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Position formats');
      expect(call.text).toContain('all');
      expect(call.text).toContain('1-5');
    });
  });
});
