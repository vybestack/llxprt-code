/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, SlashCommand } from './types.js';
import { MessageType } from '../types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  altNames: ['?'],
  description: 'for help on LLxprt Code',
  kind: CommandKind.BUILT_IN,
  action: async (context) => {
    const helpItem = {
      type: MessageType.HELP,
      timestamp: new Date(),
    };

    context.ui.addItem(helpItem, Date.now());
  },
};
