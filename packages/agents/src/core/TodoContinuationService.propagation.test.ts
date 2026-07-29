/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral integration test: verifies that TodoContinuationService correctly
 * propagates on-disk task-list state through the real LocalTodoStore, the real
 * todoDataDirResolver, and a real TodoReminderService. No fs/store mocks — the
 * test writes real persisted state to a temp directory and asserts the OUTCOMES
 * (returned snapshots and reminder text) reflect that persisted state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { TodoContinuationService } from './TodoContinuationService.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { LocalTodoStore } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Todo } from '@vybestack/llxprt-code-tools';

const SESSION_ID = 'propagation-session';

function makeConfig(sessionId: string): Config {
  return {
    getSessionId: vi.fn().mockReturnValue(sessionId),
  } as unknown as Config;
}

describe('TodoContinuationService — resolver-propagation (real store/disk)', () => {
  let tempDir: string;
  let service: TodoContinuationService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'todo-continuation-propagation-'),
    );
    const reminderService = new TodoReminderService();
    service = new TodoContinuationService({
      config: makeConfig(SESSION_ID),
      todoReminderService: reminderService,
      complexitySuggestionCooldown: 300000,
      todoDataDirResolver: () => tempDir,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('readTodoSnapshot returns what was written to disk via the real store', async () => {
    const store = new LocalTodoStore(SESSION_ID, {
      dataDirResolver: () => tempDir,
    });
    const todos: Todo[] = [
      {
        id: 'prop-1',
        content: 'Propagation todo one',
        status: 'pending',
      },
      {
        id: 'prop-2',
        content: 'Propagation todo two',
        status: 'in_progress',
      },
    ];
    await store.writeTodos(todos);

    const snapshot = await service.readTodoSnapshot();

    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((t) => t.id)).toStrictEqual(['prop-1', 'prop-2']);
    expect(snapshot.map((t) => t.content)).toStrictEqual([
      'Propagation todo one',
      'Propagation todo two',
    ]);
  });

  it('getTodoReminderForCurrentState reflects persisted empty state with a create-list reminder', async () => {
    // No items written yet — empty list on disk.
    const result = await service.getTodoReminderForCurrentState();

    expect(result.todos).toStrictEqual([]);
    expect(result.activeTodos).toStrictEqual([]);
    // Empty list produces a create-list reminder.
    expect(result.reminder).not.toBeNull();
    expect(result.reminder).toContain(
      'Please create a todo list before continuing.',
    );
  });

  it('getTodoReminderForCurrentState produces an update reminder when active todos exist on disk', async () => {
    const store = new LocalTodoStore(SESSION_ID, {
      dataDirResolver: () => tempDir,
    });
    const activeTodo: Todo = {
      id: 'active-1',
      content: 'Active work item',
      status: 'in_progress',
    };
    await store.writeTodos([activeTodo]);

    const result = await service.getTodoReminderForCurrentState();

    expect(result.todos.map((t) => t.id)).toStrictEqual(['active-1']);
    // in_progress items are active.
    expect(result.activeTodos.map((t) => t.id)).toStrictEqual(['active-1']);
    expect(result.reminder).not.toBeNull();
    expect(result.reminder).toContain('Update the active todo');
  });

  it('writing new todos via the store changes the reminder outcome', async () => {
    // Initially empty: create-list reminder.
    const before = await service.getTodoReminderForCurrentState();
    expect(before.reminder).toContain(
      'Please create a todo list before continuing.',
    );

    // Now persist an active item and re-read.
    const store = new LocalTodoStore(SESSION_ID, {
      dataDirResolver: () => tempDir,
    });
    await store.writeTodos([
      {
        id: 'new-1',
        content: 'Newly persisted todo',
        status: 'pending',
      },
    ]);

    const after = await service.getTodoReminderForCurrentState();

    expect(after.todos.map((t) => t.id)).toStrictEqual(['new-1']);
    expect(after.activeTodos.map((t) => t.id)).toStrictEqual(['new-1']);
    // Reminder switched from create-list to update.
    expect(after.reminder).not.toBeNull();
    expect(after.reminder).toContain('Update the active todo');
  });
});
