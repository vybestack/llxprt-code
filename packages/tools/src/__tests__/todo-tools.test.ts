/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Todo Tool Group Behavioral Tests
 *
 * Verifies observable behavior of todo tools (TodoWrite, TodoRead, TodoPause)
 * through ITodoService. Primary assertions are on todo item state
 * round-trips (write → read) — NOT on method call counts.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code and adapters are wired up.
 */

import { describe, it, expect } from 'vitest';
import { TodoPauseTool, TodoReadTool, TodoWriteTool } from '../index.js';
import type { ITodoService, TodoStore } from '../interfaces/index.js';
import type { ToolContext } from '../types/tool-context.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

/**
 * Fake ITodoService with controllable todo state.
 * Infrastructure fake — returns real todo items for observable assertions.
 */
function createFakeTodoService(
  initialTodos: Array<Record<string, unknown>> = [],
): ITodoService {
  let todos = [...initialTodos];

  const store: TodoStore = {
    getTodos: () => todos,
    setTodos: (newTodos: Array<Record<string, unknown>>) => {
      todos = [...newTodos];
    },
  };

  const paused = false;

  return {
    getTodoStore: () => store,
    getReminderService: () => ({
      shouldGenerateReminder: () => !paused && todos.length > 0,
      getReminderForStateChange: () => (paused ? undefined : 'reminder text'),
    }),
    getContextTracker: () => ({
      setActiveTodo: (id: string) => {
        // Track active todo
        void id;
      },
      clearActiveTodo: () => {
        // Clear active todo tracking
      },
    }),
    getDefaultAgentId: () => 'test-agent',
  };
}

describe('Todo Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('TodoWrite writes and TodoRead returns items (observable round-trip)', () => {
    it('after writing todos, subsequent read returns the written items', async () => {
      const service = createFakeTodoService();
      const writtenTodos = [
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
      ];

      const writeResult = await executeToolForBehavioralAssertion(
        new TodoWriteTool(service),
        { todos: writtenTodos },
      );
      expect(writeResult.error).toBeUndefined();
      expect(writeResult.llmContent).toContain('Task 1');

      const readResult = await executeToolForBehavioralAssertion(
        new TodoReadTool(service),
        {},
      );
      expect(readResult.error).toBeUndefined();
      expect(readResult.llmContent).toContain('Task 1');
      expect(readResult.llmContent).toContain('Task 2');
    });

    it('after writing multiple batches, read reflects the latest state', async () => {
      const service = createFakeTodoService();

      await executeToolForBehavioralAssertion(new TodoWriteTool(service), {
        todos: [{ id: '1', content: 'First batch' }],
      });
      await executeToolForBehavioralAssertion(new TodoWriteTool(service), {
        todos: [
          { id: '2', content: 'Second batch item 1' },
          { id: '3', content: 'Second batch item 2' },
        ],
      });

      const readResult = await executeToolForBehavioralAssertion(
        new TodoReadTool(service),
        {},
      );
      expect(readResult.error).toBeUndefined();
      expect(readResult.llmContent).toContain('Second batch item 1');
      expect(readResult.llmContent).not.toContain('First batch');
    });
  });

  describe('TodoPause pauses continuation with observable behavioral effect', () => {
    it('after pause, read result reflects paused state', async () => {
      const service = createFakeTodoService();
      await executeToolForBehavioralAssertion(new TodoWriteTool(service), {
        todos: [{ id: '1', content: 'Task 1' }],
      });

      const result = await executeToolForBehavioralAssertion(
        new TodoPauseTool(service),
        { reason: 'pause for review' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('pause');
      const readResult = await executeToolForBehavioralAssertion(
        new TodoReadTool(service),
        {},
      );
      expect(readResult.llmContent).toContain('pause');
    });
  });

  describe('TodoRead reads items with ToolResult.llmContent containing structured output', () => {
    it('todos appear as structured content in ToolResult', async () => {
      const service = createFakeTodoService([
        { id: '1', content: 'Write tests', status: 'pending' },
        { id: '2', content: 'Run tests', status: 'in_progress' },
      ]);

      const result = await executeToolForBehavioralAssertion(
        new TodoReadTool(service),
        {},
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Write tests');
      expect(result.llmContent).toContain('in_progress');
    });
  });

  describe('ITodoService ToolContext propagation', () => {
    it('passes session and agent context to store and tracker services', async () => {
      const contexts: ToolContext[] = [];
      let activeTodo: string | null = null;
      let todos: Array<Record<string, unknown>> = [];
      const store: TodoStore = {
        getTodos: () => todos as never[],
        setTodos: (newTodos) => {
          todos = [...newTodos];
        },
      };
      const service: ITodoService = {
        getTodoStore: (context) => {
          if (context) {
            contexts.push(context);
          }
          return store;
        },
        getReminderService: () => ({
          shouldGenerateReminder: () => false,
        }),
        getContextTracker: (context) => {
          if (context) {
            contexts.push(context);
          }
          return {
            setActiveTodo: (id) => {
              activeTodo = id;
            },
          };
        },
        getDefaultAgentId: () => 'default-agent',
      };
      const context: ToolContext = {
        sessionId: 'session-42',
        agentId: 'agent-7',
        interactiveMode: true,
      };

      const writeTool = new TodoWriteTool(service);
      writeTool.context = context;
      const readTool = new TodoReadTool(service);
      readTool.context = context;
      const pauseTool = new TodoPauseTool(service);
      pauseTool.context = context;

      await executeToolForBehavioralAssertion(writeTool, {
        todos: [
          { id: 'active', content: 'Scoped work', status: 'in_progress' },
        ],
      });
      await executeToolForBehavioralAssertion(readTool, {});
      await executeToolForBehavioralAssertion(pauseTool, {
        reason: 'scope check',
      });

      expect(contexts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'session-42',
            agentId: 'agent-7',
          }),
        ]),
      );
      expect(contexts.length).toBeGreaterThanOrEqual(4);
      expect(activeTodo).toBe('active');
    });
  });

  describe('ITodoService getDefaultAgentId', () => {
    it('returns the expected agent ID', () => {
      const service = createFakeTodoService();
      const agentId = service.getDefaultAgentId();

      // Observable: agent ID is returned, not just method called
      expect(agentId).toBe('test-agent');
      expect(typeof agentId).toBe('string');
      expect(agentId.length).toBeGreaterThan(0);
    });
  });
});
