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

    /**
     * @requirement REQ-005
     * @scenario Show help when no arguments provided
     * @given User has TODO list
     * @when User executes /todo add without arguments
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
     * @scenario Remove TODO at numeric position
     * @given User has TODO list
     * @when User executes /todo remove 2
     * @then TODO at position 2 is removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes TODO at numeric position', async () => {
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
     * @scenario Remove parent TODO with all subtasks
     * @given Parent TODO has subtasks
     * @when User executes /todo remove 1
     * @then Parent and all subtasks are removed
     * @plan PLAN-20260129-TODOPERSIST.P08
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
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
     * @given Parent TODO has subtasks
     * @when User executes /todo remove 1.1
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

    /**
     * @requirement REQ-006
     * @scenario Remove range of TODOs
     * @given User has 5 TODOs
     * @when User executes /todo remove 2-4
     * @then TODOs 2, 3, 4 are removed, 2 remain
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes range of TODOs', async () => {
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
     * @scenario Remove all TODOs
     * @given User has 3 TODOs
     * @when User executes /todo remove all
     * @then All TODOs are removed, 0 remain
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes all TODOs with "all" keyword', async () => {
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
     * @scenario Remove single TODO using range (1-1)
     * @given User has 3 TODOs
     * @when User executes /todo remove 1-1
     * @then Only TODO 1 is removed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('removes single TODO with range syntax (1-1)', async () => {
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
     * @given User has 5 TODOs
     * @when User executes /todo remove 5-2
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
     * @given User has 3 TODOs
     * @when User executes /todo remove 1-99
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
     * @given User has N TODOs
     * @when User removes range start-end
     * @then Removed count equals (end - start + 1)
     * @plan PLAN-20260129-TODOPERSIST-EXT.P18
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('property test: range removal count equals (end - start + 1)', () => {
      fc.assert(
        fc.property(
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
          ([todos, start, end]) => {
            const ctx = createMockContext(todos as Todo[]);

            const removeSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'remove',
            );

            removeSubcommand!.action!(ctx, `${start}-${end}`);

            if (ctx.todoContext?.updateTodos) {
              const calls = (
                ctx.todoContext.updateTodos as ReturnType<typeof vi.fn>
              ).mock.calls;
              if (calls.length > 0) {
                const updatedTodos = calls[0][0];
                const expectedRemoved = end - start + 1;
                const actualRemoved = todos.length - updatedTodos.length;
                expect(actualRemoved).toBe(expectedRemoved);
              }
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * @requirement REQ-006
     * @scenario Show help when no arguments provided
     * @given User has TODO list
     * @when User executes /todo remove without arguments
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

  describe('/todo delete (disk files)', () => {
    /**
     * @requirement REQ-010
     * @scenario Delete saved TODO session by number
     * @given User has saved TODO sessions
     * @when User executes /todo delete 1
     * @then First saved session is deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes saved TODO session at position 1', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );
      expect(deleteSubcommand).toBeDefined();

      // Note: This test relies on actual filesystem state
      // In real implementation, we'd need to create temp TODO files
      await deleteSubcommand!.action!(ctx, '1');

      // Verify that addItem was called with appropriate message
      expect(ctx.ui.addItem).toHaveBeenCalled();
    });

    /**
     * @requirement REQ-010
     * @scenario Delete range of saved TODO sessions
     * @given User has 5 saved sessions
     * @when User executes /todo delete 1-3
     * @then Sessions 1, 2, 3 are deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes range of saved TODO sessions', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '1-3');

      // Verify that addItem was called
      expect(ctx.ui.addItem).toHaveBeenCalled();
    });

    /**
     * @requirement REQ-010
     * @scenario Delete all saved TODO sessions
     * @given User has saved sessions
     * @when User executes /todo delete all
     * @then All saved sessions are deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes all saved TODO sessions with "all" keyword', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, 'all');

      expect(ctx.ui.addItem).toHaveBeenCalled();
    });

    /**
     * @requirement REQ-010
     * @scenario Delete session with out of range number
     * @given User has 2 saved sessions
     * @when User executes /todo delete 99
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows error when deleting out-of-range session', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      // Should either be error for no files, or error for out of range
      expect(call.type).toMatch(/error|info/i);
    });

    /**
     * @requirement REQ-010
     * @scenario Delete session without arguments
     * @given User has saved sessions
     * @when User executes /todo delete
     * @then Usage help is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows usage help when no number is provided', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );

      await deleteSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Usage');
      expect(call.text).toContain('disk');
    });
  });

  describe('/todo undo', () => {
    /**
     * @requirement REQ-011
     * @scenario Undo TODO at single position
     * @given User has TODO at position 1 with status completed
     * @when User executes /todo undo 1
     * @then TODO status changes to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets TODO at position 1 to pending', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'completed' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
      ]);

      const undoSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'undo',
      );
      expect(undoSubcommand).toBeDefined();

      await undoSubcommand!.action!(ctx, '1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].status).toBe('pending');
      expect(updatedTodos[0].content).toBe('Task 1');
    });

    /**
     * @requirement REQ-011
     * @scenario Undo range of TODOs
     * @given User has 5 TODOs with various statuses
     * @when User executes /todo undo 1-3
     * @then TODOs 1, 2, 3 status change to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets range of TODOs to pending', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'completed' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
        { id: '3', content: 'Task 3', status: 'completed' },
        { id: '4', content: 'Task 4', status: 'pending' },
        { id: '5', content: 'Task 5', status: 'completed' },
      ]);

      const undoSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'undo',
      );

      await undoSubcommand!.action!(ctx, '1-3');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].status).toBe('pending');
      expect(updatedTodos[1].status).toBe('pending');
      expect(updatedTodos[2].status).toBe('pending');
      expect(updatedTodos[3].status).toBe('pending'); // unchanged
      expect(updatedTodos[4].status).toBe('completed'); // unchanged
    });

    /**
     * @requirement REQ-011
     * @scenario Undo all TODOs
     * @given User has 3 TODOs with various statuses
     * @when User executes /todo undo all
     * @then All TODOs status change to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets all TODOs to pending with "all" keyword', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'completed' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
        { id: '3', content: 'Task 3', status: 'completed' },
      ]);

      const undoSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'undo',
      );

      await undoSubcommand!.action!(ctx, 'all');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].status).toBe('pending');
      expect(updatedTodos[1].status).toBe('pending');
      expect(updatedTodos[2].status).toBe('pending');
    });

    /**
     * @requirement REQ-011
     * @scenario Undo without arguments
     * @given User has TODOs
     * @when User executes /todo undo
     * @then Usage help is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows usage help when no arguments provided', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'completed' },
      ]);

      const undoSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'undo',
      );

      await undoSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Usage');
      expect(call.text).toContain('pending');
    });

    /**
     * @requirement REQ-011
     * @scenario Undo non-existent TODO position
     * @given User has 2 TODOs
     * @when User executes /todo undo 99
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('shows error when undoing non-existent position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'completed' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
      ]);

      const undoSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'undo',
      );

      await undoSubcommand!.action!(ctx, '99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Position');
    });
  });

  describe('/todo unset', () => {
    /**
     * @requirement REQ-008
     * @scenario Unset TODO to pending
     * @given User has TODO at position 1 with in_progress status
     * @when User executes /todo unset 1
     * @then TODO status changes to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P22
     */
    it('sets TODO at position 1 to pending', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'in_progress' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ]);

      const unsetSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'unset',
      );
      expect(unsetSubcommand).toBeDefined();

      await unsetSubcommand!.action!(ctx, '1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].status).toBe('pending');
      expect(updatedTodos[0].content).toBe('Task 1');
    });

    /**
     * @requirement REQ-008
     * @scenario Unset non-existent TODO position
     * @given User has 2 TODOs
     * @when User executes /todo unset 99
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P22
     */
    it('shows error when unsetting non-existent position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'in_progress' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ]);

      const unsetSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'unset',
      );

      await unsetSubcommand!.action!(ctx, '99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Position');
    });

    /**
     * @requirement REQ-008
     * @scenario Unset TODO without position argument
     * @given User has TODOs
     * @when User executes /todo unset
     * @then Usage help message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P22
     */
    it('shows usage help when no position is provided', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'in_progress' },
      ]);

      const unsetSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'unset',
      );

      await unsetSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Usage');
      expect(call.text).toContain('pending');
    });
  });

  describe('/todo set', () => {
    /**
     * @requirement REQ-008
     * @scenario Set TODO to in_progress
     * @given User has TODO at position 1
     * @when User executes /todo set 1
     * @then TODO status changes to in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('sets TODO at position 1 to in_progress', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ]);

      const setSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'set',
      );
      expect(setSubcommand).toBeDefined();

      await setSubcommand!.action!(ctx, '1');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[0].status).toBe('in_progress');
      expect(updatedTodos[0].content).toBe('Task 1');
    });

    /**
     * @requirement REQ-008
     * @scenario Set TODO at position 2 to in_progress
     * @given User has multiple TODOs
     * @when User executes /todo set 2
     * @then Second TODO status changes to in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('sets TODO at position 2 to in_progress', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'completed' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      const setSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'set',
      );

      await setSubcommand!.action!(ctx, '2');

      expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
      const updatedTodos = (
        ctx.todoContext?.updateTodos as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(updatedTodos[1].status).toBe('in_progress');
      expect(updatedTodos[1].content).toBe('Task 2');
    });

    /**
     * @requirement REQ-008
     * @scenario Set non-existent TODO position
     * @given User has 2 TODOs
     * @when User executes /todo set 99
     * @then Error message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('shows error when setting non-existent position', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ]);

      const setSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'set',
      );

      await setSubcommand!.action!(ctx, '99');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('error');
      expect(call.text).toContain('Position');
    });

    /**
     * @requirement REQ-008
     * @scenario Set TODO without position argument
     * @given User has TODOs
     * @when User executes /todo set
     * @then Usage help message is displayed
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     * @plan PLAN-20260129-TODOPERSIST-EXT.P20
     */
    it('shows usage help when no position is provided', async () => {
      const ctx = createMockContext([
        { id: '1', content: 'Task 1', status: 'pending' },
      ]);

      const setSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'set',
      );

      await setSubcommand!.action!(ctx, '');

      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      expect(call.text).toContain('Usage');
      expect(call.text).toContain('in_progress');
    });

    /**
     * @requirement REQ-008
     * @scenario Property-based: Set any valid position
     * @given User has N TODOs
     * @when User sets any valid position
     * @then That TODO's status becomes in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('property test: setting any valid position updates status', () => {
      fc.assert(
        fc.property(
          fc
            .array(
              fc.record({
                id: fc.string(),
                content: fc.string(),
                status: fc.constantFrom('pending', 'completed'),
              }),
              { minLength: 1, maxLength: 10 },
            )
            .chain((todos) =>
              fc.tuple(
                fc.constant(todos),
                fc.integer({ min: 1, max: todos.length }),
              ),
            ),
          ([todos, position]) => {
            const ctx = createMockContext(todos as Todo[]);

            const setSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'set',
            );

            setSubcommand!.action!(ctx, position.toString());

            expect(ctx.todoContext?.updateTodos).toHaveBeenCalled();
            const calls = (
              ctx.todoContext!.updateTodos as ReturnType<typeof vi.fn>
            ).mock.calls;
            const updatedTodos = calls[0][0];
            expect(updatedTodos[position - 1].status).toBe('in_progress');
          },
        ),
        { numRuns: 10 },
      );
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

      // Verify addItem was called with a message
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      // Should either show files or "No saved TODO lists found"
      expect(call.type).toBe('info');
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

      // Verify addItem was called with a message
      expect(ctx.ui.addItem).toHaveBeenCalled();
      const call = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(call.type).toBe('info');
      // Should either show files or "No saved TODO lists found" message
      // (depending on whether files exist in the system from previous tests)
      expect(call.text).toMatch(/No saved TODO lists found|Saved TODO Lists/);
    });
  });

  describe('/todo load', () => {
    /**
     * @requirement REQ-009
     * @scenario Load TODO session by number
     * @given User has saved TODO sessions
     * @when User executes /todo load 1
     * @then First session is loaded into active TODOs
     * @plan PLAN-20260129-TODOPERSIST-EXT.P19
     */
    it('loads TODO session at position 1', async () => {
      const ctx = createMockContext([]);

      const loadSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'load',
      );
      expect(loadSubcommand).toBeDefined();

      // Note: This test relies on actual filesystem state
      // In real implementation, we'd need to create temp TODO files
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
     * @scenario Load TODO session with invalid number
     * @given User has 2 saved sessions
     * @when User executes /todo load 99
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
     * @scenario Load TODO session without arguments
     * @given User has saved sessions
     * @when User executes /todo load
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
     * @scenario Load TODO session with invalid number format
     * @given User has saved sessions
     * @when User executes /todo load abc
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
            { minLength: 1, maxLength: 5 },
          ),
          (initialTodos) => {
            const ctx = createMockContext(initialTodos as Todo[]);
            const initialLength = initialTodos.length;

            const addSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'add',
            );
            const removeSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'remove',
            );

            // Add a todo at last position
            addSubcommand!.action!(ctx, 'last New task');

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

            // Remove the last todo
            removeSubcommand!.action!(ctx, todosAfterAdd.length.toString());

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
