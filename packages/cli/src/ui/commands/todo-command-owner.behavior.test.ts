/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Todo } from '@vybestack/llxprt-code-core';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createTodoCommand } from './todoCommand.js';

describe('registered todo command owner', () => {
  it('updates its registered list without changing the invocation list', async () => {
    let todos: Todo[] = [
      { id: 'owner', content: 'Registered task', status: 'pending' },
    ];
    const decoy: Todo[] = [
      { id: 'decoy', content: 'Invocation task', status: 'pending' },
    ];
    const command = createTodoCommand(
      {
        readTodos: () => todos,
        updateTodos: (value) => {
          todos = value;
        },
      },
      () => 0,
    );
    const service = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), todoCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const registered = service
      .getCommands()
      .find((entry) => entry.name === 'todo');
    const clear = registered?.subCommands?.find(
      (entry) => entry.name === 'clear',
    );
    if (!clear?.action) throw new Error('Todo clear unavailable');
    await clear.action(
      createMockCommandContext({
        todoContext: {
          todos: decoy,
          updateTodos: () => {
            throw new Error('Invocation todo write');
          },
        },
      }),
      '',
    );
    expect(todos).toStrictEqual([]);
    expect(decoy).toHaveLength(1);
  });
});
