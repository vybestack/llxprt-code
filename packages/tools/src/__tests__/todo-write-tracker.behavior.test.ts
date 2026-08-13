/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TodoWriteTool, TodoReadTool } from '../index.js';
import { TodoStore } from '../tools/todo-store.js';
import { TodoContextTracker } from '../utils/todoContextTracker.js';
import { TodoReminderService } from '../utils/todoReminderService.js';
import type { ITodoService } from '../interfaces/index.js';
import type { TodoToolCall } from '../types/todo-schemas.js';
import type { ToolContext } from '../types/tool-context.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

function makeToolCall(
  overrides: Partial<TodoToolCall> & { name: string },
): TodoToolCall {
  return {
    id: overrides.id ?? `call-${overrides.name}`,
    name: overrides.name,
    parameters: overrides.parameters ?? {},
    timestamp: overrides.timestamp ?? new Date('2025-01-01T00:00:00Z'),
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'todo-persist-behavior-'));
}

function makeDiskBackedService(
  store: TodoStore,
  sessionId: string,
  agentId: string,
): ITodoService {
  return {
    getTodoStore: () => store,
    getReminderService: () => new TodoReminderService(),
    getContextTracker: () => TodoContextTracker.forAgent(sessionId, agentId),
    getDefaultAgentId: () => agentId,
  };
}

describe('TodoWrite active-todo tracking through the real TodoContextTracker', () => {
  const sessionId = `tracker-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const agentId = `tracker-agent-${Math.random().toString(36).slice(2)}`;
  const tracker = TodoContextTracker.forAgent(sessionId, agentId);

  afterEach(() => {
    tracker.clearActiveTodo();
  });

  it('marks the in_progress todo as active via the ITodoService boundary', async () => {
    const service: ITodoService = {
      getTodoStore: () => ({ getTodos: () => [], setTodos: () => {} }),
      getReminderService: () => ({ shouldGenerateReminder: () => false }),
      getContextTracker: () => tracker,
      getDefaultAgentId: () => agentId,
    };
    const context: ToolContext = { sessionId, agentId, interactiveMode: true };
    const writeTool = new TodoWriteTool(service);
    writeTool.context = context;

    await executeToolForBehavioralAssertion(writeTool, {
      todos: [
        { id: 'done', content: 'Finished', status: 'completed' },
        { id: 'active', content: 'Working now', status: 'in_progress' },
      ],
    });

    expect(tracker.getActiveTodo()).toBe('active');
  });

  it('clears the active todo when no todo is in_progress', async () => {
    const service: ITodoService = {
      getTodoStore: () => ({ getTodos: () => [], setTodos: () => {} }),
      getReminderService: () => ({ shouldGenerateReminder: () => false }),
      getContextTracker: () => tracker,
      getDefaultAgentId: () => agentId,
    };
    const context: ToolContext = { sessionId, agentId, interactiveMode: true };
    const writeTool = new TodoWriteTool(service);
    writeTool.context = context;

    await executeToolForBehavioralAssertion(writeTool, {
      todos: [
        { id: 'a', content: 'First', status: 'completed' },
        { id: 'b', content: 'Second', status: 'completed' },
      ],
    });

    expect(tracker.getActiveTodo()).toBeNull();
  });
});

describe('TodoWrite then TodoRead round-trips persisted toolCalls through real disk storage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('survives serialization and reload for top-level and subtask toolCalls', async () => {
    const sessionId = `persist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const agentId = `persist-agent-${Math.random().toString(36).slice(2)}`;

    const writeStore = new TodoStore(sessionId, { dataDir: tempDir }, agentId);
    const writeService = makeDiskBackedService(writeStore, sessionId, agentId);
    const writeTool = new TodoWriteTool(writeService);
    writeTool.context = { sessionId, agentId, interactiveMode: false };

    const writeResult = await executeToolForBehavioralAssertion(writeTool, {
      todos: [
        {
          id: 't1',
          content: 'Investigate persistence',
          status: 'in_progress',
          toolCalls: [
            makeToolCall({
              id: 'top',
              name: 'read_file',
              parameters: { path: 'src/index.ts' },
            }),
          ],
          subtasks: [
            {
              id: 's1',
              content: 'Read config',
              toolCalls: [
                makeToolCall({
                  id: 'sub',
                  name: 'write_file',
                  parameters: { file_path: 'config.json' },
                }),
              ],
            },
          ],
        },
      ],
    });

    expect(writeResult.error).toBeUndefined();
    expect(writeResult.returnDisplay).toContain(
      "read_file(path: 'src/index.ts')",
    );
    expect(writeResult.returnDisplay).toContain(
      "write_file(file_path: 'config.json')",
    );

    const readStore = new TodoStore(sessionId, { dataDir: tempDir }, agentId);
    const readService = makeDiskBackedService(readStore, sessionId, agentId);
    const readTool = new TodoReadTool(readService);
    readTool.context = { sessionId, agentId };

    const readResult = await executeToolForBehavioralAssertion(readTool, {});
    expect(readResult.error).toBeUndefined();
    expect(readResult.llmContent).toContain("read_file(path: 'src/index.ts')");
    expect(readResult.llmContent).toContain(
      "write_file(file_path: 'config.json')",
    );

    const reloaded = await readStore.readTodos();
    expect(reloaded).toEqual([
      {
        id: 't1',
        content: 'Investigate persistence',
        status: 'in_progress',
        toolCalls: [
          makeToolCall({
            id: 'top',
            name: 'read_file',
            parameters: { path: 'src/index.ts' },
          }),
        ],
        subtasks: [
          {
            id: 's1',
            content: 'Read config',
            toolCalls: [
              makeToolCall({
                id: 'sub',
                name: 'write_file',
                parameters: { file_path: 'config.json' },
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('fails fast when persisted toolCall timestamps are malformed', async () => {
    const session = `malformed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const todoDir = path.join(tempDir, 'todos');
    fs.mkdirSync(todoDir, { recursive: true });
    const persisted = {
      id: 'bad',
      content: 'corrupt entry',
      status: 'pending',
      toolCalls: [
        {
          id: 'c',
          name: 'read_file',
          parameters: {},
          timestamp: 'not-a-valid-date',
        },
      ],
    };
    fs.writeFileSync(
      path.join(todoDir, `todo-${session}.json`),
      JSON.stringify({ todos: [persisted], paused: false }),
    );

    const store = new TodoStore(session, { dataDir: tempDir });
    await expect(store.readTodos()).rejects.toThrow(/timestamp/i);
  });
});
