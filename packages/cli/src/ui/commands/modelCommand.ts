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
import { getProviderManager } from '../../providers/providerManagerInstance.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'select or switch model',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const modelName = args?.trim();
    const providerManager = getProviderManager();

    // Always use provider model dialog if no model specified
    if (!modelName) {
      return {
        type: 'dialog',
        dialog: 'providerModel',
      };
    }

    // Switch model in provider
    try {
      const activeProvider = providerManager.getActiveProvider();
      const currentModel = activeProvider.getCurrentModel
        ? activeProvider.getCurrentModel()
        : 'unknown';

      if (activeProvider.setModel) {
        const config = context.services.config;
        const settingsService = config?.getSettingsService();
        const useSettingsService = settingsService !== null;

        activeProvider.setModel(modelName);

        if (useSettingsService && settingsService && config) {
          // Use SettingsService to update provider settings
          try {
            // Ensure activeProvider is set in SettingsService
            settingsService.set('activeProvider', activeProvider.name);
            await settingsService.updateSettings(activeProvider.name, {
              model: modelName,
            });
          } catch (error) {
            console.error('SettingsService error, using fallback:', error);
            // Keep config model in sync so /about shows correct model
            config.setModel(modelName);
          }
        } else if (config) {
          // Fallback to direct config update
          config.setModel(modelName);
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `Switched from ${currentModel} to ${modelName} in provider '${activeProvider.name}'`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'error',
          content: `Provider '${activeProvider.name}' does not support model switching`,
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
