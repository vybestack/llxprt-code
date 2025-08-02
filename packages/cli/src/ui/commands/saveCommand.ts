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
import {
  ProfileManager,
  Profile,
  EphemeralSettings,
} from '@vybestack/llxprt-code-core';

/**
 * Implementation for the /save command that redirects to /profile save.
 * @deprecated Use /profile save instead
 */
export const saveCommand: SlashCommand = {
  name: 'save',
  description: 'save current configuration to a profile',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn> => {
    return {
      type: 'message',
      messageType: 'info',
      content: 'The /save command has been replaced by /profile save. Please use /profile save "<name>" instead.',
    };
  },
};

/* Original save implementation - kept for reference
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
        content: 'Usage: /save "<profile-name>"',
      };
    }

    // Extract profile name - handle quoted names
    const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
    const profileName = profileNameMatch ? profileNameMatch[1] : trimmedArgs;

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /save "<profile-name>"',
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

      // Get current provider and model
      const providerName = context.services.config.getProvider();
      const modelName = context.services.config.getModel();

      // Get the provider manager and active provider
      const providerManager = context.services.config.getProviderManager();
      const activeProvider = providerManager?.getActiveProvider();

      // Get model params from provider
      let modelParams: Record<string, unknown> = {};
      if (
        activeProvider &&
        'getModelParams' in activeProvider &&
        activeProvider.getModelParams
      ) {
        modelParams = activeProvider.getModelParams() || {};
      }

      // Get ephemeral settings from config
      const allEphemeralSettings =
        context.services.config.getEphemeralSettings();
      const ephemeralKeys: Array<keyof EphemeralSettings> = [
        'context-limit',
        'compression-threshold',
        'base-url',
        'tool-format',
        'api-version',
        'custom-headers',
      ];

      const ephemeralSettings: Partial<EphemeralSettings> = {};
      for (const key of ephemeralKeys) {
        const value = allEphemeralSettings[key];
        if (value !== undefined) {
          (ephemeralSettings as Record<string, unknown>)[key] = value;
        }
      }

      // Get auth-key from ephemeral settings (set by /key command)
      const ephemeralApiKey = allEphemeralSettings['auth-key'];
      if (ephemeralApiKey) {
        (ephemeralSettings as Record<string, unknown>)['auth-key'] = ephemeralApiKey;
      }

      // Fallback: Check persistent settings for base-url if not in ephemeral
      // This handles the case where base-url was set with the old command
      if (!ephemeralSettings['base-url']) {
        const allSettings = context.services.settings.merged || {};
        const providerBaseUrls = (allSettings.providerBaseUrls as Record<string, string>) || {};
        if (providerName && providerBaseUrls[providerName]) {
          (ephemeralSettings as Record<string, unknown>)['base-url'] = providerBaseUrls[providerName];
        }
      }

      // Create profile object
      const profile: Profile = {
        version: 1,
        provider: providerName || '',
        model: modelName || '',
        modelParams,
        ephemeralSettings: ephemeralSettings as EphemeralSettings,
      };

      // Save profile
      const profileManager = new ProfileManager();
      await profileManager.saveProfile(profileName, profile);

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' saved`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to save profile: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
*/
