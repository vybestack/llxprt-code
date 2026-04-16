/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenDialogActionReturn, SlashCommand } from './types.js';
import { CommandKind } from './types.js';

export const settingsCommand: SlashCommand = {
  name: 'settings',
  description: 'View and edit LLxprt Code settings',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (_context, _args): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'settings',
  }),
};
