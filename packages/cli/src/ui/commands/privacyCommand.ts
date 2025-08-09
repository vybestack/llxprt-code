/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
} from './types.js';

/**
 * Privacy command - shows Google's privacy disclosure for the Gemini API
 */
export const privacyCommand: SlashCommand = {
  name: 'privacy',
  description: 'view Gemini API privacy disclosure and terms',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
  ): Promise<OpenDialogActionReturn> => ({
    type: 'dialog',
    dialog: 'privacy',
  }),
};
