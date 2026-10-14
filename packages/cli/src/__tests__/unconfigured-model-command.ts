/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createModelCommand } from '../ui/commands/modelCommand.js';
import { createSetCommand } from '../ui/commands/setCommand.js';
import { createProviderCommand } from '../ui/commands/providerCommand.js';
import { createBaseurlCommand } from '../ui/commands/baseurlCommand.js';
import { createKeyCommand } from '../ui/commands/keyCommand.js';
import { createKeyfileCommand } from '../ui/commands/keyfileCommand.js';
import { createLogoutCommand } from '../ui/commands/logoutCommand.js';
import {
  createAuthCommand,
  type AuthCommandOperations,
} from '../ui/commands/authCommand.js';
import type { QuotaCommandOperations } from '../ui/commands/quotaCommand.js';
import { createQuotaCommand } from '../ui/commands/quotaCommand.js';
import { createMcpAuthCommand } from '../ui/commands/mcpAuth.js';
import { createMcpCommand } from '../ui/commands/mcpCommand.js';
import { createToolkeyCommand } from '../ui/commands/toolkeyCommand.js';
import { createToolkeyfileCommand } from '../ui/commands/toolkeyfileCommand.js';
import type { BuiltinCommandOwners } from '../services/BuiltinCommandLoader.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { createToolFormatCommand } from '../ui/commands/toolformatCommand.js';
import { createProfileCommand } from '../ui/commands/profileCommand.js';
import { createProfileSchemas } from '../ui/commands/profileSchemas.js';
import { createChatOwnerCommand } from '../ui/commands/chatOwnerCommand.js';
import { createContinueCommand } from '../ui/commands/continueCommand.js';

export function createUnconfiguredModelCommand(): SlashCommand {
  return createModelCommand(
    async () => {
      throw new Error(
        'Model selection is unavailable in this registry fixture',
      );
    },
    async () => {
      throw new Error('Recording is unavailable in this registry fixture');
    },
  );
}

export function createUnconfiguredToolFormatCommand(): SlashCommand {
  return createToolFormatCommand(
    async () => {
      throw new Error(
        'Tool-format reads are unavailable in this registry fixture',
      );
    },
    async () => {
      throw new Error(
        'Tool-format writes are unavailable in this registry fixture',
      );
    },
  );
}

export function createUnconfiguredSetCommand(): SlashCommand {
  const unavailable = (): never => {
    throw new Error('Set operations are unavailable in this registry fixture');
  };
  return createSetCommand({
    getEphemeralSettings: unavailable,
    setEphemeralSetting: unavailable,
    getActiveModelParams: unavailable,
    setActiveModelParam: unavailable,
    clearActiveModelParam: unavailable,
    isFuzzyFilteringEnabled: () => false,
  });
}

export function createUnconfiguredProviderCommand(): SlashCommand {
  const unavailable = (): never => {
    throw new Error(
      'Provider operations are unavailable in this registry fixture',
    );
  };
  return createProviderCommand({
    getActiveProviderName: unavailable,
    getActiveModelName: unavailable,
    switchProvider: unavailable,
    recordProviderSwitch: unavailable,
    resolveActiveProviderAliasConfig: unavailable,
    writeProviderAlias: unavailable,
    refreshProviderAliases: unavailable,
  });
}

export function unavailableAuthControl(): AuthCommandOperations {
  const unavailable = (): never => {
    throw new Error('Auth operations are unavailable in this registry fixture');
  };
  return {
    getInteractiveAuthSessions: unavailable,
    cancelInteractiveAuth: unavailable,
    getSupportedProviders: unavailable,
    listBuckets: unavailable,
    isOAuthEnabled: unavailable,
    isAuthenticated: unavailable,
    peekStoredToken: unavailable,
    getHigherPriorityAuth: unavailable,
    toggleOAuthEnabled: unavailable,
    authenticate: unavailable,
    activateNamedLoginBucket: unavailable,
    logoutAllBuckets: unavailable,
    logout: unavailable,
    clearSessionBucket: unavailable,
    getAuthStatusWithBuckets: unavailable,
    setSessionBucket: unavailable,
    getAuthStatus: unavailable,
    clearBrowserProfileAssociation: unavailable,
    setBrowserProfileAssociation: unavailable,
    inspectAuthLock: unavailable,
    forceRecoverAuthLock: unavailable,
    recoverAuthLock: unavailable,
    clearProviderClientCache: unavailable,
  };
}

export function unavailableQuotaOAuthControl(): QuotaCommandOperations['oauthControl'] {
  const unavailable = (): never => {
    throw new Error(
      'Quota operations are unavailable in this registry fixture',
    );
  };
  return {
    isAvailable: unavailable,
    getAllCodexRateLimitResetCredits: unavailable,
    hasCodexToken: unavailable,
    listBuckets: unavailable,
    readCodexBucketToken: unavailable,
  };
}

export function createUnconfiguredCredentialCommands(): Pick<
  BuiltinCommandOwners,
  | 'keyCommand'
  | 'keyfileCommand'
  | 'baseurlCommand'
  | 'logoutCommand'
  | 'toolkeyCommand'
  | 'toolkeyfileCommand'
  | 'authCommand'
  | 'quotaCommand'
  | 'mcpCommand'
> {
  const unavailable = (): never => {
    throw new Error(
      'Credential operations are unavailable in this registry fixture',
    );
  };
  return {
    keyCommand: createKeyCommand({
      providerKeys: unavailable,
      listKeyCompletionNames: unavailable,
      invalidateKeyCompletion: unavailable,
      isInteractive: unavailable,
      activeProviderName: unavailable,
      updateActiveProviderApiKey: unavailable,
      setEphemeralSetting: unavailable,
      schedulePaymentModeCheck: unavailable,
    }),
    keyfileCommand: createKeyfileCommand({
      activeProviderName: unavailable,
      updateActiveProviderApiKey: unavailable,
      setEphemeralSetting: unavailable,
      rememberProviderKeyfile: unavailable,
      forgetProviderKeyfile: unavailable,
      schedulePaymentModeCheck: unavailable,
    }),
    baseurlCommand: createBaseurlCommand({
      activeProviderName: unavailable,
      updateBaseUrl: unavailable,
    }),
    logoutCommand: createLogoutCommand({ logout: unavailable }),
    authCommand: createAuthCommand(unavailableAuthControl()),
    quotaCommand: createQuotaCommand({
      oauthControl: unavailableQuotaOAuthControl(),
      fetch: unavailable,
      baseUrlSetting: unavailable,
      fetchQuotaLines: unavailable,
    }),
    mcpCommand: createMcpCommand(
      createMcpAuthCommand({
        isConfigured: () => false,
        configuredServers: () => [],
        authenticationRequiredServers: async () => [],
        authenticate: unavailable,
      }),
    ),
    toolkeyCommand: createToolkeyCommand({
      getKey: unavailable,
      saveKey: unavailable,
      deleteKey: unavailable,
    }),
    toolkeyfileCommand: createToolkeyfileCommand({
      getKeyfilePath: unavailable,
      setKeyfilePath: unavailable,
      clearKeyfilePath: unavailable,
    }),
  };
}
function createUnconfiguredProfileCommand() {
  const unavailable = async (): Promise<never> => {
    throw new Error('Profile command is unavailable');
  };
  return createProfileCommand({
    schemas: createProfileSchemas({
      listProfiles: async () => [],
      getActiveProviderName: () => undefined,
      listBuckets: async () => [],
    }),
    saveModelProfile: unavailable,
    saveLoadBalancerProfile: unavailable,
    loadProfile: unavailable,
    publishLoadedProfile: async () => {},
    recordProviderSwitch: async () => {},
    deleteProfile: unavailable,
    listProfiles: async () => [],
    setDefaultProfileName: async () => {},
  });
}

export function createUnconfiguredChatCommand(): SlashCommand {
  const unavailable = (): never => {
    throw new Error('Chat operations are unavailable in this registry fixture');
  };
  return createChatOwnerCommand({
    listCheckpoints: unavailable,
    createCheckpoint: unavailable,
    resume: unavailable,
    deleteCheckpoint: unavailable,
    renameCheckpoint: unavailable,
    getHistory: unavailable,
    clearHistory: unavailable,
    restoreTurns: unavailable,
    nameCurrentSession: unavailable,
    getRecordingPath: unavailable,
    getModel: unavailable,
    getEmojiFilterMode: unavailable,
  });
}

export function createUnconfiguredBuiltinOwners(): BuiltinCommandOwners {
  return {
    chatCommand: createUnconfiguredChatCommand(),
    continueCommand: createContinueCommand({
      isInteractive: () => false,
      listContinueTargets: async () => [],
      exportSession: async () => {
        throw new Error(
          'Session export is unavailable in this registry fixture',
        );
      },
      validateSessionPackage: async () => {
        throw new Error(
          'Package import is unavailable in this registry fixture',
        );
      },
    }),
    modelCommand: createUnconfiguredModelCommand(),
    toolFormatCommand: createUnconfiguredToolFormatCommand(),
    setCommand: createUnconfiguredSetCommand(),
    providerCommand: createUnconfiguredProviderCommand(),
    profileCommand: createUnconfiguredProfileCommand(),
    ...createUnconfiguredCredentialCommands(),
  };
}
