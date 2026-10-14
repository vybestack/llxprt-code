/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createStatsCommand } from '../ui/commands/statsCommand.js';
import { bindStatsCommand } from '../ui/commands/statsCommandHost.js';
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';
export function registerStatsCommand(owner: CommandContext): SlashCommand {
  return createStatsCommand(
    bindStatsCommand(
      owner.runtimeApi,
      owner.oauthControl,
      () => owner.session.stats.sessionStartTime,
      owner.ui.addItem,
    ),
  );
}
