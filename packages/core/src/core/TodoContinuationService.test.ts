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
import { TodoReminderService } from '../services/todo-reminder-service.js';
import type { Config } from '../config/config.js';
import type { Todo } from '../tools/todo-schemas.js';

// Mock TodoStore so readTodoSnapshot doesn't hit the filesystem
const { todoStoreReadMock, mockTodoStoreConstructor } = vi.hoisted(() => {
  const readMock = vi.fn();
  const constructorMock = vi.fn().mockImplementation(() => ({
    readTodos: readMock,
  }));
  return {
    todoStoreReadMock: readMock,
    mockTodoStoreConstructor: constructorMock,
  };
});

vi.mock('../tools/todo-store.js', () => ({
  TodoStore: mockTodoStoreConstructor,
}));

vi.mock('../services/todo-reminder-service.js', () => ({
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
}));

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
    mockTodoStoreConstructor.mockImplementation(() => ({
      readTodos: todoStoreReadMock,
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

  describe('updateTodoToolAvailabilityFromDeclarations', () => {
    it('enables todo tools when both todo_write and todo_read are present', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
        { name: 'other_tool' },
      ]);
      // Setting should affect processComplexityAnalysis behavior
      const result = service.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: ['task1'],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeDefined();
    });

    it('disables todo tools when declarations are empty', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      service.updateTodoToolAvailabilityFromDeclarations([]);
      const result = service.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: ['task1'],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeUndefined();
    });

    it('is case-insensitive for tool names', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'TODO_WRITE' },
        { name: 'TODO_READ' },
      ]);
      const result = service.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: [],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeDefined();
    });
  });

  describe('processComplexityAnalysis', () => {
    it('returns undefined when todoTools are not available', () => {
      const result = service.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: ['task1', 'task2'],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeUndefined();
    });

    it('returns undefined for non-complex analysis', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      const result = service.processComplexityAnalysis(
        {
          isComplex: false,
          shouldSuggestTodos: false,
          complexityScore: 0.1,
          detectedTasks: [],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeUndefined();
    });

    it('returns complexity suggestion for complex tasks', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      const svc = makeService({
        todoReminderService: reminderService,
        complexitySuggestionCooldown: 0,
      });
      svc.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      const result = svc.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: ['task1', 'task2'],
          sequentialIndicators: [],
          questionCount: 0,
        },
        1,
      );
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('respects cooldown period between suggestions', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      const svc = makeService({
        todoReminderService: reminderService,
        complexitySuggestionCooldown: 300000,
      });
      svc.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      const analysis = {
        isComplex: true,
        shouldSuggestTodos: true,
        complexityScore: 0.9,
        detectedTasks: ['task1'],
        sequentialIndicators: [],
        questionCount: 0,
      };
      const first = svc.processComplexityAnalysis(analysis, 1);
      expect(first).toBeDefined();
      const second = svc.processComplexityAnalysis(analysis, 2);
      expect(second).toBeUndefined();
    });

    it('returns escalated suggestion after consecutive complex turns at threshold', () => {
      const svc = makeService({
        todoReminderService: reminderService,
        complexitySuggestionCooldown: 0,
      });
      svc.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      // Force consecutive complex turns past threshold
      svc.consecutiveComplexTurns = 3;
      const result = svc.processComplexityAnalysis(
        {
          isComplex: true,
          shouldSuggestTodos: true,
          complexityScore: 0.9,
          detectedTasks: ['task1'],
          sequentialIndicators: [],
          questionCount: 0,
        },
        10,
      );
      expect(result).toBeDefined();
      expect(
        vi.mocked(reminderService.getEscalatedComplexTaskSuggestion),
      ).toHaveBeenCalled();
    });
  });

  describe('isTodoToolCall', () => {
    it('returns true for todo_write', () => {
      expect(service.isTodoToolCall('todo_write')).toBe(true);
    });

    it('returns true for todo_read case-insensitively', () => {
      expect(service.isTodoToolCall('TODO_READ')).toBe(true);
      expect(service.isTodoToolCall('Todo_Write')).toBe(true);
    });

    it('returns false for non-todo tool names', () => {
      expect(service.isTodoToolCall('read_file')).toBe(false);
      expect(service.isTodoToolCall('run_shell_command')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(service.isTodoToolCall(42)).toBe(false);
      expect(service.isTodoToolCall(null)).toBe(false);
      expect(service.isTodoToolCall(undefined)).toBe(false);
    });
  });

  describe('appendTodoSuffixToRequest', () => {
    it('appends suffix to request array', () => {
      const req = [{ text: 'Do something' }];
      const result = service.appendTodoSuffixToRequest(req);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr.some((p) => p.text?.includes('TODO List'))).toBe(true);
    });

    it('does not duplicate suffix if already present', () => {
      const req = [
        { text: 'Do something' },
        { text: 'Use TODO List to organize this effort.' },
      ];
      const result = service.appendTodoSuffixToRequest(req);
      const arr = result as Array<{ text?: string }>;
      const suffixCount = arr.filter((p) =>
        p.text?.includes('Use TODO List to organize this effort.'),
      ).length;
      expect(suffixCount).toBe(1);
    });

    it('normalizes string request to Part array and appends suffix', () => {
      const req = 'plain string request';
      const result = service.appendTodoSuffixToRequest(req);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr[0]).toEqual({ text: 'plain string request' });
      expect(arr.some((p) => p.text?.includes('TODO List'))).toBe(true);
    });

    it('normalizes singular {text} object and appends suffix', () => {
      const req = { text: 'do this task' };
      const result = service.appendTodoSuffixToRequest(req);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr[0]).toEqual({ text: 'do this task' });
      expect(arr.some((p) => p.text?.includes('TODO List'))).toBe(true);
    });

    it('does not mutate the original array', () => {
      const req = [{ text: 'Do something' }];
      const original = [...req];
      service.appendTodoSuffixToRequest(req);
      expect(req).toEqual(original);
    });
  });

  describe('recordModelActivity', () => {
    it('ignores events when todoTools not available', () => {
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
      expect(service.toolActivityCount).toBe(0);
      expect(service.toolCallReminderLevel).toBe('none');
    });

    it('only counts ToolCallResponse events', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      for (let i = 0; i < 5; i++) {
        service.recordModelActivity({
          type: GeminiEventType.Content,
          value: 'text',
        });
      }
      expect(service.toolActivityCount).toBe(0);
    });

    it('sets base reminder level at 4 tool calls', () => {
      service.updateTodoToolAvailabilityFromDeclarations([
        { name: 'todo_write' },
        { name: 'todo_read' },
      ]);
      for (let i = 0; i < 4; i++) {
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
      expect(service.toolCallReminderLevel).toBe('base');
    });

    it('sets escalated reminder level above 4 tool calls', () => {
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
    });
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
      expect(arr[0]).toEqual({ text: 'plain string' });
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
      expect(arr[0]).toEqual({ text: 'single part' });
      expect(arr[1].text).toBe('Reminder');
    });
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

  describe('buildFollowUpReminder', () => {
    it('returns update reminder text when active todos exist', () => {
      service.lastTodoSnapshot = [pendingTodo];
      const result = service.buildFollowUpReminder(
        [pendingTodo],
        [pendingTodo],
      );
      expect(result).toBeDefined();
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

  describe('readTodoSnapshot', () => {
    it('reads todos from the store using config session id', async () => {
      todoStoreReadMock.mockResolvedValue([pendingTodo]);
      const result = await service.readTodoSnapshot();
      expect(result).toEqual([pendingTodo]);
      expect(mockTodoStoreConstructor).toHaveBeenCalledWith(
        'test-session',
        expect.anything(),
      );
    });

    it('returns empty array on error', async () => {
      todoStoreReadMock.mockRejectedValue(new Error('disk error'));
      const result = await service.readTodoSnapshot();
      expect(result).toEqual([]);
    });
  });
});
