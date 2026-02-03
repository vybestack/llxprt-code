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

export const statusCommand: SlashCommand = {
  name: 'status',
  description: 'show authentication status for all providers',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn> => {
    try {
      const oauthManager = getRuntimeApi().getCliOAuthManager();
      if (!oauthManager) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'OAuth manager not available. Please try again.',
        };
      }

      // Get authentication status for all providers
      const statuses = await oauthManager.getAuthStatus();

      if (statuses.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No OAuth providers are registered.',
        };
      }

      // Format status display
      let statusMessage = 'Authentication Status:\n';
      statusMessage += '─'.repeat(50) + '\n';

      for (const status of statuses) {
        const indicator = status.authenticated ? '✓' : '✗';
        let line = `${indicator} ${status.provider}: `;

        if (status.authenticated) {
          line += 'authenticated';
          if (status.expiresIn && status.expiresIn > 0) {
            const hours = Math.floor(status.expiresIn / 3600);
            const minutes = Math.floor((status.expiresIn % 3600) / 60);
            line += ` - expires in ${hours}h ${minutes}m`;
          }
        } else {
          line += 'not authenticated';
        }

        if (status.oauthEnabled !== undefined) {
          line += ` [OAuth ${status.oauthEnabled ? 'enabled' : 'disabled'}]`;
        }

        statusMessage += line + '\n';
      }

      statusMessage += '\nUse /auth <provider> to configure OAuth settings';
      statusMessage += '\nUse /logout <provider> to sign out';

      return {
        type: 'message',
        messageType: 'info',
        content: statusMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to get authentication status: ${errorMessage}`,
      };
    }
  },
};
