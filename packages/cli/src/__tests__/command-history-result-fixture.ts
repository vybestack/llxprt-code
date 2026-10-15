/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'bun:test';
import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
} from '../ui/commands/types.js';
import { bindCommandHistoryLoader } from '../ui/hooks/commandHistoryLoaderHost.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';

export function bindFixtureHistoryLoader(context: CommandContext) {
  const agent = context.services.agent;
  const config = context.services.config;
  return bindCommandHistoryLoader(
    async (history) => {
      if (!agent) throw new Error('Missing fixture agent');
      await agent.setHistory(history);
    },
    () => resolveEmojiFilterMode(config),
    context.ui.clear,
    context.ui.addItem,
  );
}

export function createCommands(
  action: SlashCommand['action'],
): readonly SlashCommand[] {
  return [
    {
      name: 'help',
      description: 'Show help',
      kind: CommandKind.BUILT_IN,
      action:
        action ??
        vi.fn(() => ({
          type: 'message' as const,
          messageType: 'info' as const,
          content: 'ok',
        })),
    },
  ];
}
