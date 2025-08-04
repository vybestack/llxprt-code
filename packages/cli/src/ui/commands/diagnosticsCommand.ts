/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';

/**
 * Masks sensitive information like API keys
 */
function maskSensitive(value: string): string {
  if (value.length < 8) {
    return '*'.repeat(value.length);
  }
  return (
    value.substring(0, 4) +
    '*'.repeat(value.length - 8) +
    value.substring(value.length - 4)
  );
}

/**
 * Implementation for the /diagnostics command that shows current configuration and state
 */
export const diagnosticsCommand: SlashCommand = {
  name: 'diagnostics',
  description: 'show current configuration and diagnostic information',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<MessageActionReturn> => {
    try {
      const config = context.services.config;
      const settings = context.services.settings;

      if (!config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not available',
        };
      }

      const diagnostics: string[] = ['# LLxprt Diagnostics\n'];

      // Provider information
      const providerManager = config.getProviderManager();
      const activeProvider = providerManager?.getActiveProvider();
      diagnostics.push('## Provider Information');
      diagnostics.push(`- Active Provider: ${activeProvider?.name || 'none'}`);
      diagnostics.push(`- Current Model: ${config.getModel()}`);

      // Check for API key
      if (
        activeProvider &&
        'hasApiKey' in activeProvider &&
        typeof activeProvider.hasApiKey === 'function'
      ) {
        diagnostics.push(
          `- API Key: ${activeProvider.hasApiKey() ? 'Set' : 'Not set'}`,
        );
      }

      // Ephemeral settings
      const ephemeralSettings = config.getEphemeralSettings();
      diagnostics.push('\n## Ephemeral Settings');

      if (Object.keys(ephemeralSettings).length === 0) {
        diagnostics.push('- No ephemeral settings configured');
      } else {
        for (const [key, value] of Object.entries(ephemeralSettings)) {
          if (key === 'auth-key' && typeof value === 'string') {
            diagnostics.push(`- ${key}: ${maskSensitive(value)}`);
          } else if (key === 'auth-keyfile' && typeof value === 'string') {
            diagnostics.push(`- ${key}: ${value}`);
          } else {
            diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
          }
        }
      }

      // Model parameters
      diagnostics.push('\n## Model Parameters');
      if (
        activeProvider &&
        'getModelParams' in activeProvider &&
        typeof activeProvider.getModelParams === 'function'
      ) {
        const modelParams = activeProvider.getModelParams();
        if (modelParams && Object.keys(modelParams).length > 0) {
          for (const [key, value] of Object.entries(modelParams)) {
            diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
          }
        } else {
          diagnostics.push('- No model parameters configured');
        }
      } else {
        diagnostics.push('- Model parameters not available for this provider');
      }

      // System information
      diagnostics.push('\n## System Information');
      diagnostics.push(`- Platform: ${process.platform}`);
      diagnostics.push(`- Node Version: ${process.version}`);
      diagnostics.push(`- Working Directory: ${process.cwd()}`);
      diagnostics.push(
        `- Debug Mode: ${config.getDebugMode() ? 'Enabled' : 'Disabled'}`,
      );

      // Settings
      diagnostics.push('\n## Settings');
      const merged = settings.merged || {};
      diagnostics.push(`- Theme: ${merged.theme || 'default'}`);
      diagnostics.push(
        `- Selected Auth Type: ${merged.selectedAuthType || 'none'}`,
      );
      diagnostics.push(`- Default Profile: ${merged.defaultProfile || 'none'}`);
      diagnostics.push(`- Sandbox: ${merged.sandbox || 'disabled'}`);

      // Memory/Context
      diagnostics.push('\n## Memory/Context');
      const userMemory = config.getUserMemory();
      diagnostics.push(
        `- User Memory: ${userMemory ? `${userMemory.length} characters` : 'Not loaded'}`,
      );
      diagnostics.push(
        `- Context Files: ${config.getLlxprtMdFileCount() || 0} files`,
      );

      // Telemetry
      diagnostics.push('\n## Telemetry');
      diagnostics.push(
        `- Usage Statistics: ${merged.usageStatisticsEnabled ? 'Enabled' : 'Disabled'}`,
      );

      return {
        type: 'message',
        messageType: 'info',
        content: diagnostics.join('\n'),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to generate diagnostics: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
