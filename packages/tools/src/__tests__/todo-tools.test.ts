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
import { todoEvents, type TodoUpdateEvent } from '../tools/todo-events.js';
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

  return {
    getTodoStore: () => store,
    getReminderService: () => ({
      shouldGenerateReminder: () => todos.length > 0,
      getReminderForStateChange: () => 'reminder text',
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

  describe('TodoPause schema and description disclose the 500-character reason cap (issue #2287)', () => {
    it('main tool description states reason is capped at 500 characters', () => {
      const tool = new TodoPauseTool(createFakeTodoService());
      const description: string = tool.description;
      expect(description.toLowerCase()).toContain('500');
      expect(description.toLowerCase()).toMatch(/character/);
    });

    it('reason schema description states the 500-character limit and instructs streaming longer text separately', () => {
      const tool = new TodoPauseTool(createFakeTodoService());
      const schema = tool.schema as unknown as {
        parametersJsonSchema?: {
          properties?: {
            reason?: { description?: string; maxLength?: number };
          };
        };
      };
      const reasonSchema = schema.parametersJsonSchema?.properties?.reason;
      expect(reasonSchema).toBeDefined();
      expect(reasonSchema?.maxLength).toBe(500);
      const reasonDescription = (reasonSchema?.description ?? '').toLowerCase();
      expect(reasonDescription).toContain('500');
      // The model must be told to stream any longer explanation as normal
      // response text, not stuff it into the tool argument.
      expect(reasonDescription).toMatch(/stream|response text|separately/);
    });

    it('rejects a reason longer than 500 characters with the explicit length guard', () => {
      const tool = new TodoPauseTool(createFakeTodoService());
      const longReason = 'a'.repeat(501);
      const error = tool.validateToolParams({ reason: longReason });
      expect(error).not.toBeNull();
      expect(error?.message.toLowerCase()).toContain('500');
    });

    it('accepts a reason of exactly 500 characters', () => {
      const tool = new TodoPauseTool(createFakeTodoService());
      const boundaryReason = 'a'.repeat(500);
      const error = tool.validateToolParams({ reason: boundaryReason });
      expect(error).toBeNull();
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

    it('emits interactive todo updates when a service context tracker is present', async () => {
      let todos: Array<Record<string, unknown>> = [];
      const events: TodoUpdateEvent[] = [];
      const store: TodoStore = {
        getTodos: () => todos as never[],
        setTodos: (newTodos) => {
          todos = [...newTodos];
        },
      };
      const service: ITodoService = {
        getTodoStore: () => store,
        getReminderService: () => ({
          shouldGenerateReminder: () => false,
        }),
        getContextTracker: () => ({
          setActiveTodo: () => {},
        }),
        getDefaultAgentId: () => 'default-agent',
      };
      const listener = (event: TodoUpdateEvent) => {
        events.push(event);
      };
      todoEvents.onTodoUpdated(listener);

      try {
        const writeTool = new TodoWriteTool(service);
        writeTool.context = {
          sessionId: 'session-42',
          agentId: 'agent-7',
          interactiveMode: true,
        };

        await executeToolForBehavioralAssertion(writeTool, {
          todos: [
            { id: 'visible', content: 'Visible in panel', status: 'pending' },
          ],
        });
      } finally {
        todoEvents.offTodoUpdated(listener);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sessionId: 'session-42',
        agentId: 'agent-7',
        todos: [
          { id: 'visible', content: 'Visible in panel', status: 'pending' },
        ],
      });
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
