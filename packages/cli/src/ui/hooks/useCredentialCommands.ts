import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import { useSwitch } from './useProviderSwitchRecording.js';
import { useProviderCommand } from './useProviderCommand.js';
import { useModelSelectionCommands } from './useModelSelectionCommands.js';
import { useBound } from './agentStream/useStreamOwnerCallbacks.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { SlashCommand } from '../commands/types.js';
import { createAuthCommand } from '../commands/authCommand.js';
import { createBaseurlCommand } from '../commands/baseurlCommand.js';
import {
  bindBaseurlCommandOperations,
  bindKeyCommandOperations,
  bindKeyfileCommandOperations,
  bindLogoutCommandOperations,
  bindQuotaCommandOperations,
  bindMcpAuthCommandOperations,
} from '../commands/credentialCommandHost.js';
import { createKeyCommand } from '../commands/keyCommand.js';
import { createKeyfileCommand } from '../commands/keyfileCommand.js';
import { createLogoutCommand } from '../commands/logoutCommand.js';
import { createQuotaCommand } from '../commands/quotaCommand.js';
import { createMcpAuthCommand } from '../commands/mcpAuth.js';
import { createMcpCommand } from '../commands/mcpCommand.js';
import { bindMcpCommand } from '../commands/mcpCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { createProfileCommand } from '../commands/profileCommand.js';
import { bindProfileCommandOperations } from '../commands/profileCommandHost.js';
import { createToolkeyCommand } from '../commands/toolkeyCommand.js';
import { createToolkeyfileCommand } from '../commands/toolkeyfileCommand.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

type CredentialCommands = Pick<
  BuiltinCommandOwners,
  | 'modelCommand'
  | 'toolFormatCommand'
  | 'providerCommand'
  | 'baseurlCommand'
  | 'logoutCommand'
  | 'keyfileCommand'
  | 'keyCommand'
  | 'toolkeyCommand'
  | 'toolkeyfileCommand'
  | 'authCommand'
  | 'quotaCommand'
  | 'mcpCommand'
  | 'profileCommand'
>;

function createToolkeyCommands() {
  const storage = new ToolKeyStorage();
  return {
    toolkeyCommand: createToolkeyCommand(storage),
    toolkeyfileCommand: createToolkeyfileCommand(storage),
  };
}

function useProfileOwnerCommand(
  agent: Agent | null,
  api: ReturnType<typeof useRuntimeApi>,
  settings: LoadedSettings,
  oauthControl: ReturnType<typeof useOAuthControl>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
) {
  return useMemo(
    () =>
      createProfileCommand(
        bindProfileCommandOperations({
          agent,
          runtimeApi: api,
          settings,
          oauthControl,
          recordProviderSwitch,
        }),
      ),
    [agent, api, settings, oauthControl, recordProviderSwitch],
  );
}

/**
 * Registers the credential commands for one session, each bound to the
 * operations it uses. Memoised so the registered command identities stay stable
 * while their owners do.
 */
export function useCredentialCommands(
  agent: Agent | null,
  settings: LoadedSettings,
  config: CliUiRuntime | null,
  rawRecording: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
  refreshProviderAliases: () => Promise<void>,
): CredentialCommands {
  const api = useRuntimeApi();
  const oauthControl = useOAuthControl();
  const recordSwitch = useSwitch(agent?.session, rawRecording, recordingOwner);

  const auth = agent?.auth;

  return useMemoCredentialRegistry({
    ...useModelSelectionCommands(
      useBound(api, api.setActiveModel),
      useBound(api, api.getActiveToolFormatState),
      useBound(api, api.setActiveToolFormatOverride),
      recordSwitch,
    ),
    providerCommand: useProviderCommand(
      agent,
      refreshProviderAliases,
      recordSwitch,
    ),
    baseurlCommand: useBaseurlRegistration(
      useBound(agent, agent?.getProvider ?? unavailableProvider),
      useBound(agent?.auth, agent?.auth.setBaseUrl ?? unavailableProvider),
      agent !== null,
      useBound(api, api.providerStatus),
      useBound(api, api.updateActiveProviderBaseUrl),
    ),
    logoutCommand: useLogoutRegistration(
      useBound(agent, agent?.listProviders ?? unavailableProvider),
      useBound(auth, auth?.status ?? unavailableProvider),
      useBound(auth, auth?.logout ?? unavailableProvider),
      useBound(oauthControl, oauthControl.logout),
      agent !== null,
      useBound(oauthControl, oauthControl.getSupportedProviders),
      useBound(oauthControl, oauthControl.isAuthenticated),
    ),
    keyfileCommand: useMemo(
      () => createKeyfileCommand(bindKeyfileCommandOperations(api, settings)),
      [api, settings],
    ),
    keyCommand: useMemo(
      () => createKeyCommand(bindKeyCommandOperations(api, config)),
      [api, config],
    ),
    authCommand: useAuthOwnerCommand(oauthControl, settings),
    quotaCommand: useMemo(
      () => createQuotaCommand(bindQuotaCommandOperations(api, oauthControl)),
      [api, oauthControl],
    ),
    mcpCommand: useMcpRegistration(
      agent?.mcp,
      config !== null,
      useMcpAuthRegistration(
        useMemo(
          () => bindMcpAuthCommandOperations(agent, config),
          [agent, config],
        ),
        settings,
        addItem,
        reloadCommands,
      ),
      addItem,
      reloadCommands,
    ),
    profileCommand: useProfileOwnerCommand(
      agent,
      api,
      settings,
      oauthControl,
      recordSwitch,
    ),
    ...useMemo(createToolkeyCommands, []),
  });
}

function useAuthOwnerCommand(
  oauthControl: ReturnType<typeof useOAuthControl>,
  settings: LoadedSettings,
): SlashCommand {
  return useMemo(
    () =>
      createAuthCommand(
        oauthControl,
        () => settings.merged.enableFuzzyFiltering ?? true,
      ),
    [oauthControl, settings],
  );
}

function useMemoCredentialRegistry(
  commands: CredentialCommands,
): CredentialCommands {
  const {
    modelCommand,
    toolFormatCommand,
    providerCommand,
    baseurlCommand,
    logoutCommand,
    keyfileCommand,
    keyCommand,
    authCommand,
    quotaCommand,
    mcpCommand,
    profileCommand,
    toolkeyCommand,
    toolkeyfileCommand,
  } = commands;
  return useMemo(
    () => ({
      modelCommand,
      toolFormatCommand,
      providerCommand,
      baseurlCommand,
      logoutCommand,
      keyfileCommand,
      keyCommand,
      authCommand,
      quotaCommand,
      mcpCommand,
      profileCommand,
      toolkeyCommand,
      toolkeyfileCommand,
    }),
    [
      modelCommand,
      toolFormatCommand,
      providerCommand,
      baseurlCommand,
      logoutCommand,
      keyfileCommand,
      keyCommand,
      authCommand,
      quotaCommand,
      mcpCommand,
      profileCommand,
      toolkeyCommand,
      toolkeyfileCommand,
    ],
  );
}

function useMcpRegistration(
  mcp: Agent['mcp'] | undefined,
  isConfigured: boolean,
  auth: SlashCommand,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
): SlashCommand {
  return useMemo(
    () =>
      createMcpCommand(
        auth,
        bindMcpCommand(
          isConfigured,
          mcp === undefined
            ? null
            : {
                listServers: () => mcp.listServers(),
                listBlockedServers: () => mcp.listBlockedServers(),
                discoveryState: () => mcp.discoveryState(),
                readDetails: () =>
                  mcp.details({
                    includeTools: true,
                    includePrompts: true,
                    includeResources: true,
                  }),
              },
          addItem,
          reloadCommands,
          async () => {
            if (mcp === undefined)
              throw new Error('Session agent is unavailable');
            await mcp.reload();
          },
          async () => {
            if (mcp === undefined)
              throw new Error('Session agent is unavailable');
            await mcp.refresh();
          },
        ),
      ),
    [mcp, isConfigured, auth, addItem, reloadCommands],
  );
}

function unavailableProvider(): never {
  throw new Error('Session agent is unavailable');
}

function useBaseurlRegistration(
  readProvider: Agent['getProvider'],
  writeBaseUrl: Agent['auth']['setBaseUrl'],
  hasAgent: boolean,
  readBootstrapStatus: ReturnType<typeof useRuntimeApi>['providerStatus'],
  updateBootstrapBaseUrl: ReturnType<
    typeof useRuntimeApi
  >['updateActiveProviderBaseUrl'],
): SlashCommand {
  return useMemo(
    () =>
      createBaseurlCommand(
        hasAgent
          ? bindBaseurlCommandOperations(readProvider, writeBaseUrl)
          : {
              activeProviderName: () =>
                readBootstrapStatus().providerName ?? 'unknown',
              updateBaseUrl: async (baseUrl) =>
                (await updateBootstrapBaseUrl(baseUrl)).message,
            },
      ),
    [
      readProvider,
      writeBaseUrl,
      hasAgent,
      readBootstrapStatus,
      updateBootstrapBaseUrl,
    ],
  );
}

function useLogoutRegistration(
  listProviders: Agent['listProviders'],
  readStatus: Agent['auth']['status'],
  logout: (provider: string) => Promise<void>,
  bootstrapLogout: (provider: string) => Promise<void>,
  hasAgent: boolean,
  listBootstrapProviders: ReturnType<
    typeof useOAuthControl
  >['getSupportedProviders'],
  readBootstrapStatus: ReturnType<typeof useOAuthControl>['isAuthenticated'],
): SlashCommand {
  return useMemo(
    () =>
      createLogoutCommand(
        bindLogoutCommandOperations(
          hasAgent
            ? () => listProviders().map((provider) => provider.name)
            : listBootstrapProviders,
          hasAgent
            ? (provider) => readStatus(provider) === 'authenticated'
            : readBootstrapStatus,
          hasAgent ? logout : bootstrapLogout,
          hasAgent ? 'Supported' : 'Supported providers',
        ),
      ),
    [
      listProviders,
      readStatus,
      logout,
      bootstrapLogout,
      hasAgent,
      listBootstrapProviders,
      readBootstrapStatus,
    ],
  );
}

function useMcpAuthRegistration(
  operations: ReturnType<typeof bindMcpAuthCommandOperations>,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
): SlashCommand {
  return useMemo(
    () =>
      createMcpAuthCommand(
        operations,
        () => settings.merged.enableFuzzyFiltering ?? true,
        addItem,
        reloadCommands,
      ),
    [operations, settings, addItem, reloadCommands],
  );
}
