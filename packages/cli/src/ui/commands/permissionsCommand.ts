/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, OpenDialogActionReturn, SlashCommand } from './types.js';

export const permissionsCommand: SlashCommand = {
  name: 'permissions',
  description: 'manage folder trust settings',
  kind: CommandKind.BUILT_IN,
  action: (_context, _args): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'permissions',
  }),
};
