/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  OpenDialogActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  extractProfileName,
  validateProfileName,
  type ProfileSchemas,
} from './profileSchemas.js';
import {
  classifyLoadError,
  formatProfileMessages,
  logger,
  type ProfileLoadResultView,
} from './profileLoad.js';

export interface ProfileCommandOperations {
  readonly schemas: ProfileSchemas;
  saveModelProfile(
    parts: readonly string[],
  ): Promise<MessageActionReturn | OpenDialogActionReturn>;
  saveLoadBalancerProfile(
    parts: readonly string[],
  ): Promise<MessageActionReturn | OpenDialogActionReturn>;
  loadProfile(
    profileName: string,
  ): Promise<ProfileLoadResultView & { providerName?: string }>;
  publishLoadedProfile(): Promise<void>;
  recordProviderSwitch(
    result: { providerName?: string },
    profileLoadResult: ProfileLoadResultView,
    reportFailure: (message: string) => void,
  ): Promise<void>;
  deleteProfile(profileName: string): Promise<void>;
  listProfiles(): Promise<readonly string[]>;
  setDefaultProfileName(profileName: string | null): Promise<void>;
}

function usageError(content: string): MessageActionReturn {
  return { type: 'message', messageType: 'error', content };
}

function message(
  messageType: MessageActionReturn['messageType'],
  content: string,
): MessageActionReturn {
  return { type: 'message', messageType, content };
}

function createSaveCommand(operations: ProfileCommandOperations): SlashCommand {
  return {
    name: 'save',
    description: 'save current configuration to a profile',
    kind: CommandKind.BUILT_IN,
    schema: operations.schemas.profileSaveSchema,
    action: async (_context: CommandContext, args: string) => {
      const trimmedArgs = args.trim();
      if (!trimmedArgs)
        return usageError(
          'Usage: /profile save model <name> or /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]',
        );
      const parts = trimmedArgs.split(/\s+/);
      if (parts[0] === 'model') return operations.saveModelProfile(parts);
      if (parts[0] === 'loadbalancer')
        return operations.saveLoadBalancerProfile(parts);
      return usageError(
        'Usage: /profile save model <name> or /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]',
      );
    },
  };
}

function createLoadCommand(operations: ProfileCommandOperations): SlashCommand {
  return {
    name: 'load',
    description: 'load configuration from a saved profile',
    kind: CommandKind.BUILT_IN,
    schema: operations.schemas.profileLoadSchema,
    action: async (_context: CommandContext, args: string) => {
      const trimmedArgs = args.trim();
      if (!trimmedArgs) return { type: 'dialog', dialog: 'loadProfile' };
      const profileName = extractProfileName(trimmedArgs);
      if (!profileName)
        return usageError('Usage: /profile load "<profile-name>"');
      const nameError = validateProfileName(profileName);
      if (nameError) return nameError;

      try {
        const result = await operations.loadProfile(profileName);
        const infoMessages = formatProfileMessages(result.infoMessages, '- ');
        const warningMessages = formatProfileMessages(result.warnings, '⚠ ');
        await operations.publishLoadedProfile();
        let recordingFailureMessage = '';
        await operations.recordProviderSwitch(result, result, (failure) => {
          recordingFailureMessage = `\n⚠ ${failure}`;
        });
        return message(
          'info',
          `Profile '${profileName}' loaded${infoMessages}${warningMessages}${recordingFailureMessage}`,
        );
      } catch (error) {
        logger.error(
          () =>
            `[profile] failed to load '${profileName}': ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        return classifyLoadError(error, profileName);
      }
    },
  };
}

function createDeleteCommand(
  operations: ProfileCommandOperations,
): SlashCommand {
  return {
    name: 'delete',
    description: 'delete a saved profile',
    kind: CommandKind.BUILT_IN,
    schema: operations.schemas.profileDeleteSchema,
    action: async (_context: CommandContext, args: string) => {
      const trimmedArgs = args.trim();
      if (!trimmedArgs)
        return usageError('Usage: /profile delete "<profile-name>"');
      const profileName = extractProfileName(trimmedArgs);
      if (!profileName)
        return usageError('Usage: /profile delete "<profile-name>"');
      const nameError = validateProfileName(profileName);
      if (nameError) return nameError;
      try {
        await operations.deleteProfile(profileName);
        return message('info', `Profile '${profileName}' deleted`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found'))
          return message('error', `Profile '${profileName}' not found`);
        return message(
          'error',
          `Failed to delete profile: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function createSetDefaultCommand(
  operations: ProfileCommandOperations,
): SlashCommand {
  return {
    name: 'set-default',
    description: 'set a profile to load automatically on startup',
    kind: CommandKind.BUILT_IN,
    schema: operations.schemas.profileSetDefaultSchema,
    action: async (_context: CommandContext, args: string) => {
      const trimmedArgs = args.trim();
      if (!trimmedArgs)
        return usageError(
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
        );
      const profileName = extractProfileName(trimmedArgs);
      if (!profileName)
        return usageError(
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
        );
      try {
        if (profileName.toLowerCase() === 'none') {
          await operations.setDefaultProfileName(null);
          return message(
            'info',
            'Default profile cleared. Gemini will start with default settings.',
          );
        }
        const profiles = await operations.listProfiles();
        if (!profiles.includes(profileName))
          return message(
            'error',
            `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
          );
        await operations.setDefaultProfileName(profileName);
        return message(
          'info',
          `Profile '${profileName}' set as default. It will be loaded automatically on startup.`,
        );
      } catch (error) {
        return message(
          'error',
          `Failed to set default profile: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function createCreateCommand(): SlashCommand {
  return {
    name: 'create',
    description: 'interactive wizard to create a new profile',
    kind: CommandKind.BUILT_IN,
    action: async (
      _context: CommandContext,
    ): Promise<OpenDialogActionReturn> => ({
      type: 'dialog',
      dialog: 'createProfile',
    }),
  };
}

function createListCommand(): SlashCommand {
  return {
    name: 'list',
    description: 'list all saved profiles (interactive)',
    kind: CommandKind.BUILT_IN,
    action: async (_context: CommandContext) => {
      logger.log(() => 'list action returning profileList dialog');
      return { type: 'dialog', dialog: 'profileList' };
    },
  };
}

function createProfileSelectionCommand(
  name: 'show' | 'edit',
  description: string,
  dialog: 'profileDetail' | 'profileEditor',
  schema: ProfileSchemas['profileShowSchema'],
  operations: ProfileCommandOperations,
): SlashCommand {
  return {
    name,
    description,
    kind: CommandKind.BUILT_IN,
    schema,
    action: async (_context: CommandContext, args: string) => {
      const trimmedArgs = args.trim();
      if (!trimmedArgs)
        return usageError(`Usage: /profile ${name} <profile-name>`);
      const profileName = extractProfileName(trimmedArgs);
      if (!profileName)
        return usageError(`Usage: /profile ${name} <profile-name>`);
      try {
        const profiles = await operations.listProfiles();
        if (!profiles.includes(profileName))
          return message(
            'error',
            `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
          );
      } catch {
        // The profile dialog reports errors from its own data source.
      }
      return { type: 'dialog', dialog, dialogData: { profileName } };
    },
  };
}

function profileHelp(): MessageActionReturn {
  return message(
    'info',
    `Profile management commands:
  /profile save model <name>    - Save current model configuration
  /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]
                                - Save a load balancer profile
  /profile load <name>          - Load a saved profile
  /profile show <name>          - View details of a specific profile
  /profile edit <name>          - Edit a specific profile
  /profile create               - Interactive wizard to create a profile
  /profile delete <name>        - Delete a saved profile
  /profile set-default <name>   - Set profile to load on startup (or "none")
  /profile list                 - List all saved profiles`,
  );
}

export function createProfileCommand(
  operations: ProfileCommandOperations,
): SlashCommand {
  return {
    name: 'profile',
    description: 'manage configuration profiles',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      createSaveCommand(operations),
      createLoadCommand(operations),
      createCreateCommand(),
      createDeleteCommand(operations),
      createSetDefaultCommand(operations),
      createListCommand(),
      createProfileSelectionCommand(
        'show',
        'view details of a specific profile',
        'profileDetail',
        operations.schemas.profileShowSchema,
        operations,
      ),
      createProfileSelectionCommand(
        'edit',
        'edit a specific profile',
        'profileEditor',
        operations.schemas.profileEditSchema,
        operations,
      ),
    ],
    action: async (_context: CommandContext): Promise<MessageActionReturn> =>
      profileHelp(),
  };
}
