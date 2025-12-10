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
import { SettingScope } from '../../config/settings.js';
import {
  type CommandArgumentSchema,
  type CompleterFn,
} from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';

const profileSuggestionDescription = 'Saved profile';

async function listProfiles(): Promise<string[]> {
  return getRuntimeApi().listSavedProfiles();
}

const profileNameCompleter: CompleterFn = withFuzzyFilter(async () => {
  try {
    const profiles = await listProfiles();
    return profiles.map((profile) => ({
      value: profile,
      description: profileSuggestionDescription,
    }));
  } catch {
    return [];
  }
});

const profileSaveSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Enter profile name to save',
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P11
     * @requirement:REQ-004
     * Schema-driven completion replaces legacy helpers.
     */
    completer: profileNameCompleter,
  },
];

const profileLoadSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to load',
    completer: profileNameCompleter,
  },
];

const profileDeleteSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to delete',
    completer: profileNameCompleter,
  },
];

const profileSetDefaultSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Set default profile or choose none',
    completer: withFuzzyFilter(async () => {
      try {
        const profiles = await listProfiles();
        const candidates = ['none', ...profiles];
        return candidates.map((option) => ({
          value: option,
          description:
            option === 'none'
              ? 'Clear default profile'
              : profileSuggestionDescription,
        }));
      } catch {
        return [];
      }
    }),
  },
];

/**
 * Profile save subcommand
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'save current configuration to a profile',
  kind: CommandKind.BUILT_IN,
  schema: profileSaveSchema,
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
      const runtime = getRuntimeApi();
      await runtime.saveProfileSnapshot(profileName);
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
const logger = new DebugLogger('llxprt:ui:profile-command');

const loadCommand: SlashCommand = {
  name: 'load',
  description: 'load configuration from a saved profile',
  kind: CommandKind.BUILT_IN,
  schema: profileLoadSchema,
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
      const runtime = getRuntimeApi();
      const statusBefore = runtime.getActiveProviderStatus();
      const result = await runtime.loadProfileByName(profileName);
      if (result.providerName) {
        try {
          await runtime.switchActiveProvider(result.providerName);
          logger.debug(
            () =>
              `[profile] switchActiveProvider invoked for '${result.providerName}'`,
          );
        } catch (error) {
          logger.error(
            () =>
              `[profile] failed to switch provider via runtime API: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const infoMessages = (result.infoMessages ?? [])
        .map((message) => `\n- ${message}`)
        .join('');
      const warningMessages = (result.warnings ?? [])
        .map((warning) => `\n⚠ ${warning}`)
        .join('');

      const configService = context.services.config;
      if (configService) {
        const providerManager = configService.getProviderManager?.();
        if (providerManager && result.providerName) {
          logger.debug(
            () =>
              `[profile] forcing config provider manager switch to '${result.providerName}'`,
          );
          try {
            providerManager.setActiveProvider(result.providerName);
            logger.debug(() => {
              let activeName = 'unknown';
              try {
                activeName = providerManager.getActiveProvider().name;
              } catch (readError) {
                logger.debug(
                  () =>
                    `[profile] unable to read active provider: ${readError instanceof Error ? readError.message : String(readError)}`,
                );
              }
              return `[profile] config manager active provider after switch: ${activeName}`;
            });
          } catch (error) {
            logger.error(
              () =>
                `[profile] failed to set provider on config manager: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          configService.setProvider?.(result.providerName);
        }

        const geminiClient = configService.getGeminiClient?.();
        if (geminiClient && typeof geminiClient.setTools === 'function') {
          try {
            await geminiClient.setTools();
          } catch (error) {
            logger.warn(
              () =>
                `[profile] failed to refresh Gemini tool schema after load: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      try {
        const status = runtime.getActiveProviderStatus();
        logger.debug(
          () =>
            `[profile] runtime provider status after load: provider=${status.providerName}, model=${status.modelName}`,
        );
      } catch (error) {
        logger.error(
          () =>
            `[profile] failed to read runtime provider status: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(
          () =>
            extendedContext.checkPaymentModeChange?.(
              statusBefore.providerName ?? undefined,
            ),
          100,
        );
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' loaded${infoMessages}${warningMessages}`,
      };
    } catch (error) {
      logger.error(
        () =>
          `[profile] failed to load '${profileName}': ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
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
  schema: profileDeleteSchema,
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
      const runtime = getRuntimeApi();
      await runtime.deleteProfileByName(profileName);

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
  schema: profileSetDefaultSchema,
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
        getRuntimeApi().setDefaultProfileName(null);
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
      const profiles = await listProfiles();
      if (!profiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
        };
      }

      // Set the default profile
      getRuntimeApi().setDefaultProfileName(profileName);
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
      const profiles = await listProfiles();

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
