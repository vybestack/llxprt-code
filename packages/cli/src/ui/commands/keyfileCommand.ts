/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, SimpleMessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { setProviderApiKeyFromFile } from '../../providers/providerConfigUtils.js';
import { MessageType } from '../types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';

export const keyfileCommand: SlashCommand = {
  name: 'keyfile',
  description: 'manage API key file for the current provider',
  action: async (
    context: CommandContext,
    args: string
  ): Promise<SimpleMessageActionReturn> => {
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
            message: {
              type: MessageType.INFO,
              content: `Current keyfile for provider '${providerName}': ${foundKeyfile}\nTo remove: /keyfile none\nTo change: /keyfile <new_path>`,
              timestamp: new Date(),
            },
          };
        } else {
          return {
            type: 'message',
            message: {
              type: MessageType.INFO,
              content: `No keyfile found for provider '${providerName}'\nTo set: /keyfile <path>`,
              timestamp: new Date(),
            },
          };
        }
      }

      // Handle removal
      if (filePath === 'none') {
        const removedPath = context.services.settings.getProviderKeyfile(providerName);
        if (removedPath) {
          context.services.settings.removeProviderKeyfile(providerName);
          return {
            type: 'message',
            message: {
              type: MessageType.INFO,
              content: `Removed keyfile path for provider '${providerName}'`,
              timestamp: new Date(),
            },
          };
        } else {
          return {
            type: 'message',
            message: {
              type: MessageType.INFO,
              content: `No keyfile path was set for provider '${providerName}'`,
              timestamp: new Date(),
            },
          };
        }
      }

      // Set new keyfile path
      const result = await setProviderApiKeyFromFile(
        providerManager,
        context.services.settings,
        filePath,
        context.services.config ?? undefined,
      );

      // Trigger payment mode check if available and successful
      if (result.success) {
        const extendedContext = context as CommandContext & {
          checkPaymentModeChange?: () => void;
        };
        if (extendedContext.checkPaymentModeChange) {
          setTimeout(extendedContext.checkPaymentModeChange, 100);
        }
      }

      return {
        type: 'message',
        message: {
          type: result.success ? MessageType.INFO : MessageType.ERROR,
          content: result.message,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        type: 'message',
        message: {
          type: MessageType.ERROR,
          content: `Failed to manage keyfile: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        },
      };
    }
  },
};