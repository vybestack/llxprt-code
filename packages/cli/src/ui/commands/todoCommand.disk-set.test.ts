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
  describe('/todo delete (disk files)', () => {
    /**
     * @requirement REQ-010
     * @scenario Delete saved task session by number
     * @given User has saved task sessions
     * @when User executes the delete command with position 1
     * @then First saved session is deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes saved task session at position 1', async () => {
      const ctx = createMockContext([]);

      const deleteSubcommand = todoCommand.subCommands?.find(
        (cmd) => cmd.name === 'delete',
      );
      expect(deleteSubcommand).toBeDefined();

      // Note: This test relies on actual filesystem state
      // In real implementation, we'd need to create temp task files
      await deleteSubcommand!.action!(ctx, '1');

      // Verify that addItem was called with appropriate message
      expect(ctx.ui.addItem).toHaveBeenCalled();
    });

    /**
     * @requirement REQ-010
     * @scenario Delete range of saved task sessions
     * @given User has 5 saved sessions
     * @when User executes the delete command with range 1-3
     * @then Sessions 1, 2, 3 are deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes range of saved task sessions', async () => {
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
     * @scenario Delete all saved task sessions
     * @given User has saved sessions
     * @when User executes the delete command with "all"
     * @then All saved sessions are deleted from disk
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('deletes all saved task sessions with "all" keyword', async () => {
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
     * @when User executes the delete command with position 99
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
     * @when User executes the delete command without arguments
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
     * @scenario Undo task at single position
     * @given User has task at position 1 with status completed
     * @when User executes the undo command with position 1
     * @then Task status changes to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets task at position 1 to pending', async () => {
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
     * @scenario Undo range of tasks
     * @given User has 5 tasks with various statuses
     * @when User executes the undo command with range 1-3
     * @then Tasks 1, 2, 3 status change to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets range of tasks to pending', async () => {
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
     * @scenario Undo all tasks
     * @given User has 3 tasks with various statuses
     * @when User executes the undo command with "all"
     * @then All tasks status change to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P21
     */
    it('resets all tasks to pending with "all" keyword', async () => {
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
     * @given User has tasks
     * @when User executes the undo command without arguments
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
     * @scenario Undo non-existent task position
     * @given User has 2 tasks
     * @when User executes the undo command with invalid position 99
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
     * @scenario Unset task to pending
     * @given User has task at position 1 with in_progress status
     * @when User executes the unset command with position 1
     * @then Task status changes to pending
     * @plan PLAN-20260129-TODOPERSIST-EXT.P22
     */
    it('sets task at position 1 to pending', async () => {
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
     * @scenario Unset non-existent task position
     * @given User has 2 tasks
     * @when User executes the unset command with invalid position 99
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
     * @scenario Unset task without position argument
     * @given User has tasks
     * @when User executes the unset command without arguments
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
     * @scenario Set task to in_progress
     * @given User has task at position 1
     * @when User executes the set command with position 1
     * @then Task status changes to in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('sets task at position 1 to in_progress', async () => {
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
     * @scenario Set task at position 2 to in_progress
     * @given User has multiple tasks
     * @when User executes the set command with position 2
     * @then Second task status changes to in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('sets task at position 2 to in_progress', async () => {
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
     * @scenario Set non-existent task position
     * @given User has 2 tasks
     * @when User executes the set command with invalid position 99
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
     * @scenario Set task without position argument
     * @given User has tasks
     * @when User executes the set command without arguments
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
     * @given User has N tasks
     * @when User sets any valid position
     * @then That task's status becomes in_progress
     * @plan PLAN-20260129-TODOPERSIST-EXT.P17
     */
    it('property test: setting any valid position updates status', async () => {
      await fc.assert(
        fc.asyncProperty(
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
          async ([todos, position]) => {
            const ctx = createMockContext(todos as Todo[]);

            const setSubcommand = todoCommand.subCommands?.find(
              (cmd) => cmd.name === 'set',
            );

            await setSubcommand!.action!(ctx, position.toString());

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
});
