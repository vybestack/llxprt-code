/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeCommandOutput } from '../hooks/command-journal-output.js';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType, type HistoryItemHelp } from '../types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  altNames: ['?'],
  description: 'for help on LLxprt Code',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const helpItem: HistoryItemHelp = {
      type: MessageType.HELP,
      timestamp: new Date(),
    };

    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      helpItem,
    );
  },
};
