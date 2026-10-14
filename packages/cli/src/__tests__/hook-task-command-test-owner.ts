/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHooksCommand } from '../ui/commands/hooksCommand.js';
import { createTaskCommand } from '../ui/commands/tasksCommand.js';
import {
  bindHooksCommand,
  bindTaskCommand,
} from '../ui/commands/hookTaskCommandHost.js';
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';

export function registerHooksCommand(owner: CommandContext): SlashCommand {
  return createHooksCommand(
    bindHooksCommand(owner.services.agent, owner.services.config !== null),
    owner.ui.addItem,
  );
}

export function registerTaskCommand(owner: CommandContext): SlashCommand {
  return createTaskCommand(
    bindTaskCommand(owner.services.agent),
    owner.ui.addItem,
  );
}
