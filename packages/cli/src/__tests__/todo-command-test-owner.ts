/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import { createTodoCommand } from '../ui/commands/todoCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';
export function registerTodoCommand(owner: CommandOwnerFixture): SlashCommand {
  const todos = owner.todoContext;
  return createTodoCommand(
    todos
      ? {
          readTodos: () => todos.todos,
          updateTodos: (value) => todos.updateTodos(value),
        }
      : null,
    owner.ui.addItem,
  );
}
