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

/**
 * The operations /baseurl needs from its owning session. The host binds them
 * once at registration; the command never reads them from an invocation.
 */
export interface BaseurlCommandOperations {
  /** Name of the provider whose endpoint is being changed. */
  readonly activeProviderName: () => string;
  /** Applies a trimmed base URL (empty clears it) and returns the report. */
  readonly updateBaseUrl: (baseUrl: string) => Promise<string>;
}

export function createBaseurlCommand(
  operations: BaseurlCommandOperations,
): SlashCommand {
  return {
    name: 'baseurl',
    description: 'set base URL for the current provider',
    kind: CommandKind.BUILT_IN,
    action: async (
      _context: CommandContext,
      args: string,
    ): Promise<MessageActionReturn> => {
      const baseUrl = args.trim();
      try {
        return {
          type: 'message',
          messageType: 'info',
          content: await operations.updateBaseUrl(baseUrl),
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to update base URL for provider '${operations.activeProviderName()}': ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
