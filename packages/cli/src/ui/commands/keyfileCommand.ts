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
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';

export const keyfileCommand: SlashCommand = {
  name: 'keyfile',
  description: 'manage API key file for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const providerManager = getProviderManager();
    const filePath = args?.trim();

    try {
      const activeProvider = providerManager.getActiveProvider();
      const providerName = activeProvider.name;

      // If no path provided, check for existing keyfile
      if (!filePath || filePath === '') {
        // Check common keyfile locations
        const keyfilePaths = [
          path.join(homedir(), `.${providerName}_key`),
          path.join(homedir(), `.${providerName}-key`),
          path.join(homedir(), `.${providerName}_api_key`),
        ];

        // For specific providers, check their known keyfile locations
        if (providerName === 'openai') {
          keyfilePaths.unshift(path.join(homedir(), '.openai_key'));
        } else if (providerName === 'anthropic') {
          keyfilePaths.unshift(path.join(homedir(), '.anthropic_key'));
        }

        let foundKeyfile: string | null = null;
        for (const keyfilePath of keyfilePaths) {
          try {
            await fs.access(keyfilePath);
            foundKeyfile = keyfilePath;
            break;
          } catch {
            // File doesn't exist, continue checking
          }
        }

        if (foundKeyfile) {
          return {
            type: 'message',
            messageType: 'info',
            content: `Current keyfile for provider '${providerName}': ${foundKeyfile}\nTo remove: /keyfile none\nTo change: /keyfile <new_path>`,
          };
        } else {
          return {
            type: 'message',
            messageType: 'info',
            content: `No keyfile found for provider '${providerName}'\nTo set: /keyfile <path>`,
          };
        }
      }

      // Handle removal
      if (filePath === 'none') {
        const removedPath =
          context.services.settings.getProviderKeyfile(providerName);

        // Clear authentication using the provider's method (which now stores in SettingsService)
        if (
          'clearAuth' in activeProvider &&
          typeof activeProvider.clearAuth === 'function'
        ) {
          activeProvider.clearAuth();
        } else if (activeProvider.setApiKey) {
          // Fallback to clearing just the API key if clearAuth is not available
          activeProvider.setApiKey('');
        } else {
          return {
            type: 'message',
            messageType: 'error',
            content: `Provider '${providerName}' does not support keyfile commands`,
          };
        }

        // Remove from saved settings
        if (removedPath) {
          context.services.settings.removeProviderKeyfile(providerName);
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `Cleared keyfile and API key for provider '${providerName}'`,
        };
      }

      // Verify keyfile exists and read the key
      try {
        const resolvedPath = filePath.replace(/^~/, homedir());

        // Check if file exists
        await fs.access(resolvedPath);

        // Verify the file is not empty
        const apiKey = (await fs.readFile(resolvedPath, 'utf-8')).trim();
        if (!apiKey) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'The specified file is empty',
          };
        }

        // Get the active provider
        const activeProvider = providerManager.getActiveProvider();
        const providerName = activeProvider.name;

        // Set the API key directly on the provider
        if (activeProvider.setApiKey) {
          activeProvider.setApiKey(apiKey);
        } else {
          return {
            type: 'message',
            messageType: 'error',
            content: `Provider '${providerName}' does not support API key authentication`,
          };
        }

        // Store the keyfile PATH in ephemeral settings for reference
        // This helps track that we're using a keyfile vs direct key
        if (context.services.config) {
          context.services.config.setEphemeralSetting(
            'auth-keyfile',
            resolvedPath,
          );
          // Don't clear auth-key - we just set it via setApiKey above!
          // The auth-key will be used immediately, and auth-keyfile is stored
          // for future reference (e.g., when reloading profiles)
        }

        // Check if we're now in paid mode
        const isPaidMode = activeProvider.isPaidMode?.() ?? true;
        const paymentWarning = isPaidMode
          ? '\nWARNING: You are now in PAID MODE - API usage will be charged to your account'
          : '';

        // Trigger payment mode check if available
        const extendedContext = context as CommandContext & {
          checkPaymentModeChange?: () => void;
        };
        if (extendedContext.checkPaymentModeChange) {
          setTimeout(extendedContext.checkPaymentModeChange, 100);
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `API key loaded from ${resolvedPath} for provider '${providerName}'${paymentWarning}`,
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to manage keyfile: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to access provider: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
