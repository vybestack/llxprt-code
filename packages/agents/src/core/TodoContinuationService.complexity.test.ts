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
      expect(
        arr.some((p): boolean => p.text?.includes('TODO List') === true),
      ).toBe(true);
    });

    it('does not duplicate suffix if already present', () => {
      const req = [
        { text: 'Do something' },
        { text: 'Use TODO List to organize this effort.' },
      ];
      const result = service.appendTodoSuffixToRequest(req);
      const arr = result as Array<{ text?: string }>;
      const suffixCount = arr.filter(
        (p): boolean =>
          p.text?.includes('Use TODO List to organize this effort.') === true,
      ).length;
      expect(suffixCount).toBe(1);
    });

    it('normalizes string request to Part array and appends suffix', () => {
      const req = 'plain string request';
      const result = service.appendTodoSuffixToRequest(req);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr[0]).toStrictEqual({ text: 'plain string request' });
      expect(
        arr.some((p): boolean => p.text?.includes('TODO List') === true),
      ).toBe(true);
    });

    it('normalizes singular {text} object and appends suffix', () => {
      const req = { text: 'do this task' };
      const result = service.appendTodoSuffixToRequest(req);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as Array<{ text?: string }>;
      expect(arr[0]).toStrictEqual({ text: 'do this task' });
      expect(
        arr.some((p): boolean => p.text?.includes('TODO List') === true),
      ).toBe(true);
    });

    it('does not mutate the original array', () => {
      const req = [{ text: 'Do something' }];
      const original = [...req];
      service.appendTodoSuffixToRequest(req);
      expect(req).toStrictEqual(original);
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
});
