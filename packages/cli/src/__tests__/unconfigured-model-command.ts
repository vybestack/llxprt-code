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
import { createToolkeyCommand } from '../ui/commands/toolkeyCommand.js';
import { createToolkeyfileCommand } from '../ui/commands/toolkeyfileCommand.js';
import type { BuiltinCommandOwners } from '../services/BuiltinCommandLoader.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { createToolFormatCommand } from '../ui/commands/toolformatCommand.js';

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

export function createUnconfiguredCredentialCommands(): Pick<
  BuiltinCommandOwners,
  | 'keyCommand'
  | 'keyfileCommand'
  | 'baseurlCommand'
  | 'logoutCommand'
  | 'toolkeyCommand'
  | 'toolkeyfileCommand'
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

export function createUnconfiguredBuiltinOwners(): BuiltinCommandOwners {
  return {
    modelCommand: createUnconfiguredModelCommand(),
    toolFormatCommand: createUnconfiguredToolFormatCommand(),
    setCommand: createUnconfiguredSetCommand(),
    providerCommand: createUnconfiguredProviderCommand(),
    ...createUnconfiguredCredentialCommands(),
  };
}
