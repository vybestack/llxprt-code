/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { setActiveModel } from '../../runtime/runtimeSettings.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'select or switch model',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const modelName = args?.trim();

    // Always use provider model dialog if no model specified
    if (!modelName) {
      return {
        type: 'dialog',
        dialog: 'providerModel',
      };
    }

    // Switch model in provider
    try {
      const result = await setActiveModel(modelName);

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched from ${result.previousModel ?? 'unknown'} to ${result.nextModel} in provider '${result.providerName}'`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
