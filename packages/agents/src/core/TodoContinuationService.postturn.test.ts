/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TodoContinuationService,
  PostTurnAction,
  type PostTurnContext,
} from './TodoContinuationService.js';
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

  describe('shouldDeferStreamEvent', () => {
    it('returns true for Content events', () => {
      expect(
        service.shouldDeferStreamEvent({
          type: GeminiEventType.Content,
          value: 'text',
        }),
      ).toBe(true);
    });

    it('returns true for Finished events', () => {
      expect(
        service.shouldDeferStreamEvent({
          type: GeminiEventType.Finished,
          value: { reason: 'STOP' },
        }),
      ).toBe(true);
    });

    it('returns true for Citation events', () => {
      expect(
        service.shouldDeferStreamEvent({
          type: GeminiEventType.Citation,
          value: {},
        }),
      ).toBe(true);
    });

    it('returns false for Error events', () => {
      expect(
        service.shouldDeferStreamEvent({
          type: GeminiEventType.Error,
          value: { error: new Error('oops') },
        }),
      ).toBe(false);
    });

    it('returns false for ToolCallRequest events', () => {
      expect(
        service.shouldDeferStreamEvent({
          type: GeminiEventType.ToolCallRequest,
          value: { name: 'some_tool', args: {}, callId: 'c1' },
        }),
      ).toBe(false);
    });
  });

  describe('isTodoPauseResponse', () => {
    it('returns true when response contains todo_pause function response', () => {
      const response = {
        callId: 'pause-1',
        responseParts: [
          {
            functionResponse: {
              name: 'todo_pause',
              id: 'pause-1',
              response: {},
            },
          },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      };
      expect(service.isTodoPauseResponse(response)).toBe(true);
    });

    it('returns false for non-pause responses', () => {
      const response = {
        callId: 'tool-1',
        responseParts: [
          {
            functionResponse: {
              name: 'read_file',
              id: 'tool-1',
              response: { content: 'data' },
            },
          },
        ],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      };
      expect(service.isTodoPauseResponse(response)).toBe(false);
    });

    it('returns false for undefined response', () => {
      expect(service.isTodoPauseResponse(undefined)).toBe(false);
    });
  });

  describe('classifyPostTurnAction', () => {
    const baseContext: PostTurnContext = {
      hadToolCalls: false,
      hadThinking: false,
      hadContent: false,
      todoPauseSeen: false,
      retryCount: 0,
      maxRetries: 3,
      activeTodos: [],
      hasPendingReminder: false,
    };

    it('returns Finish when tool calls were made', () => {
      const ctx: PostTurnContext = { ...baseContext, hadToolCalls: true };
      expect(service.classifyPostTurnAction(ctx)).toBe(PostTurnAction.Finish);
    });

    it('returns ThinkingOnlyRetry when thinking-only and retries remain', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        hadThinking: true,
        hadContent: false,
        hadToolCalls: false,
        retryCount: 0,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(
        PostTurnAction.ThinkingOnlyRetry,
      );
    });

    it('returns Finish when thinking-only but max retries hit', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        hadThinking: true,
        hadContent: false,
        hadToolCalls: false,
        retryCount: 3,
        maxRetries: 3,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(PostTurnAction.Finish);
    });

    it('returns Finish when todo pause was seen', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        todoPauseSeen: true,
        activeTodos: [pendingTodo],
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(PostTurnAction.Finish);
    });

    it('returns Finish when no active todos and no pending reminder', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        activeTodos: [],
        hasPendingReminder: false,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(PostTurnAction.Finish);
    });

    it('returns RetryWithReminder when active todos pending and retries remain', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        activeTodos: [pendingTodo],
        hasPendingReminder: false,
        retryCount: 0,
        maxRetries: 3,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(
        PostTurnAction.RetryWithReminder,
      );
    });

    it('returns Finish when active todos pending but max retries hit', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        activeTodos: [pendingTodo],
        retryCount: 3,
        maxRetries: 3,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(PostTurnAction.Finish);
    });

    it('returns RetryWithReminder when pending reminder exists and retries remain', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        hasPendingReminder: true,
        activeTodos: [],
        retryCount: 0,
        maxRetries: 3,
      };
      expect(service.classifyPostTurnAction(ctx)).toBe(
        PostTurnAction.RetryWithReminder,
      );
    });

    it('does NOT yield events or invoke side effects — returns enum only', () => {
      const ctx: PostTurnContext = {
        ...baseContext,
        hadToolCalls: true,
      };
      const result = service.classifyPostTurnAction(ctx);
      expect(typeof result).toBe('string');
      expect(Object.values(PostTurnAction)).toContain(result);
    });
  });
});
