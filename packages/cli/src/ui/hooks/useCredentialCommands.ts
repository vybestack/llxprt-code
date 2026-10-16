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
function useMcpOwnerCommand(
  mcp: Agent['mcp'] | undefined,
  isConfigured: boolean,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
): SlashCommand {
  const auth = useMcpAuthRegistration(
    mcp,
    isConfigured,
    settings,
    addItem,
    reloadCommands,
  );
  return useMcpRegistration(mcp, isConfigured, auth, addItem, reloadCommands);
}

function noProvider(): never {
  throw new Error(
    'Cannot switch provider: the interactive Agent is not available. Restart the session.',
  );
}

function useProviderSwitcher(
  switchProvider: Agent['setProvider'],
): Parameters<typeof useProviderCommand>[3] {
  return useMemo(
    () => (name, options) => switchProvider(name, undefined, options),
    [switchProvider],
  );
}

import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import {
  agentActiveProviderStatus,
  recordActiveProviderSwitch,
} from '../utils/recordActiveProviderSwitch.js';
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
  bindMcpAuthCommandOperations,
} from '../commands/credentialCommandHost.js';
import {
  createKeyCommand,
  type KeyCommandOperations,
} from '../commands/keyCommand.js';
import { createKeyfileCommand } from '../commands/keyfileCommand.js';
import { createLogoutCommand } from '../commands/logoutCommand.js';
import { useQuotaCommand } from './useQuotaCommand.js';
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
        bindProfileCommandOperations(
          () =>
            agent === null
              ? api.listSavedProfiles()
              : agent.workspace.profileDefinitions.listProfiles(),
          () => agent?.getProvider() ?? api.providerStatus().providerName,
          oauthControl.listBuckets.bind(oauthControl),
          () => settings.merged.enableFuzzyFiltering ?? true,
          agent === null
            ? api.saveProfileSnapshot.bind(api)
            : agent.saveProfileSnapshot.bind(agent),
          api.listSavedProfiles.bind(api),
          api.getEphemeralSettings.bind(api),
          api.saveLoadBalancerProfile.bind(api),
          async (name) => {
            if (agent === null)
              throw new Error(
                'Agent unavailable. Restart before loading a profile.',
              );
            return agent.profiles.load(name);
          },
          async () => {
            if (agent !== null) await agent.mcp.refresh();
          },
          (result, loaded, reportFailure) => {
            if (agent === null) throw new Error('Session agent is unavailable');
            return recordActiveProviderSwitch(
              { recordProviderSwitch },
              agentActiveProviderStatus(
                agent.getProvider.bind(agent),
                agent.getModel.bind(agent),
              ),
              reportFailure,
              {
                providerName: result.providerName,
                modelName: loaded.modelName,
              },
            );
          },
          async (name) => {
            if (agent === null) await api.deleteProfileByName(name);
            else await agent.deleteProfileByName(name);
          },
          async (name) => {
            if (agent === null) api.setDefaultProfileName(name);
            else agent.setDefaultProfileName(name);
            settings.setValue(
              SettingScope.User,
              'defaultProfile',
              name ?? undefined,
            );
          },
        ),
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
  refreshAliases: () => Promise<void>,
): CredentialCommands {
  const api = useRuntimeApi();
  const oauthControl = useOAuthControl();
  const recordSwitch = useSwitch(agent?.session, rawRecording, recordingOwner);

  return useMemoCredentialRegistry({
    ...useModelSelectionCommands(
      useBound(api, api.setActiveModel),
      useBound(api, api.getActiveToolFormatState),
      useBound(api, api.setActiveToolFormatOverride),
      recordSwitch,
    ),
    providerCommand: useProviderCommand(
      useBound(api, api.getActiveProviderName),
      useBound(api, api.providerStatus),
      useBound(api, api.getActiveModelName),
      useProviderSwitcher(useBound(agent, agent?.setProvider ?? noProvider)),
      useBound(api, api.getActiveProviderAliasConfig),
      refreshAliases,
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
      useBound(agent?.auth, agent?.auth.status ?? unavailableProvider),
      useBound(agent?.auth, agent?.auth.logout ?? unavailableProvider),
      useBound(oauthControl, oauthControl.logout),
      agent !== null,
      useBound(oauthControl, oauthControl.getSupportedProviders),
      useBound(oauthControl, oauthControl.isAuthenticated),
    ),
    keyfileCommand: useKeyfileRegistration(
      useBound(api, api.providerStatus),
      useBound(api, api.updateActiveProviderApiKey),
      useBound(api, api.setEphemeralSetting),
      useBound(settings, settings.setProviderKeyfile),
      useBound(settings, settings.removeProviderKeyfile),
    ),
    keyCommand: useKeyRegistration(
      useKeyOwnerBound(config, config?.getProviderKeys),
      useKeyOwnerBound(config, config?.listKeyCompletionNames),
      useKeyOwnerBound(config, config?.invalidateKeyCompletion),
      useBound(config, config?.isInteractive ?? isInteractiveBeforeBootstrap),
      useBound(api, api.providerStatus),
      useBound(api, api.updateActiveProviderApiKey),
      useKeyOwnerBound(config, config?.setEphemeralSetting),
    ),
    authCommand: useAuthOwnerCommand(oauthControl, settings),
    quotaCommand: useQuotaCommand(),
    mcpCommand: useMcpOwnerCommand(
      agent?.mcp,
      config !== null,
      settings,
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
  mcp: Agent['mcp'] | undefined,
  isConfigured: boolean,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
): SlashCommand {
  return useMemo(
    () =>
      createMcpAuthCommand(
        bindMcpAuthCommandOperations(
          () =>
            (mcp?.listServers() ?? []).map((server) => ({
              name: server.name,
              oauthEnabled: server.config.oauth?.enabled === true,
            })),
          async () =>
            mcp === undefined
              ? []
              : (await mcp.details()).servers
                  .filter((server) => server.requiresAuth)
                  .map((server) => server.name),
          async (name, display) => {
            if (mcp === undefined) throw new Error('Agent is not available.');
            await mcp.authenticate(name, display);
          },
          () => isConfigured,
        ),
        () => settings.merged.enableFuzzyFiltering ?? true,
        addItem,
        reloadCommands,
      ),
    [mcp, isConfigured, settings, addItem, reloadCommands],
  );
}

function useKeyfileRegistration(
  readStatus: ReturnType<typeof useRuntimeApi>['providerStatus'],
  updateKey: Parameters<typeof bindKeyfileCommandOperations>[1],
  writeSetting: Parameters<typeof bindKeyfileCommandOperations>[2],
  remember: Parameters<typeof bindKeyfileCommandOperations>[3],
  forget: Parameters<typeof bindKeyfileCommandOperations>[4],
): SlashCommand {
  return useMemo(
    () =>
      createKeyfileCommand(
        bindKeyfileCommandOperations(
          () => readStatus().providerName ?? null,
          updateKey,
          writeSetting,
          remember,
          forget,
        ),
      ),
    [readStatus, updateKey, writeSetting, remember, forget],
  );
}

function useKeyRegistration(
  providerKeys: KeyCommandOperations['providerKeys'],
  listNames: KeyCommandOperations['listKeyCompletionNames'],
  invalidate: KeyCommandOperations['invalidateKeyCompletion'],
  isInteractive: KeyCommandOperations['isInteractive'],
  readStatus: ReturnType<typeof useRuntimeApi>['providerStatus'],
  updateKey: KeyCommandOperations['updateActiveProviderApiKey'],
  setEphemeral: KeyCommandOperations['setEphemeralSetting'],
): SlashCommand {
  return useMemo(
    () =>
      createKeyCommand(
        bindKeyCommandOperations(
          providerKeys,
          listNames,
          invalidate,
          isInteractive,
          () => readStatus().providerName ?? null,
          updateKey,
          setEphemeral,
        ),
      ),
    [
      providerKeys,
      listNames,
      invalidate,
      isInteractive,
      readStatus,
      updateKey,
      setEphemeral,
    ],
  );
}

function missingKeyOwner(): never {
  throw new Error('Key commands require an explicit credential owner');
}

function isInteractiveBeforeBootstrap(): boolean {
  return true;
}

function useKeyOwnerBound<Owner, Args extends unknown[], Result>(
  owner: Owner,
  operation: ((this: Owner, ...args: Args) => Result) | undefined,
): (...args: Args) => Result {
  return useMemo(
    () => (operation === undefined ? missingKeyOwner : operation.bind(owner)),
    [owner, operation],
  );
}
