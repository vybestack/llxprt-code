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
import { ProfileManager, AuthType } from '@vybestack/llxprt-code-core';
import { SettingScope, Settings } from '../../config/settings.js';
import {
  setProviderApiKey,
  setProviderBaseUrl,
} from '../../providers/providerConfigUtils.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

/**
 * Implementation for the /load command that loads a saved profile configuration.
 * Usage: /load "<profile-name>"
 */
export const loadCommand: SlashCommand = {
  name: 'load',
  description: 'load configuration from a saved profile',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    // Parse profile name from args
    const trimmedArgs = args?.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /load "<profile-name>"',
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
      const settings = context.services.settings;
      for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
        // Special handling for auth-key and base-url
        if (key === 'auth-key' && typeof value === 'string') {
          // Set API key for the provider - use the concrete provider manager
          const concreteProviderManager = getProviderManager();
          await setProviderApiKey(
            concreteProviderManager,
            settings,
            value,
            context.services.config,
          );
        } else if (key === 'base-url' && typeof value === 'string') {
          // Set base URL for the provider - use the concrete provider manager
          const concreteProviderManager = getProviderManager();
          await setProviderBaseUrl(concreteProviderManager, settings, value);
        } else {
          // Use setValue with SettingScope.User for other ephemeral settings
          settings.setValue(SettingScope.User, key as keyof Settings, value);
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
