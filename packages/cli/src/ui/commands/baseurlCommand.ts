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
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const baseurlCommand: SlashCommand = {
  name: 'baseurl',
  description: 'set base URL for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const baseUrl = args?.trim();
    const runtime = getRuntimeApi();
    try {
      const result = await runtime.updateActiveProviderBaseUrl(baseUrl ?? null);
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
