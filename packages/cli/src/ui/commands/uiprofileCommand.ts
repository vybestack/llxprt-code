/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../../utils/installationInfo.js';
import { CommandKind, type SlashCommand } from './types.js';

export function createUiProfileCommand(
  toggleDebugProfiler: () => void,
): SlashCommand | null {
  return isDevelopment
    ? {
        name: 'uiprofile',
        kind: CommandKind.BUILT_IN,
        description: 'Toggle the UI render profiler display',
        action: async () => {
          toggleDebugProfiler();
          return {
            type: 'message',
            messageType: 'info',
            content: 'Toggled UI render profiler display.',
          };
        },
      }
    : null;
}
