/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const baseurlCommand: SlashCommand = {
  name: 'baseurl',
  description: 'set base URL for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const baseUrl = args.trim();
    const agent = context.services.agent;

    if (agent) {
      const provider = agent.getProvider();
      try {
        await agent.auth.setBaseUrl(baseUrl || null);
        return {
          type: 'message',
          messageType: 'info',
          content: baseUrl
            ? `Base URL set to '${baseUrl}' for provider '${provider}'`
            : `Base URL cleared for provider '${provider}'`,
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to update base URL for provider '${provider}': ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Fallback: Runtime API (tracked migration debt for null agent)
    const runtime = getRuntimeApi();
    try {
      const result = await runtime.updateActiveProviderBaseUrl(baseUrl);
      return {
        type: 'message',
        messageType: 'info',
        content: result.message,
      };
    } catch (error) {
      const status = runtime.getActiveProviderStatus();
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to update base URL for provider '${status.providerName ?? 'unknown'}': ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
