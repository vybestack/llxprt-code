/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createExtensionsCommand } from '../ui/commands/extensionsCommand.js';
import { bindExtensionsCommand } from '../ui/commands/extensionsCommandHost.js';
import { createTodoCommand } from '../ui/commands/todoCommand.js';
import { createHooksCommand } from '../ui/commands/hooksCommand.js';
import { createTaskCommand } from '../ui/commands/tasksCommand.js';
import {
  bindHooksCommand,
  bindTaskCommand,
} from '../ui/commands/hookTaskCommandHost.js';
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
import { createCopyCommand } from '../ui/commands/copyCommand.js';
import { createCompressCommand } from '../ui/commands/compressCommand.js';
import { createDumpcontextCommand } from '../ui/commands/dumpcontextCommand.js';
import { createToolsCommand } from '../ui/commands/toolsCommand.js';
import { createDirectoryCommand } from '../ui/commands/directoryCommand.js';
import { createMemoryCommand } from '../ui/commands/memoryCommand.js';
import { createImageCommand } from '../ui/commands/imageCommand.js';
import { createBugCommand } from '../ui/commands/bugCommand.js';
import { bindBugCommand } from '../ui/commands/bugCommandHost.js';
import { createPoliciesCommand } from '../ui/commands/policiesCommand.js';
import { bindMcpCommand } from '../ui/commands/mcpCommandHost.js';
import {
  bindCopyCommandClipboard,
  bindCopyCommandHistoryRead,
} from '../ui/commands/copyCommandHost.js';

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
      bindMcpCommand(
        null,
        null,
        () => 0,
        () => {},
      ),
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
    compressCommand: createCompressCommand(async () => {
      throw new Error('Chat instance not available for compression.');
    }),
    restoreCommand: null,
    dumpcontextCommand: createDumpcontextCommand({
      dumpDirectory: '',
      readMode: () => undefined,
      writeMode: () => {
        throw new Error('Context dumping is unavailable.');
      },
      dumpNow: async () => ({
        type: 'message',
        messageType: 'error',
        content: 'Context dumping is unavailable.',
      }),
    }),
    copyCommand: createCopyCommand(
      bindCopyCommandHistoryRead(
        () => false,
        async () => [],
      ),
      bindCopyCommandClipboard(),
    ),
    toolsCommand: createToolsCommand(null, () => {}),
    ...unconfiguredWorkspaceCommands(),
    imageCommand: createImageCommand({
      workspaceRoot: undefined,
      runImageOperation: undefined,
      addItem: () => 0,
    }),
    bugCommand: createBugCommand(bindBugCommand(null, null, () => 0)),
    policiesCommand: createPoliciesCommand({ getPolicyInfo: () => null }),
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

function unconfiguredWorkspaceCommands() {
  return {
    extensionsCommand: createExtensionsCommand(
      bindExtensionsCommand(
        null,
        () => 0,
        () => {},
        () => {},
      ),
    ),
    todoCommand: createTodoCommand(null, () => 0),
    hooksCommand: createHooksCommand(bindHooksCommand(null, false), () => 0),
    taskCommand: createTaskCommand(bindTaskCommand(null), () => 0),
    directoryCommand: createDirectoryCommand({
      isConfigured: false,
      addDirectory: () => {
        throw new Error('Directory runtime is unavailable');
      },
      directories: () => [],
      getFolderTrust: () => false,
      isRestrictiveSandbox: () => false,
      refreshMemory: async () => ({ memoryContent: '', fileCount: 0 }),
      shouldLoadMemoryFromIncludeDirectories: () => false,
      addItem: () => {},
      setMemoryFileCount: () => {},
      addDirectoryContext: async () => {},
      recordDirectoriesChanged: () => {},
    }),
    memoryCommand: createMemoryCommand({
      isConfigured: false,
      getUserMemory: () => '',
      getLlxprtMdFileCount: () => 0,
      getLlxprtMdFilePaths: () => [],
      refreshMemory: async () => ({ memoryContent: '', fileCount: 0 }),
      updateSystemInstruction: async () => {},
      addItem: () => 0,
      setMemoryFileCount: () => {},
      saveCoreMemory: async () => {
        throw new Error('Core memory storage is unavailable.');
      },
    }),
  };
}
