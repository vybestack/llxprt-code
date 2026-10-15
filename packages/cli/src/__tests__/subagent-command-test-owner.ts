/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import type { SlashCommand } from '../ui/commands/types.js';
import { createSubagentCommand } from '../ui/commands/subagentCommand.js';
import {
  bindSubagentCommand,
  bindAutoPromptOperation,
} from '../ui/commands/subagentCommandHost.js';

export function registerSubagentCommand(
  context: CommandOwnerFixture,
): SlashCommand {
  const manager = context.services.subagentManager;
  return createSubagentCommand(
    bindSubagentCommand(
      manager,
      manager,
      async () => context.services.profileManager?.listProfiles() ?? [],
      () => context.services.settings.merged.enableFuzzyFiltering !== false,
      bindAutoPromptOperation(context.services.agent, context.services.config),
      context.services.config !== null,
      context.ui.addItem,
    ),
  );
}
