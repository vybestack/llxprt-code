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

import { describe, it, expect } from 'bun:test';
import { TodoPauseTool, TodoReadTool, TodoWriteTool } from '../index.js';
import type { ITodoService, TodoStore } from '../interfaces/index.js';
import type { Todo } from '../types/todo-schemas.js';
import type { ToolContext } from '../types/tool-context.js';
import { todoEvents, type TodoUpdateEvent } from '../tools/todo-events.js';

/**
 * Fake ITodoService with controllable todo state.
 * Infrastructure fake — returns real todo items for observable assertions.
 */
function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

function createFakeTodoService(initialTodos: Todo[] = []): ITodoService {
  let todos = [...initialTodos];

  const store: TodoStore = {
    getTodos: () => todos,
    setTodos: (newTodos: Todo[]) => {
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
      setActiveTodo: (id: string | null) => {
        void id;
      },
      clearActiveTodo: () => {},
    }),
    getDefaultAgentId: () => 'test-agent',
  };
}

describe('Todo Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  it('rejects pause reasons exceeding 500 UTF-16 code units', () => {
    const tool = new TodoPauseTool(createFakeTodoService());
    expect(() => tool.build({ reason: '😀'.repeat(251) })).toThrow('500');
    expect(() => tool.build({ reason: '😀'.repeat(250) })).not.toThrow();
  });
  describe('Todo invocation context isolation', () => {
    it('keeps built reads scoped to the original session after the tool is reused', async () => {
      const service: ITodoService = {
        ...createFakeTodoService(),
        getTodoStore: (context) => ({
          getTodos: () => [
            {
              id: '1',
              content: context?.sessionId ?? 'default',
              status: 'pending',
            },
          ],
        }),
      };
      const tool = new TodoReadTool(service);
      tool.context = { sessionId: 'first-session' };
      const first = tool.build({});
      tool.context = { sessionId: 'second-session' };
      const second = tool.build({});

      expect(
        (await first.execute(new AbortController().signal)).llmContent,
      ).toContain('first-session');
      expect(
        (await second.execute(new AbortController().signal)).llmContent,
      ).toContain('second-session');
    });
  });
  describe('TodoWrite writes and TodoRead returns items (observable round-trip)', () => {
    it('after writing todos, subsequent read returns the written items', async () => {
      const service = createFakeTodoService();
      const writtenTodos: Todo[] = [
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'in_progress' },
      ];

      const writeResult = await new TodoWriteTool(
        service,
      ).validateBuildAndExecute(
        { todos: writtenTodos },
        new AbortController().signal,
      );
      expect(writeResult.error).toBeUndefined();
      expect(writeResult.llmContent).toContain('Task 1');

      const readResult = await new TodoReadTool(
        service,
      ).validateBuildAndExecute({}, new AbortController().signal);
      expect(readResult.error).toBeUndefined();
      expect(readResult.llmContent).toContain('Task 1');
      expect(readResult.llmContent).toContain('Task 2');
    });

    it('after writing multiple batches, read reflects the latest state', async () => {
      const service = createFakeTodoService();

      await new TodoWriteTool(service).validateBuildAndExecute(
        {
          todos: [{ id: '1', content: 'First batch' }],
        },
        new AbortController().signal,
      );
      await new TodoWriteTool(service).validateBuildAndExecute(
        {
          todos: [
            { id: '2', content: 'Second batch item 1' },
            { id: '3', content: 'Second batch item 2' },
          ],
        },
        new AbortController().signal,
      );

      const readResult = await new TodoReadTool(
        service,
      ).validateBuildAndExecute({}, new AbortController().signal);
      expect(readResult.error).toBeUndefined();
      expect(readResult.llmContent).toContain('Second batch item 1');
      expect(readResult.llmContent).not.toContain('First batch');
    });
  });

  describe('TodoPause pauses continuation with observable behavioral effect', () => {
    it('after pause, read result reflects paused state', async () => {
      const service = createFakeTodoService();
      await new TodoWriteTool(service).validateBuildAndExecute(
        {
          todos: [{ id: '1', content: 'Task 1' }],
        },
        new AbortController().signal,
      );

      const result = await new TodoPauseTool(service).validateBuildAndExecute(
        { reason: 'pause for review' },
        new AbortController().signal,
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('pause');
      const readResult = await new TodoReadTool(
        service,
      ).validateBuildAndExecute({}, new AbortController().signal);
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
      const reasonDescription = textOrEmpty(
        reasonSchema?.description,
      ).toLowerCase();
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
      expect(error?.toLowerCase()).toContain('500');
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

      const result = await new TodoReadTool(service).validateBuildAndExecute(
        {},
        new AbortController().signal,
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Write tests');
      expect(result.llmContent).toContain('in_progress');
    });
  });

  describe('ITodoService ToolContext propagation', () => {
    const observePassesSessionAndAgentContextToStoreAndTrackerServicesAt193 =
      async () => {
        const contexts: ToolContext[] = [];
        const activeTodoRef: { value: string | null } = { value: null };
        let todos: Todo[] = [];
        const store: TodoStore = {
          getTodos: () => todos,
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
                activeTodoRef.value = id;
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
        await writeTool.validateBuildAndExecute(
          {
            todos: [
              { id: 'active', content: 'Scoped work', status: 'in_progress' },
            ],
          },
          new AbortController().signal,
        );
        await readTool.validateBuildAndExecute(
          {},
          new AbortController().signal,
        );
        await pauseTool.validateBuildAndExecute(
          {
            reason: 'scope check',
          },
          new AbortController().signal,
        );
        return { contexts, activeTodoRef };
      };

    it('passes session and agent context to store and tracker services', async () => {
      const { contexts, activeTodoRef } =
        await observePassesSessionAndAgentContextToStoreAndTrackerServicesAt193();
      expect(contexts).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'session-42',
            agentId: 'agent-7',
          }),
        ]),
      );
      expect(contexts.length).toBeGreaterThanOrEqual(4);
      expect(activeTodoRef.value).toBe('active');
    });

    it('emits persisted todo replacements independently of presentation mode', async () => {
      let todos: Todo[] = [];
      const events: TodoUpdateEvent[] = [];
      const store: TodoStore = {
        getTodos: () => todos,
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
          interactiveMode: false,
        };

        await writeTool.validateBuildAndExecute(
          {
            todos: [
              { id: 'visible', content: 'Visible in panel', status: 'pending' },
            ],
          },
          new AbortController().signal,
        );
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
