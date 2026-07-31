/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type CommandContext,
  type MessageActionReturn,
  type OpenDialogActionReturn,
  type SlashCommand,
} from './types.js';

export const policiesCommand: SlashCommand = {
  name: 'policies',
  description: 'open the policy manager dialog to inspect and edit rules',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (
    context: CommandContext,
  ): OpenDialogActionReturn | MessageActionReturn => {
    const agent = context.services.agent;
    const config = context.services.config;
    if (!agent && !config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      };
    }
    return {
      type: 'dialog',
      dialog: 'policies',
    };
  },
};
