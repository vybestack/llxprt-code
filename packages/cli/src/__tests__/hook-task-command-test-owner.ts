/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import { createHooksCommand } from '../ui/commands/hooksCommand.js';
import { createTaskCommand } from '../ui/commands/tasksCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';

export function registerHooksCommand(owner: CommandOwnerFixture): SlashCommand {
  const agent = owner.services.agent;
  return createHooksCommand(
    {
      listHooks: () => agent?.hooks.listHooks() ?? [],
      isConfigured: owner.services.config !== null,
      isAvailable: agent !== null,
      enable: (name) => {
        if (agent === null) throw new Error('Hook owner unavailable');
        agent.hooks.enable(name);
      },
      disable: (name) => {
        if (agent === null) throw new Error('Hook owner unavailable');
        agent.hooks.disable(name);
      },
      setDisabledHooks: (names) => {
        if (agent === null) throw new Error('Hook owner unavailable');
        agent.hooks.setDisabledHooks(names);
      },
    },
    owner.ui.addItem,
  );
}

export function registerTaskCommand(owner: CommandOwnerFixture): SlashCommand {
  const agent = owner.services.agent;
  return createTaskCommand(
    agent === null
      ? null
      : {
          list: () => agent.tasks.list(),
          listRunning: () => agent.tasks.listRunning(),
          get: (id) => agent.tasks.get(id),
          cancel: (id) => agent.tasks.cancel(id),
        },
    owner.ui.addItem,
  );
}
