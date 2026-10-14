/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSkillsCommand } from '../ui/commands/skillsCommand.js';
import { bindSkillsCommand } from '../ui/commands/skillsCommandHost.js';
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';
export function registerSkillsCommand(owner: CommandContext): SlashCommand {
  return createSkillsCommand(
    bindSkillsCommand(
      owner.services.config?.skillOperations,
      owner.services.config !== null,
      owner.services.settings,
      owner.ui.addItem,
      owner.ui.setPendingItem,
    ),
  );
}
