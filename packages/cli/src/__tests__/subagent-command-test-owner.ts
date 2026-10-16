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
  const agent = context.services.agent;
  const config = context.services.config;
  return createSubagentCommand(
    bindSubagentCommand(
      manager,
      manager,
      async () => context.services.profileManager?.listProfiles() ?? [],
      () => context.services.settings.merged.enableFuzzyFiltering !== false,
      bindAutoPromptOperation(
        agent?.getProvider.bind(agent) ?? unavailableSession,
        () => agent?.agentClient,
        agent?.sessionClient.createDetachedAgentClient.bind(
          agent.sessionClient,
        ) ?? unavailableSession,
        () => config?.getContentGeneratorConfig(),
      ),
      context.services.config !== null,
      context.ui.addItem,
    ),
  );
}

function unavailableSession(): never {
  throw new Error('Session agent is unavailable');
}
