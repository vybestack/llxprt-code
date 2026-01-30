/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, OpenDialogActionReturn, SlashCommand } from './types.js';
import { saveWelcomeConfig } from '../../config/welcomeConfig.js';

/**
 * The /setup command re-runs the welcome onboarding flow, allowing users
 * to reconfigure their provider, model, or authentication method without
 * manually editing config files.
 */
export const setupCommand: SlashCommand = {
  name: 'setup',
  description:
    're-run the welcome onboarding flow to configure provider and model',
  kind: CommandKind.BUILT_IN,
  action: (_context, _args): OpenDialogActionReturn => {
    // Reset the welcome config so the dialog will show
    saveWelcomeConfig({ welcomeCompleted: false });

    return {
      type: 'dialog',
      dialog: 'welcome',
    };
  },
};
