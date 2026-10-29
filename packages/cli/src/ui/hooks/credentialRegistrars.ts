/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ProviderStatusOperation } from '../contexts/RuntimeContext.js';

import type { Agent } from '@vybestack/llxprt-code-agents';
import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import { createAuthCommand } from '../commands/authCommand.js';
import { createBaseurlCommand } from '../commands/baseurlCommand.js';
import {
  bindBaseurlCommandOperations,
  bindKeyCommandOperations,
  bindKeyfileCommandOperations,
  bindLogoutCommandOperations,
  bindMcpAuthCommandOperations,
} from '../commands/credentialCommandHost.js';
import {
  createKeyCommand,
  type KeyCommandOperations,
} from '../commands/keyCommand.js';
import { createKeyfileCommand } from '../commands/keyfileCommand.js';
import { createLogoutCommand } from '../commands/logoutCommand.js';
import {
  type McpAuthOutput,
  createMcpAuthCommand,
} from '../commands/mcpAuth.js';
import { createMcpCommand } from '../commands/mcpCommand.js';
import { bindMcpCommand } from '../commands/mcpCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { createToolkeyCommand } from '../commands/toolkeyCommand.js';
import { createToolkeyfileCommand } from '../commands/toolkeyfileCommand.js';
import type { useOAuthControl } from '../contexts/OAuthControlContext.js';

export function createMcpOwnerCommand(
  listServers: Agent['mcp']['listServers'] | null,
  listBlockedServers: Agent['mcp']['listBlockedServers'],
  discoveryState: Agent['mcp']['discoveryState'],
  details: Agent['mcp']['details'],
  authenticate: Agent['mcp']['authenticate'],
  reload: Agent['mcp']['reload'],
  refresh: Agent['mcp']['refresh'],
  isConfigured: boolean,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  writeOutput: McpAuthOutput,
  reloadCommands: () => void,
): SlashCommand {
  const auth = createMcpAuthCommand(
    bindMcpAuthCommandOperations(
      () =>
        (listServers?.() ?? []).map((server) => ({
          name: server.name,
          oauthEnabled: server.config.oauth?.enabled === true,
        })),
      async () =>
        listServers === null
          ? []
          : (await details()).servers
              .filter((server) => server.requiresAuth)
              .map((server) => server.name),
      async (name, display) => {
        await authenticate(name, display);
      },
      () => isConfigured,
    ),
    () => settings.merged.enableFuzzyFiltering ?? true,
    writeOutput,
    reloadCommands,
  );
  return createMcpCommand(
    auth,
    bindMcpCommand(
      isConfigured,
      listServers === null
        ? null
        : {
            listServers,
            listBlockedServers,
            discoveryState,
            readDetails: () =>
              details({
                includeTools: true,
                includePrompts: true,
                includeResources: true,
              }),
          },
      addItem,
      reloadCommands,
      reload,
      refresh,
    ),
  );
}

export function createToolkeyCommands() {
  const storage = new ToolKeyStorage();
  return {
    toolkeyCommand: createToolkeyCommand(storage),
    toolkeyfileCommand: createToolkeyfileCommand(storage),
  };
}

export function createAuthOwnerCommand(
  oauthControl: ReturnType<typeof useOAuthControl>,
  settings: LoadedSettings,
): SlashCommand {
  return createAuthCommand(
    oauthControl,
    () => settings.merged.enableFuzzyFiltering ?? true,
  );
}

export function createBaseurlRegistration(
  readProvider: Agent['getProvider'],
  writeBaseUrl: Agent['auth']['setBaseUrl'],
): SlashCommand {
  return createBaseurlCommand(
    bindBaseurlCommandOperations(readProvider, writeBaseUrl),
  );
}

export function createLogoutRegistration(
  listProviders: Agent['listProviders'],
  readStatus: Agent['auth']['status'],
  logout: (provider: string) => Promise<void>,
): SlashCommand {
  return createLogoutCommand(
    bindLogoutCommandOperations(
      () => listProviders().map((provider) => provider.name),
      (provider) => readStatus(provider) === 'authenticated',
      logout,
      'Supported',
    ),
  );
}

export function createKeyfileRegistration(
  readStatus: ProviderStatusOperation,
  updateKey: Parameters<typeof bindKeyfileCommandOperations>[1],
  writeSetting: Parameters<typeof bindKeyfileCommandOperations>[2],
  remember: Parameters<typeof bindKeyfileCommandOperations>[3],
  forget: Parameters<typeof bindKeyfileCommandOperations>[4],
): SlashCommand {
  return createKeyfileCommand(
    bindKeyfileCommandOperations(
      () => readStatus().providerName ?? null,
      updateKey,
      writeSetting,
      remember,
      forget,
    ),
  );
}

export function createKeyRegistration(
  providerKeys: KeyCommandOperations['providerKeys'],
  listNames: KeyCommandOperations['listKeyCompletionNames'],
  invalidate: KeyCommandOperations['invalidateKeyCompletion'],
  isInteractive: KeyCommandOperations['isInteractive'],
  readStatus: ProviderStatusOperation,
  updateKey: KeyCommandOperations['updateActiveProviderApiKey'],
  setEphemeral: KeyCommandOperations['setEphemeralSetting'],
): SlashCommand {
  return createKeyCommand(
    bindKeyCommandOperations(
      providerKeys,
      listNames,
      invalidate,
      isInteractive,
      () => readStatus().providerName ?? null,
      updateKey,
      setEphemeral,
    ),
  );
}
