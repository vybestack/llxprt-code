/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TodoContinuationService } from './TodoContinuationService.js';
import { GeminiEventType } from './turn.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Todo } from '@vybestack/llxprt-code-tools';

// Mock TodoStore so persisted todo state doesn't hit the filesystem
const {
  todoStoreReadMock,
  todoStoreReadPausedMock,
  todoStoreWritePausedMock,
  mockTodoStoreConstructor,
} = vi.hoisted(() => {
  const readMock = vi.fn();
  const readPausedMock = vi.fn();
  const writePausedMock = vi.fn();
  const constructorMock = vi.fn().mockImplementation(() => ({
    readTodos: readMock,
    readPausedState: readPausedMock,
    writePausedState: writePausedMock,
  }));
  return {
    todoStoreReadMock: readMock,
    todoStoreReadPausedMock: readPausedMock,
    todoStoreWritePausedMock: writePausedMock,
    mockTodoStoreConstructor: constructorMock,
  };
});

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  return {
    ...actual,
    LocalTodoStore: mockTodoStoreConstructor,
  };
});

vi.mock(
  '@vybestack/llxprt-code-core/services/todo-reminder-service.js',
  () => ({
    TodoReminderService: vi.fn().mockImplementation(() => ({
      getComplexTaskSuggestion: vi
        .fn()
        .mockReturnValue('---\nSystem Note: complex suggestion\n---'),
      getEscalatedComplexTaskSuggestion: vi
        .fn()
        .mockReturnValue('---\nSystem Note: escalated complex suggestion\n---'),
      getCreateListReminder: vi
        .fn()
        .mockReturnValue('---\nSystem Note: Please create a todo list.\n---'),
      getUpdateActiveTodoReminder: vi
        .fn()
        .mockReturnValue('---\nSystem Note: Update the active todo.\n---'),
      getEscalatedActiveTodoReminder: vi
        .fn()
        .mockReturnValue('---\nSystem Note: Escalated - finish todos.\n---'),
    })),
  }),
);

function makeConfig(sessionId = 'test-session'): Config {
  return {
    getSessionId: vi.fn().mockReturnValue(sessionId),
  } as unknown as Config;
}

function makeService(
  overrides: Partial<{
    config: Config;
    todoReminderService: TodoReminderService;
    complexitySuggestionCooldown: number;
  }> = {},
): TodoContinuationService {
  return new TodoContinuationService({
    config: overrides.config ?? makeConfig(),
    todoReminderService:
      overrides.todoReminderService ?? new TodoReminderService(),
    complexitySuggestionCooldown:
      overrides.complexitySuggestionCooldown ?? 300000,
  });
}

const pendingTodo: Todo = {
  id: 'todo-1',
  content: 'Do the thing',
  status: 'pending',
};

const inProgressTodo: Todo = {
  id: 'todo-2',
  content: 'Currently doing',
  status: 'in_progress',
};

const completedTodo: Todo = {
  id: 'todo-3',
  content: 'Already done',
  status: 'completed',
};

describe('TodoContinuationService', () => {
  let service: TodoContinuationService;
  let reminderService: TodoReminderService;

  beforeEach(() => {
    vi.resetAllMocks();
    todoStoreReadMock.mockResolvedValue([]);
    todoStoreReadPausedMock.mockResolvedValue(false);
    todoStoreWritePausedMock.mockResolvedValue(undefined);
    mockTodoStoreConstructor.mockImplementation(() => ({
      readTodos: todoStoreReadMock,
      readPausedState: todoStoreReadPausedMock,
      writePausedState: todoStoreWritePausedMock,
    }));

    vi.mocked(TodoReminderService).mockImplementation(
      () =>
        ({
          getComplexTaskSuggestion: vi
            .fn()
            .mockReturnValue('---\nSystem Note: complex suggestion\n---'),
          getEscalatedComplexTaskSuggestion: vi
            .fn()
            .mockReturnValue(
              '---\nSystem Note: escalated complex suggestion\n---',
            ),
          getCreateListReminder: vi
            .fn()
            .mockReturnValue(
              '---\nSystem Note: Please create a todo list.\n---',
            ),
          getUpdateActiveTodoReminder: vi
            .fn()
            .mockReturnValue('---\nSystem Note: Update the active todo.\n---'),
          getEscalatedActiveTodoReminder: vi
            .fn()
            .mockReturnValue(
              '---\nSystem Note: Escalated - finish todos.\n---',
            ),
        }) as unknown as TodoReminderService,
    );

    reminderService = new TodoReminderService();
    service = makeService({ todoReminderService: reminderService });
  });

  describe('getActiveTodos', () => {
    it('returns only pending and in_progress todos', () => {
      const todos = [pendingTodo, inProgressTodo, completedTodo];
      const active = service.getActiveTodos(todos);
      expect(active).toHaveLength(2);
      expect(active.map((t) => t.id)).toContain('todo-1');
      expect(active.map((t) => t.id)).toContain('todo-2');
      expect(active.map((t) => t.id)).not.toContain('todo-3');
    });

    it('returns in_progress todos before pending todos', () => {
      const todos = [pendingTodo, inProgressTodo];
      const active = service.getActiveTodos(todos);
      expect(active[0].id).toBe('todo-2');
    });

    it('returns empty array when no active todos', () => {
      expect(service.getActiveTodos([completedTodo])).toHaveLength(0);
    });
  });

  describe('areTodoSnapshotsEqual', () => {
    it('returns true for identical snapshots', () => {
      const a = [pendingTodo];
      const b = [{ ...pendingTodo }];
      expect(service.areTodoSnapshotsEqual(a, b)).toBe(true);
    });

    it('returns false when lengths differ', () => {
      expect(service.areTodoSnapshotsEqual([pendingTodo], [])).toBe(false);
    });

    it('returns false when statuses differ', () => {
      const b = [{ ...pendingTodo, status: 'in_progress' as const }];
      expect(service.areTodoSnapshotsEqual([pendingTodo], b)).toBe(false);
    });

    it('returns false when content differs', () => {
      const b = [{ ...pendingTodo, content: 'Different task' }];
      expect(service.areTodoSnapshotsEqual([pendingTodo], b)).toBe(false);
    });
  });

  describe('resetActivityCounters', () => {
    it('resets toolCallReminderLevel and toolActivityCount', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      for (let i = 0; i < 5; i++) {
        service.recordModelActivity({
          type: GeminiEventType.ToolCallResponse,
          value: {
            callId: `call-${i}`,
            responseParts: [],
            resultDisplay: undefined,
            error: undefined,
            errorType: undefined,
          },
        });
      }
      expect(service.toolCallReminderLevel).toBe('escalated');
      service.resetActivityCounters();
      expect(service.toolCallReminderLevel).toBe('none');
      expect(service.toolActivityCount).toBe(0);
    });

    it('resets all per-chat state including complexity and snapshot tracking', () => {
      service.consecutiveComplexTurns = 5;
      service.lastTodoSnapshot = [pendingTodo];
      service.setLastTodoToolTurn(10);

      service.resetActivityCounters();

      expect(service.consecutiveComplexTurns).toBe(0);
      expect(service.lastTodoSnapshot).toBeUndefined();
    });
  });

  describe('readTodoSnapshot', () => {
    it('reads todos from the store using config session id', async () => {
      todoStoreReadMock.mockResolvedValue([pendingTodo]);
      const result = await service.readTodoSnapshot();
      expect(result).toStrictEqual([pendingTodo]);
      expect(mockTodoStoreConstructor).toHaveBeenCalledWith(
        'test-session',
        expect.anything(),
      );
    });

    it('returns empty array on error', async () => {
      todoStoreReadMock.mockRejectedValue(new Error('disk error'));
      const result = await service.readTodoSnapshot();
      expect(result).toStrictEqual([]);
    });
  });

  describe('readPausedState', () => {
    it('reads paused state from the store using config session id', async () => {
      todoStoreReadPausedMock.mockResolvedValue(true);

      const result = await service.readPausedState();

      expect(result).toBe(true);
      expect(mockTodoStoreConstructor).toHaveBeenCalledWith(
        'test-session',
        expect.anything(),
      );
    });

    it('returns false on error', async () => {
      todoStoreReadPausedMock.mockRejectedValue(new Error('disk error'));

      const result = await service.readPausedState();

      expect(result).toBe(false);
    });
  });

  describe('clearPausedState', () => {
    it('writes false to paused state for the current session', async () => {
      await service.clearPausedState();

      expect(todoStoreWritePausedMock).toHaveBeenCalledWith(false);
      expect(mockTodoStoreConstructor).toHaveBeenCalledWith(
        'test-session',
        expect.anything(),
      );
    });

    it('does not throw when clearing paused state fails', async () => {
      todoStoreWritePausedMock.mockRejectedValue(new Error('disk error'));

      await expect(service.clearPausedState()).resolves.toBeUndefined();
    });
  });
});
