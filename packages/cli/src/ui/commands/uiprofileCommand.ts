/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../../utils/installationInfo.js';
import { CommandKind, type SlashCommand } from './types.js';

export const uiprofileCommand: SlashCommand | null = isDevelopment
  ? {
      name: 'uiprofile',
      kind: CommandKind.BUILT_IN,
      description: 'Toggle the UI render profiler display',
      action: async (context) => {
        context.ui.toggleDebugProfiler();
        return {
          type: 'message',
          messageType: 'info',
          content: 'Toggled UI render profiler display.',
        };
      },
    }
  : null;
