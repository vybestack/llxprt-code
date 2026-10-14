/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';
import { createExtensionsCommand } from '../ui/commands/extensionsCommand.js';
import { bindExtensionsCommand } from '../ui/commands/extensionsCommandHost.js';

export function registerExtensionsCommand(
  context: CommandContext,
): SlashCommand {
  return createExtensionsCommand(
    bindExtensionsCommand(
      context.services.config,
      context.ui.addItem,
      context.ui.setPendingItem,
      context.ui.dispatchExtensionStateUpdate,
    ),
  );
}
