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

export type LogoutOutcome =
  | { readonly kind: 'unknown-provider'; readonly message: string }
  | { readonly kind: 'logged-out'; readonly wasAuthenticated: boolean };

/**
 * The credential operation /logout needs from its owning session. The host
 * decides how a provider is validated and signed out of.
 */
export interface LogoutCommandOperations {
  readonly logout: (provider: string) => Promise<LogoutOutcome>;
}

export function createLogoutCommand(
  operations: LogoutCommandOperations,
): SlashCommand {
  return {
    name: 'logout',
    description:
      'logout from OAuth authentication for a provider (gemini, claudecode, codex)',
    kind: CommandKind.BUILT_IN,
    action: async (
      _context: CommandContext,
      args: string,
    ): Promise<MessageActionReturn> => {
      const provider = args.trim();
      if (!provider) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Please specify a provider to logout from: /logout <provider>\nSupported providers: gemini, claudecode, codex',
        };
      }
      try {
        const outcome = await operations.logout(provider);
        if (outcome.kind === 'unknown-provider') {
          return {
            type: 'message',
            messageType: 'error',
            content: outcome.message,
          };
        }
        return {
          type: 'message',
          messageType: 'info',
          content: outcome.wasAuthenticated
            ? `Successfully logged out of ${provider}`
            : `Cleaned up authentication state for ${provider} (was not authenticated)`,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to logout from ${provider}: ${errorMessage}`,
        };
      }
    },
  };
}
