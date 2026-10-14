/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HooksCommandOperations } from './hooksCommand.js';
import type { TaskCommandOperations } from './tasksCommand.js';

export function bindHooksCommand(
  agent: Agent | null,
  isConfigured: boolean,
): HooksCommandOperations {
  return {
    isConfigured,
    isAvailable: agent !== null,
    listHooks: () => agent?.hooks.listHooks() ?? [],
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
  };
}

export function bindTaskCommand(
  agent: Agent | null,
): TaskCommandOperations | null {
  if (agent === null) return null;
  return {
    list: () => agent.tasks.list(),
    listRunning: () => agent.tasks.listRunning(),
    get: (id) => agent.tasks.get(id),
    cancel: (id) => agent.tasks.cancel(id),
  };
}
