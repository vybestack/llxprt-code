/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, SlashCommand } from './types.js';
import { AuthType } from '@vybestack/llxprt-code-core';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

export const authCommand: SlashCommand = {
  name: 'auth',
  description: 'change the auth method',
  kind: CommandKind.BUILT_IN,
  action: async (context, args) => {
    const authMode = args?.split(' ')[0];
    const providerManager = getProviderManager();

    // If no auth mode specified, open the dialog
    if (!authMode) {
      return {
        type: 'dialog',
        dialog: 'auth',
      };
    }

    // Handle specific auth mode changes for Gemini provider
    try {
      const activeProvider = providerManager.getActiveProvider();

      // Check if this is the Gemini provider
      if (activeProvider.name === 'gemini' && context.services.config) {
        const validModes = ['oauth', 'api-key', 'vertex'];

        if (!validModes.includes(authMode)) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Invalid auth mode. Valid modes: ${validModes.join(', ')}`,
          };
        }

        // Map the auth mode to the appropriate AuthType
        let authType: AuthType;
        switch (authMode) {
          case 'oauth':
            authType = AuthType.LOGIN_WITH_GOOGLE;
            break;
          case 'api-key':
            authType = AuthType.USE_GEMINI;
            break;
          case 'vertex':
            authType = AuthType.USE_VERTEX_AI;
            break;
          default:
            authType = AuthType.LOGIN_WITH_GOOGLE;
        }

        // Refresh auth with the new type
        await context.services.config.refreshAuth(authType);

        return {
          type: 'message',
          messageType: 'info',
          content: `Switched to ${authMode} authentication mode`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Auth mode switching is only supported for the Gemini provider',
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch auth mode: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
