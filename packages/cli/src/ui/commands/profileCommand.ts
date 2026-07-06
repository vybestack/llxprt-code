/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  OpenDialogActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { SettingScope } from '../../config/settings.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  profileSaveSchema,
  profileLoadSchema,
  profileDeleteSchema,
  profileSetDefaultSchema,
  profileShowSchema,
  profileEditSchema,
  extractProfileName,
  validateProfileName,
  listProfiles,
} from './profileSchemas.js';
import {
  saveModelProfile,
  saveLoadBalancerProfile,
} from './profileLoadBalancer.js';
import {
  classifyLoadError,
  applyLoadedProfileConfig,
  recordProviderSwitch,
  schedulePaymentModeCheck,
  formatProfileMessages,
  logger,
  type ProfileLoadResultView,
} from './profileLoad.js';

/**
 * Profile save subcommand
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'save current configuration to a profile',
  kind: CommandKind.BUILT_IN,
  schema: profileSaveSchema,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /profile save model <name> or /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]',
      };
    }

    const parts = trimmedArgs.split(/\s+/);
    const profileType = parts[0];

    if (profileType === 'model') {
      return saveModelProfile(parts);
    }

    if (profileType === 'loadbalancer') {
      return saveLoadBalancerProfile(parts);
    }

    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /profile save model <name> or /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]',
    };
  },
};

/**
 * Profile load subcommand
 */
const loadCommand: SlashCommand = {
  name: 'load',
  description: 'load configuration from a saved profile',
  kind: CommandKind.BUILT_IN,
  schema: profileLoadSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'dialog',
        dialog: 'loadProfile',
      };
    }

    const profileName = extractProfileName(trimmedArgs);

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile load "<profile-name>"',
      };
    }

    const nameError = validateProfileName(profileName);
    if (nameError) {
      return nameError;
    }

    try {
      const runtime = getRuntimeApi();
      const statusBefore = runtime.getActiveProviderStatus();
      const result = await runtime.loadProfileByName(profileName);
      const profileLoadResult = result as ProfileLoadResultView;
      let switchWarning: string | undefined;
      if (result.providerName) {
        switchWarning = await switchProviderViaAgent(
          context,
          result.providerName,
          profileLoadResult.modelName,
        );
      }
      const infoMessages = formatProfileMessages(
        profileLoadResult.infoMessages,
        '- ',
      );
      const warningMessages = formatProfileMessages(
        profileLoadResult.warnings,
        '⚠ ',
      );
      const switchWarningMessage =
        switchWarning !== undefined
          ? `
${switchWarning}`
          : '';

      await applyLoadedProfileConfig(context, result);

      logRuntimeProviderStatus(runtime);

      recordProviderSwitch(context, result, profileLoadResult);
      schedulePaymentModeCheck(context, statusBefore.providerName ?? undefined);

      return {
        type: 'message',
        messageType: 'info',
        content: `Profile '${profileName}' loaded${infoMessages}${warningMessages}${switchWarningMessage}`,
      };
    } catch (error) {
      logger.error(
        () =>
          `[profile] failed to load '${profileName}': ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      return classifyLoadError(error, profileName);
    }
  },
};

/**
 * Switches the active provider through the agent facade after a profile load.
 * When the agent facade is unavailable (null), surfaces a user-visible warning
 * instead of silently skipping the switch — consistent with providerCommand's
 * null-agent error style (#2374 finding 7). Errors from the switch itself are
 * logged but never propagated — a provider-switch failure must not abort the
 * profile load (the config has already been applied).
 *
 * Returns a warning message string when the agent is null so the caller can
 * surface it to the user; returns undefined on success or when no switch was
 * requested.
 */
async function switchProviderViaAgent(
  context: CommandContext,
  providerName: string,
  modelName?: string,
): Promise<string | undefined> {
  const agent = context.services.agent;
  if (!agent) {
    // No agent facade — the provider config has been applied, but the runtime
    // switch cannot run. Surface a user-visible warning instead of silently
    // continuing (#2374 finding 7).
    return `Provider '${providerName}' configured but the interactive Agent is unavailable — restart to activate it.`;
  }
  try {
    const switchResult = await agent.setProvider(providerName, modelName);
    logger.debug(
      () => `[profile] provider switch invoked for '${providerName}'`,
    );
    // Surface infoMessages (base URL notices, fallback messages, auth info)
    // from the switch result so the user sees what happened (#2374 CodeRabbit).
    if (switchResult.infoMessages.length > 0) {
      return switchResult.infoMessages.join('\n');
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      () => `[profile] failed to switch provider via agent facade: ${errMsg}`,
    );
    // Surface the failure to the user — returning undefined would hide the
    // error and present "Profile loaded" as if the switch succeeded.
    return `Provider '${providerName}' switch failed: ${errMsg}`;
  }
  return undefined;
}

/**
 * Logs the runtime provider status after a profile load, swallowing errors so
 * a status-read failure cannot abort the load flow.
 */
function logRuntimeProviderStatus(
  runtime: ReturnType<typeof getRuntimeApi>,
): void {
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
}

/**
 * Profile delete subcommand
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'delete a saved profile',
  kind: CommandKind.BUILT_IN,
  schema: profileDeleteSchema,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile delete "<profile-name>"',
      };
    }

    const profileName = extractProfileName(trimmedArgs);

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile delete "<profile-name>"',
      };
    }

    const nameError = validateProfileName(profileName);
    if (nameError) {
      return nameError;
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
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
      };
    }

    const profileName = extractProfileName(trimmedArgs);

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /profile set-default "<profile-name>" or /profile set-default none',
      };
    }

    try {
      if (profileName.toLowerCase() === 'none') {
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

      const profiles = await listProfiles();
      if (!profiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
        };
      }

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
 * Profile create subcommand
 */
const createCommand: SlashCommand = {
  name: 'create',
  description: 'interactive wizard to create a new profile',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<OpenDialogActionReturn> => ({
    type: 'dialog',
    dialog: 'createProfile',
  }),
};

/**
 * Profile list subcommand
 */
const listCommand: SlashCommand = {
  name: 'list',
  description: 'list all saved profiles (interactive)',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    logger.log(() => 'list action returning profileList dialog');
    return {
      type: 'dialog',
      dialog: 'profileList',
    };
  },
};

/**
 * Profile show subcommand
 */
const showCommand: SlashCommand = {
  name: 'show',
  description: 'view details of a specific profile',
  kind: CommandKind.BUILT_IN,
  schema: profileShowSchema,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile show <profile-name>',
      };
    }

    const profileName = extractProfileName(trimmedArgs);

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile show <profile-name>',
      };
    }

    try {
      const profiles = await listProfiles();
      if (!profiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
        };
      }
    } catch {
      // Continue anyway, the dialog will show the error
    }

    return {
      type: 'dialog',
      dialog: 'profileDetail',
      dialogData: { profileName },
    };
  },
};

/**
 * Profile edit subcommand
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'edit a specific profile',
  kind: CommandKind.BUILT_IN,
  schema: profileEditSchema,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | OpenDialogActionReturn> => {
    const trimmedArgs = args.trim();

    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile edit <profile-name>',
      };
    }

    const profileName = extractProfileName(trimmedArgs);

    if (!profileName) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /profile edit <profile-name>',
      };
    }

    try {
      const profiles = await listProfiles();
      if (!profiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile '${profileName}' not found. Use /profile list to see available profiles.`,
        };
      }
    } catch {
      // Continue anyway, the dialog will show the error
    }

    return {
      type: 'dialog',
      dialog: 'profileEditor',
      dialogData: { profileName },
    };
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
    createCommand,
    deleteCommand,
    setDefaultCommand,
    listCommand,
    showCommand,
    editCommand,
  ],
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<MessageActionReturn> => ({
    type: 'message',
    messageType: 'info',
    content: `Profile management commands:
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
  }),
};
