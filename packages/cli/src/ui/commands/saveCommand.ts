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
 * Implementation for the /save command that saves the current model configuration to a profile.
 * Usage: /save "<profile-name>"
 */
export const saveCommand: SlashCommand = {
  name: 'save',
  description: 'save current configuration to a profile',
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

      // Get ephemeral settings from context
      const allSettings = context.services.settings.merged || {};
      const ephemeralKeys: Array<keyof EphemeralSettings> = [
        'context-limit',
        'compression-threshold',
        'auth-key',
        'auth-keyfile',
        'base-url',
        'tool-format',
        'api-version',
        'custom-headers',
      ];

      const ephemeralSettings: Partial<EphemeralSettings> = {};
      for (const key of ephemeralKeys) {
        if (key in allSettings) {
          // TypeScript requires us to cast here because allSettings is a general object
          // but we know these keys are valid ephemeral settings
          const value = allSettings[key as keyof typeof allSettings];
          if (value !== undefined) {
            (ephemeralSettings as Record<string, unknown>)[key] = value;
          }
        }
      }

      // Special handling for provider-specific settings
      const providerApiKeys =
        (allSettings.providerApiKeys as Record<string, string>) || {};
      const providerBaseUrls =
        (allSettings.providerBaseUrls as Record<string, string>) || {};

      // Map provider-specific API key to ephemeral auth-key
      if (providerName && providerApiKeys[providerName]) {
        (ephemeralSettings as Record<string, unknown>)['auth-key'] =
          providerApiKeys[providerName];
      }

      // Map provider-specific base URL to ephemeral base-url
      if (providerName && providerBaseUrls[providerName]) {
        (ephemeralSettings as Record<string, unknown>)['base-url'] =
          providerBaseUrls[providerName];
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
