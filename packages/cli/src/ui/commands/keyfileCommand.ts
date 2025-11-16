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
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const keyfileCommand: SlashCommand = {
  name: 'keyfile',
  description: 'manage API key file for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const filePath = args?.trim();
    const runtime = getRuntimeApi();
    const status = runtime.getActiveProviderStatus();
    const providerName = status.providerName;

    if (!providerName) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'No active provider available. Set a provider with /provider first.',
      };
    }

    try {
      if (!filePath || filePath === '') {
        const keyfilePaths = [
          path.join(homedir(), `.${providerName}_key`),
          path.join(homedir(), `.${providerName}-key`),
          path.join(homedir(), `.${providerName}_api_key`),
        ];

        if (providerName === 'openai') {
          keyfilePaths.unshift(path.join(homedir(), '.openai_key'));
        } else if (providerName === 'anthropic') {
          keyfilePaths.unshift(path.join(homedir(), '.anthropic_key'));
        }

        let foundKeyfile: string | null = null;
        for (const candidate of keyfilePaths) {
          try {
            await fs.access(candidate);
            foundKeyfile = candidate;
            break;
          } catch {
            // continue searching
          }
        }

        if (foundKeyfile) {
          return {
            type: 'message',
            messageType: 'info',
            content: `Current keyfile for provider '${providerName}': ${foundKeyfile}\nTo remove: /keyfile none\nTo change: /keyfile <new_path>`,
          };
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `No keyfile found for provider '${providerName}'\nTo set: /keyfile <path>`,
        };
      }

      if (filePath === 'none') {
        await runtime.updateActiveProviderApiKey(null);
        runtime.setEphemeralSetting('auth-keyfile', undefined);
        context.services.settings.removeProviderKeyfile?.(providerName);

        return {
          type: 'message',
          messageType: 'info',
          content: `Cleared keyfile and API key for provider '${providerName}'`,
        };
      }

      const resolvedPath = filePath.replace(/^~/, homedir());
      await fs.access(resolvedPath);
      const apiKey = (await fs.readFile(resolvedPath, 'utf-8')).trim();
      if (!apiKey) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'The specified file is empty',
        };
      }

      const result = await runtime.updateActiveProviderApiKey(apiKey);
      runtime.setEphemeralSetting('auth-keyfile', resolvedPath);
      runtime.setEphemeralSetting('auth-key', undefined);
      context.services.settings.setProviderKeyfile?.(
        providerName,
        resolvedPath,
      );

      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: () => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(extendedContext.checkPaymentModeChange, 100);
      }

      const paymentWarning = result.isPaidMode
        ? '\nWARNING: You are now in PAID MODE - API usage will be charged to your account'
        : '';

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
  },
};
