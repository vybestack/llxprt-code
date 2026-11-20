/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType, type HistoryItemHelp } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

export function createHelpCommand(
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return {
    name: 'help',
    altNames: ['?'],
    description: 'for help on LLxprt Code',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      const helpItem: Omit<HistoryItemHelp, 'id'> = {
        type: MessageType.HELP,
        timestamp: new Date(),
      };

      addItem(helpItem);
    },
  };
}
