/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, OpenDialogActionReturn, SimpleMessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'select or switch model',
  action: async (
    context: CommandContext,
    args: string
  ): Promise<OpenDialogActionReturn | SimpleMessageActionReturn | void> => {
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
        activeProvider.setModel(modelName);
        // Keep config model in sync so /about shows correct model
        if (context.services.config) {
          context.services.config.setModel(modelName);
        }
        
        return {
          type: 'message',
          message: {
            type: MessageType.INFO,
            content: `Switched from ${currentModel} to ${modelName} in provider '${activeProvider.name}'`,
            timestamp: new Date(),
          },
        };
      } else {
        return {
          type: 'message',
          message: {
            type: MessageType.ERROR,
            content: `Provider '${activeProvider.name}' does not support model switching`,
            timestamp: new Date(),
          },
        };
      }
    } catch (error) {
      return {
        type: 'message',
        message: {
          type: MessageType.ERROR,
          content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        },
      };
    }
  },
};