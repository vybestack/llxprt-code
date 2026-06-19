/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TodoContinuationService } from './TodoContinuationService.js';
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

  describe('getTodoReminderForCurrentState', () => {
    it('returns create list reminder when no todos exist', async () => {
      todoStoreReadMock.mockResolvedValue([]);
      const result = await service.getTodoReminderForCurrentState();
      expect(result.reminder).toBeDefined();
      expect(
        vi.mocked(reminderService.getCreateListReminder),
      ).toHaveBeenCalled();
    });

    it('returns update reminder when active todos exist', async () => {
      todoStoreReadMock.mockResolvedValue([pendingTodo]);
      const result = await service.getTodoReminderForCurrentState();
      expect(result.reminder).toBeDefined();
      expect(
        vi.mocked(reminderService.getUpdateActiveTodoReminder),
      ).toHaveBeenCalledWith(pendingTodo);
    });

    it('suppresses reminders and active todos when todo continuation is paused', async () => {
      todoStoreReadMock.mockResolvedValue([pendingTodo]);
      todoStoreReadPausedMock.mockResolvedValue(true);

      const result = await service.getTodoReminderForCurrentState();

      expect(result).toStrictEqual({
        reminder: null,
        todos: [pendingTodo],
        activeTodos: [],
      });
      expect(
        vi.mocked(reminderService.getUpdateActiveTodoReminder),
      ).not.toHaveBeenCalled();
      expect(
        vi.mocked(reminderService.getCreateListReminder),
      ).not.toHaveBeenCalled();
    });

    it('returns escalated reminder when escalate flag is set', async () => {
      todoStoreReadMock.mockResolvedValue([pendingTodo]);
      const result = await service.getTodoReminderForCurrentState({
        escalate: true,
      });
      expect(result.reminder).toBeDefined();
      expect(
        vi.mocked(reminderService.getEscalatedActiveTodoReminder),
      ).toHaveBeenCalled();
    });

    it('returns null reminder when todos exist but none are active', async () => {
      todoStoreReadMock.mockResolvedValue([completedTodo]);
      const result = await service.getTodoReminderForCurrentState();
      expect(result.reminder).toBeNull();
    });
  });

  describe('appendSystemReminderToRequest', () => {
    it('appends reminder text to request array', () => {
      const req = [{ text: 'original request' }];
      const result = service.appendSystemReminderToRequest(
        req,
        'System reminder text',
      );
      const arr = result as Array<{ text?: string }>;
      expect(arr.some((p) => p.text === 'System reminder text')).toBe(true);
    });

    it('does not duplicate existing reminder', () => {
      const req = [
        { text: 'original request' },
        { text: 'System reminder text' },
      ];
      const result = service.appendSystemReminderToRequest(
        req,
        'System reminder text',
      );
      const arr = result as Array<{ text?: string }>;
      const count = arr.filter((p) => p.text === 'System reminder text').length;
      expect(count).toBe(1);
    });

    it('normalizes string input and appends reminder', () => {
      const result = service.appendSystemReminderToRequest(
        'plain string',
        'System reminder text',
      );
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr).toHaveLength(2);
      expect(arr[0]).toStrictEqual({ text: 'plain string' });
      expect(arr[1].text).toBe('System reminder text');
    });

    it('normalizes singular {text} object and appends reminder', () => {
      const result = service.appendSystemReminderToRequest(
        { text: 'single part' },
        'Reminder',
      );
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr).toHaveLength(2);
      expect(arr[0]).toStrictEqual({ text: 'single part' });
      expect(arr[1].text).toBe('Reminder');
    });
  });

  describe('applyPendingReminder', () => {
    it('returns the original request and resets pending reminder state when paused', async () => {
      const request = [{ text: 'original request' }];
      service.toolCallReminderLevel = 'base';
      service.toolActivityCount = 5;
      todoStoreReadPausedMock.mockResolvedValue(true);

      const result = await service.applyPendingReminder(request);

      expect(result).toBe(request);
      expect(service.toolCallReminderLevel).toBe('none');
      expect(service.toolActivityCount).toBe(0);
      expect(todoStoreReadMock).not.toHaveBeenCalled();
      expect(
        vi.mocked(reminderService.getUpdateActiveTodoReminder),
      ).not.toHaveBeenCalled();
    });
  });

  describe('buildFollowUpReminder', () => {
    it('returns update reminder text when active todos exist', () => {
      service.lastTodoSnapshot = [];
      const result = service.buildFollowUpReminder(
        [pendingTodo],
        [pendingTodo],
      );
      expect(result).toBe('---\nSystem Note: Update the active todo.\n---');
      expect(
        vi.mocked(reminderService.getUpdateActiveTodoReminder),
      ).toHaveBeenCalledWith(pendingTodo);
      expect(
        vi.mocked(reminderService.getEscalatedActiveTodoReminder),
      ).not.toHaveBeenCalled();
    });

    it('returns escalated reminder when snapshot unchanged', () => {
      service.lastTodoSnapshot = [pendingTodo];
      service.buildFollowUpReminder([pendingTodo], [pendingTodo]);
      expect(
        vi.mocked(reminderService.getEscalatedActiveTodoReminder),
      ).toHaveBeenCalled();
    });

    it('returns create-list reminder when no todos and list is empty', () => {
      service.lastTodoSnapshot = [];
      const result = service.buildFollowUpReminder([], []);
      expect(result).toBeDefined();
      expect(
        vi.mocked(reminderService.getCreateListReminder),
      ).toHaveBeenCalled();
    });

    it('returns undefined when no active todos and snapshot has items', () => {
      service.lastTodoSnapshot = [completedTodo];
      const result = service.buildFollowUpReminder([completedTodo], []);
      expect(result).toBeUndefined();
    });
  });
});
