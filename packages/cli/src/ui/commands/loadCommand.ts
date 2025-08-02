/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  OpenDialogActionReturn,
  CommandKind,
} from './types.js';
import { ProfileManager, AuthType } from '@vybestack/llxprt-code-core';

/**
 * Implementation for the /load command that redirects to /profile load.
 * @deprecated Use /profile load instead
 */
export const loadCommand: SlashCommand = {
  name: 'load',
  description: 'load configuration from a saved profile',
  kind: CommandKind.BUILT_IN,
  completion: async (_context: CommandContext, partialArg: string) => {
    const profileManager = new ProfileManager();
    const profiles = await profileManager.listProfiles();

    // Filter profiles based on partial argument
    if (partialArg) {
      // Handle quoted partial arguments
      const unquoted = partialArg.startsWith('"')
        ? partialArg.slice(1)
        : partialArg;
      return profiles.filter((profile) => profile.startsWith(unquoted));
    }

    return profiles;
  },
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    return {
      type: 'message',
      messageType: 'info',
      content: 'The /load command has been replaced by /profile load. Please use /profile load "<name>" instead.',
    };
  },
};

/* Original load implementation - kept for reference
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    // Parse profile name from args
    const trimmedArgs = args?.trim();

    if (!trimmedArgs) {
      // Open interactive profile selection dialog
      return {
        type: 'dialog',
        dialog: 'loadProfile',
      };
    }

    // Extract profile name - handle quoted names
    const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
    const profileName = profileNameMatch ? profileNameMatch[1] : trimmedArgs;

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /load "<profile-name>"',
      };
    }

    // Validate profile name - basic validation
    if (profileName.includes('/') || profileName.includes('\\')) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Profile name cannot contain path separators',
      };
    }

    try {
      // Check if config is available
      if (!context.services.config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No configuration available',
        };
      }

      // Load the profile
      const profileManager = new ProfileManager();
      const profile = await profileManager.loadProfile(profileName);

      // Apply settings in the correct order:
      // 1. Set provider first
      const providerManager = context.services.config.getProviderManager();
      if (providerManager) {
        providerManager.setActiveProvider(profile.provider);

        // Ensure provider manager is set on config
        context.services.config.setProviderManager(providerManager);

        // Update the provider in config
        context.services.config.setProvider(profile.provider);
      }

      // 2. Set model second
      context.services.config.setModel(profile.model);

      // 3. Apply ephemeral settings third
      for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
        // Store in ephemeral settings
        context.services.config.setEphemeralSetting(key, value);

        // Special handling for auth-key and base-url
        if (key === 'auth-key' && typeof value === 'string') {
          // Directly set API key on the provider without saving to persistent settings
          const activeProvider = providerManager?.getActiveProvider();
          if (activeProvider && activeProvider.setApiKey) {
            activeProvider.setApiKey(value);
          }
        } else if (key === 'base-url' && typeof value === 'string') {
          // Directly set base URL on the provider without saving to persistent settings
          const activeProvider = providerManager?.getActiveProvider();
          if (activeProvider && activeProvider.setBaseUrl) {
            activeProvider.setBaseUrl(value);
          }
        }
      }

      // 4. Call provider.setModelParams()
      const activeProvider = providerManager?.getActiveProvider();
      if (
        activeProvider &&
        'setModelParams' in activeProvider &&
        activeProvider.setModelParams
      ) {
        if (
          profile.modelParams &&
          Object.keys(profile.modelParams).length > 0
        ) {
          activeProvider.setModelParams(profile.modelParams);
        }
      }

      // 5. Refresh auth to ensure provider is properly initialized
      const currentAuthType =
        context.services.config.getContentGeneratorConfig()?.authType ||
        AuthType.LOGIN_WITH_GOOGLE;

      await context.services.config.refreshAuth(currentAuthType);

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' loaded`,
      };
    } catch (error) {
      // Handle specific error messages
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Profile '${profileName}' not found`,
          };
        }
        if (error.message.includes('corrupted')) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Profile '${profileName}' is corrupted`,
          };
        }
        if (error.message.includes('missing required fields')) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Profile '${profileName}' is invalid: missing required fields`,
          };
        }
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to load profile: ${error.message}`,
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to load profile: ${String(error)}`,
      };
    }
  },
};
*/
