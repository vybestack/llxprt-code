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
import {
  ProfileManager,
  Profile,
  EphemeralSettings,
  AuthType,
} from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../config/settings.js';

/**
 * Profile save subcommand
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'save current configuration to a profile',
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
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    // Parse profile name from args
    const trimmedArgs = args?.trim();

    if (!trimmedArgs) {
      // For now, show usage until dialog system is implemented
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile save "<profile-name>"',
      };
    }

    // Extract profile name - handle quoted names
    const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
    const profileName = profileNameMatch ? profileNameMatch[1] : trimmedArgs;

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile save "<profile-name>"',
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

      // Get the provider manager and active provider
      const providerManager = context.services.config.getProviderManager();
      const activeProvider = providerManager?.getActiveProvider();

      // Get the model from the provider first (source of truth), fallback to config
      const providerModel = activeProvider?.getCurrentModel?.();
      const configModel = context.services.config.getModel();
      const modelName = providerModel || configModel;

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
        'disabled-tools',
        'tool-output-max-items',
        'tool-output-max-tokens',
        'tool-output-truncate-mode',
        'tool-output-item-size-limit',
        'max-prompt-tokens',
      ];

      const ephemeralSettings: Partial<EphemeralSettings> = {};
      for (const key of ephemeralKeys) {
        const value = allEphemeralSettings[key];
        if (value !== undefined) {
          (ephemeralSettings as Record<string, unknown>)[key] = value;
        }
      }

      // Get auth-keyfile from ephemeral settings (set by /keyfile command)
      const ephemeralKeyfile = allEphemeralSettings['auth-keyfile'];
      if (ephemeralKeyfile) {
        (ephemeralSettings as Record<string, unknown>)['auth-keyfile'] =
          ephemeralKeyfile;
        // Don't save auth-key if using keyfile
      } else {
        // Get auth-key from ephemeral settings (set by /key command)
        const ephemeralApiKey = allEphemeralSettings['auth-key'];
        if (ephemeralApiKey) {
          (ephemeralSettings as Record<string, unknown>)['auth-key'] =
            ephemeralApiKey;
        }
      }

      // Fallback: Check persistent settings for base-url if not in ephemeral
      // This handles the case where base-url was set with the old command
      if (!ephemeralSettings['base-url']) {
        const allSettings = context.services.settings.merged || {};
        const providerBaseUrls =
          (allSettings.providerBaseUrls as Record<string, string>) || {};
        if (providerName && providerBaseUrls[providerName]) {
          (ephemeralSettings as Record<string, unknown>)['base-url'] =
            providerBaseUrls[providerName];
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

/**
 * Profile load subcommand
 */
const loadCommand: SlashCommand = {
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
        content: 'Usage: /profile load "<profile-name>"',
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

      // Also set model on the provider
      const activeProviderForModel = providerManager?.getActiveProvider();
      if (activeProviderForModel && activeProviderForModel.setModel) {
        activeProviderForModel.setModel(profile.model);
      }

      // 3. Clear existing ephemeral settings first
      const ephemeralKeys = [
        'auth-key',
        'auth-keyfile',
        'context-limit',
        'compression-threshold',
        'base-url',
        'tool-format',
        'api-version',
        'custom-headers',
        'disabled-tools',
      ];

      // Clear all known ephemeral settings
      for (const key of ephemeralKeys) {
        context.services.config.setEphemeralSetting(key, undefined);
      }

      // Reset GeminiClient compression settings
      const geminiClient = context.services.config.getGeminiClient();
      if (geminiClient) {
        geminiClient.setCompressionSettings(undefined, undefined);
      }

      // Clear model parameters on the provider
      const activeProvider = providerManager?.getActiveProvider();
      if (
        activeProvider &&
        'setModelParams' in activeProvider &&
        activeProvider.setModelParams
      ) {
        // Clear all existing model params by passing undefined
        activeProvider.setModelParams(undefined);
      }

      // 4. Apply ephemeral settings from profile
      for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
        // Store in ephemeral settings
        context.services.config.setEphemeralSetting(key, value);

        // Special handling for auth-key, auth-keyfile, and base-url
        if (key === 'auth-key' && typeof value === 'string') {
          // Directly set API key on the provider without saving to persistent settings
          const activeProvider = providerManager?.getActiveProvider();
          if (activeProvider && activeProvider.setApiKey) {
            activeProvider.setApiKey(value);
          }
        } else if (key === 'auth-keyfile' && typeof value === 'string') {
          // Load API key from file
          try {
            const { promises: fs } = await import('fs');
            const { homedir } = await import('os');
            const resolvedPath = value.replace(/^~/, homedir());
            const apiKey = (await fs.readFile(resolvedPath, 'utf-8')).trim();

            const activeProvider = providerManager?.getActiveProvider();
            if (activeProvider && activeProvider.setApiKey && apiKey) {
              activeProvider.setApiKey(apiKey);
            }
          } catch (error) {
            // Log error but continue loading profile
            console.error(`Failed to load keyfile ${value}:`, error);
          }
        } else if (key === 'base-url' && typeof value === 'string') {
          // Directly set base URL on the provider without saving to persistent settings
          const activeProvider = providerManager?.getActiveProvider();
          if (activeProvider && activeProvider.setBaseUrl) {
            // Handle "none" as clearing the base URL
            if (value === 'none') {
              activeProvider.setBaseUrl(undefined);
            } else {
              activeProvider.setBaseUrl(value);
            }
          }
        }
      }

      // Apply compression settings if they exist in the profile
      const contextLimit = profile.ephemeralSettings['context-limit'] as
        | number
        | undefined;
      const compressionThreshold = profile.ephemeralSettings[
        'compression-threshold'
      ] as number | undefined;
      if (
        (contextLimit !== undefined || compressionThreshold !== undefined) &&
        geminiClient
      ) {
        geminiClient.setCompressionSettings(compressionThreshold, contextLimit);
      }

      // 5. Call provider.setModelParams() with the profile's model params
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

      // 6. Refresh auth to ensure provider is properly initialized
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

/**
 * Profile delete subcommand
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'delete a saved profile',
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
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    // Parse profile name from args
    const trimmedArgs = args?.trim();

    if (!trimmedArgs) {
      // For now, show usage until dialog system is implemented
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile delete "<profile-name>"',
      };
    }

    // Extract profile name - handle quoted names
    const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
    const profileName = profileNameMatch ? profileNameMatch[1] : trimmedArgs;

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile delete "<profile-name>"',
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
      // Delete the profile
      const profileManager = new ProfileManager();
      await profileManager.deleteProfile(profileName);

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' deleted`,
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
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to delete profile: ${error.message}`,
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to delete profile: ${String(error)}`,
      };
    }
  },
};

/**
 * Profile set-default subcommand
 */
const setDefaultCommand: SlashCommand = {
  name: 'set-default',
  description: 'set a profile to load automatically on startup',
  kind: CommandKind.BUILT_IN,
  completion: async (_context: CommandContext, partialArg: string) => {
    const profileManager = new ProfileManager();
    const profiles = await profileManager.listProfiles();

    // Add 'none' option to clear default
    const options = ['none', ...profiles];

    // Filter based on partial argument
    if (partialArg) {
      const unquoted = partialArg.startsWith('"')
        ? partialArg.slice(1)
        : partialArg;
      return options.filter((option) => option.startsWith(unquoted));
    }

    return options;
  },
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
        content:
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
      };
    }

    // Extract profile name - handle quoted names
    const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
    const profileName = profileNameMatch ? profileNameMatch[1] : trimmedArgs;

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
      };
    }

    try {
      // Check if settings service is available
      if (!context.services.settings) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Settings service not available',
        };
      }

      if (profileName.toLowerCase() === 'none') {
        // Clear the default profile
        context.services.settings.setValue(
          SettingScope.User,
          'defaultProfile',
          undefined,
        );
        return {
          type: 'message',
          messageType: 'info',
          content:
            'Default profile cleared. Gemini will start with default settings.',
        };
      }

      // Verify profile exists
      const profileManager = new ProfileManager();
      const profiles = await profileManager.listProfiles();
      if (!profiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
        };
      }

      // Set the default profile
      context.services.settings.setValue(
        SettingScope.User,
        'defaultProfile',
        profileName,
      );

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' set as default. It will be loaded automatically on startup.`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to set default profile: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Profile list subcommand
 */
const listCommand: SlashCommand = {
  name: 'list',
  description: 'list all saved profiles',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn> => {
    try {
      const profileManager = new ProfileManager();
      const profiles = await profileManager.listProfiles();

      if (profiles.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content:
            'No profiles saved yet. Use /profile save "<name>" to create one.',
        };
      }

      const profileList = profiles.map((name) => `  • ${name}`).join('\n');
      return {
        type: 'message',
        messageType: 'info',
        content: `Saved profiles:\n${profileList}`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to list profiles: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Main profile command that handles subcommands
 */
export const profileCommand: SlashCommand = {
  name: 'profile',
  description: 'manage configuration profiles',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    saveCommand,
    loadCommand,
    deleteCommand,
    setDefaultCommand,
    listCommand,
  ],
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn> => ({
    type: 'message',
    messageType: 'info',
    content: `Profile management commands:
  /profile save "<name>"        - Save current configuration
  /profile load "<name>"        - Load a saved profile
  /profile delete "<name>"      - Delete a saved profile
  /profile set-default "<name>" - Set profile to load on startup (or "none")
  /profile list                 - List all saved profiles`,
  }),
};
