/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateAutoPrompt } from '../ui/utils/autoPromptGenerator.js';
import type { CommandOwnerFixture } from './mockCommandContext.js';

import type { SlashCommand } from '../ui/commands/types.js';
import { createSubagentCommand } from '../ui/commands/subagentCommand.js';
import { bindSubagentCommand } from '../ui/commands/subagentCommandHost.js';

export function registerSubagentCommand(
  context: CommandOwnerFixture,
): SlashCommand {
  const manager = context.services.subagentManager;
  const agent = context.services.agent;
  return createSubagentCommand(
    bindSubagentCommand(
      manager,
      manager,
      async () => context.services.profileManager?.listProfiles() ?? [],
      () => context.services.settings.merged.enableFuzzyFiltering !== false,
      (description) =>
        generateAutoPrompt(
          description,
          agent?.generate.bind(agent) ?? unavailableSession,
        ),
      context.services.config !== null,
      context.ui.addItem,
    ),
  );
}

function unavailableSession(): never {
  throw new Error('Session agent is unavailable');
}
