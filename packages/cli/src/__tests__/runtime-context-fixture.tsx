/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  NetworkFetch,
  ModelChangeResult,
  ApiKeyUpdateResult,
  BaseUrlUpdateResult,
} from '@vybestack/llxprt-code-core';
import type React from 'react';
import * as Operations from '../ui/contexts/RuntimeContext.js';
import type { RuntimeProfileAgent } from './runtime-profile-agent-fixture.js';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import type {
  Agent,
  AgentProfileDefinitions,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
  SessionProviderReads,
  createProviderInspection,
} from '@vybestack/llxprt-code-agents';

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 4-10
 * React bridge that binds UI runtime operations to its Agent and owner features.
 */
type RuntimeFunctions = ReturnType<typeof createProviderInspection> &
  AgentProfileDefinitions &
  Pick<
    SessionProviderReads,
    | 'listProviders'
    | 'getActiveProviderName'
    | 'listAvailableModels'
    | 'getActiveModelName'
    | 'providerStatus'
    | 'getUnallowedParametersForActiveModel'
    | 'getActiveProviderMetrics'
    | 'getSessionTokenUsage'
  > & {
    getEphemeralSettings: () => Readonly<Record<string, unknown>>;
    setEphemeralSetting: (key: string, value: unknown) => void;
    getActiveToolFormatState: () => ReturnType<Agent['toolFormat']['getState']>;
    setActiveToolFormatOverride: (
      format: Parameters<Agent['toolFormat']['setOverride']>[0],
    ) => ReturnType<Agent['toolFormat']['setOverride']>;
    getEphemeralSetting: (key: string) => unknown;
    getSessionSetting: (key: string) => unknown;
    setSessionSetting: (key: string, value: unknown) => void;
    clearSessionSetting: (key: string) => void;
  };

type AgentSetProvider = (
  provider: string,
  model?: string,
  options?: AgentProviderSwitchOptions,
) => Promise<AgentProviderSwitchResult>;

type ProfileRuntimeApi = Pick<
  Agent,
  | 'getActiveProfileName'
  | 'setDefaultProfileName'
  | 'getRuntimeDiagnosticsSnapshot'
  | 'saveProfileSnapshot'
  | 'deleteProfileByName'
>;

export type RuntimeOwnerFeatures = RuntimeFunctions & {
  setActiveModel: (model: string) => Promise<ModelChangeResult>;
  getActiveModelParams: () => ReturnType<
    SessionProviderReads['getActiveModelParams']
  >;
  setActiveModelParam: (key: string, value: unknown) => void;
  clearActiveModelParam: (key: string) => void;
  updateActiveProviderApiKey: (
    key: string | null,
  ) => Promise<ApiKeyUpdateResult>;
  getWorkspaceDirectories: () => readonly string[];
  getDefaultProfileName: () => string | null;
  getOpenAIProviderInfo: () => ReturnType<
    SessionProviderReads['readOpenAIInfo']
  >;
};

export type RuntimeApi = RuntimeOwnerFeatures &
  ProfileRuntimeApi & {
    fetch: NetworkFetch;
    setProvider: AgentSetProvider;
    loadProfileByName: (name: string) => ReturnType<Agent['profiles']['load']>;
    updateActiveProviderBaseUrl: (
      url: string | null,
    ) => Promise<BaseUrlUpdateResult>;
  };

interface RuntimeContextBridge {
  runtimeId: string;
  api: RuntimeApi;
}

const RuntimeContext = createContext<RuntimeContextBridge | null>(null);

function makeBaseUrlUpdater(
  agent: RuntimeProfileAgent,
): RuntimeApi['updateActiveProviderBaseUrl'] {
  return async (url) => {
    await agent.auth.setBaseUrl(url);
    const providerName = agent.getProvider();
    const trimmed = url?.trim();
    const baseUrl = trimmed?.toLowerCase() === 'none' ? undefined : trimmed;
    return {
      changed: true,
      providerName,
      baseUrl: baseUrl === '' ? undefined : baseUrl,
      message: baseUrl
        ? `Base URL updated to '${baseUrl}' for provider '${providerName}'.`
        : `Base URL cleared; provider '${providerName}' now uses the default endpoint.`,
    };
  };
}

function makeRuntimeApi(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
  requestFetch: NetworkFetch,
): RuntimeApi {
  return {
    ...owner,
    fetch: requestFetch,
    setProvider: (provider, model, options) =>
      agent.setProvider(provider, model, options),
    getActiveProfileName: () => agent.getActiveProfileName(),
    setDefaultProfileName: (name) => agent.setDefaultProfileName(name),
    getRuntimeDiagnosticsSnapshot: () => agent.getRuntimeDiagnosticsSnapshot(),
    saveProfileSnapshot: (name, additional) =>
      agent.saveProfileSnapshot(name, additional),
    deleteProfileByName: (name) => agent.deleteProfileByName(name),
    loadProfileByName: (name) => agent.profiles.load(name),
    updateActiveProviderBaseUrl: makeBaseUrlUpdater(agent),
  };
}

function createBridge(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
  requestFetch: NetworkFetch,
): RuntimeContextBridge {
  return {
    runtimeId: agent.getRuntimeId(),
    api: makeRuntimeApi(agent, owner, requestFetch),
  };
}

export interface RuntimeContextProviderProps {
  agent: RuntimeProfileAgent;
  owner: RuntimeOwnerFeatures;
  requestFetch: NetworkFetch;
}

export const RuntimeContextProvider: React.FC<
  PropsWithChildren<RuntimeContextProviderProps>
> = ({ children, agent, owner, requestFetch }) => {
  const bridge = useMemo(
    () => createBridge(agent, owner, requestFetch),
    [agent, owner, requestFetch],
  );
  return (
    <Operations.HasActiveProviderProvider value={agent.hasActiveProvider}>
      {provideRuntimeFixture(
        bridge.api,
        <RuntimeContext.Provider value={bridge}>
          {children}
        </RuntimeContext.Provider>,
      )}
    </Operations.HasActiveProviderProvider>
  );
};

export function useRuntimeBridge(): RuntimeContextBridge {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error(
      'RuntimeContextProvider is missing from the component tree.',
    );
  }
  return context;
}

export function useRuntimeApi(): RuntimeApi {
  return useRuntimeBridge().api;
}

export function createRuntimeApi(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
  requestFetch: NetworkFetch,
): RuntimeApi {
  return makeRuntimeApi(agent, owner, requestFetch);
}

export function runtimeAppFixture(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
  requestFetch: NetworkFetch,
) {
  const api = createRuntimeApi(agent, owner, requestFetch);
  return {
    renderRuntime: (children: React.ReactNode) => (
      <RuntimeContextProvider
        agent={agent}
        owner={owner}
        requestFetch={requestFetch}
      >
        {children}
      </RuntimeContextProvider>
    ),
    detectProviderQuota: api.detectProviderQuota,
    fetch: api.fetch,
    getActiveModelName: api.getActiveModelName,
    getActiveProviderAliasConfig: api.getActiveProviderAliasConfig,
    getActiveProviderName: api.getActiveProviderName,
    getActiveToolFormatState: api.getActiveToolFormatState,
    getEphemeralSetting: api.getEphemeralSetting,
    getEphemeralSettings: api.getEphemeralSettings,
    listSavedProfiles: api.listSavedProfiles,
    providerStatus: api.providerStatus,
    saveLoadBalancerProfile: api.saveLoadBalancerProfile,
    setActiveModel: api.setActiveModel,
    setActiveToolFormatOverride: api.setActiveToolFormatOverride,
    setEphemeralSetting: api.setEphemeralSetting,
    updateActiveProviderApiKey: api.updateActiveProviderApiKey,
  };
}

function provideRuntimeFixture(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return fixtureDomain0(
    api,
    fixtureDomain1(
      api,
      fixtureDomain2(api, fixtureDomain3(api, fixtureDomain4(api, children))),
    ),
  );
}

function fixtureDomain0(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return (
    <Operations.GetActiveProviderDetailsProvider
      value={api.getActiveProviderDetails}
    >
      <Operations.GetProviderDumpMetadataProvider
        value={api.getProviderDumpMetadata}
      >
        <Operations.GetActiveProviderAliasConfigProvider
          value={api.getActiveProviderAliasConfig}
        >
          <Operations.DetectProviderQuotaProvider
            value={api.detectProviderQuota}
          >
            <Operations.GetLoadBalancerStatsProvider
              value={api.getLoadBalancerStats}
            >
              <Operations.GetLoadBalancerTokenAccountingProvider
                value={api.getLoadBalancerTokenAccounting}
              >
                <Operations.ListSavedProfilesProvider
                  value={api.listSavedProfiles}
                >
                  <Operations.GetProfileByNameProvider
                    value={api.getProfileByName}
                  >
                    {children}
                  </Operations.GetProfileByNameProvider>
                </Operations.ListSavedProfilesProvider>
              </Operations.GetLoadBalancerTokenAccountingProvider>
            </Operations.GetLoadBalancerStatsProvider>
          </Operations.DetectProviderQuotaProvider>
        </Operations.GetActiveProviderAliasConfigProvider>
      </Operations.GetProviderDumpMetadataProvider>
    </Operations.GetActiveProviderDetailsProvider>
  );
}

function fixtureDomain1(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return (
    <Operations.SaveProfileDefinitionProvider value={api.saveProfileDefinition}>
      <Operations.SaveLoadBalancerProfileProvider
        value={api.saveLoadBalancerProfile}
      >
        <Operations.ListProvidersProvider value={api.listProviders}>
          <Operations.GetActiveProviderNameProvider
            value={api.getActiveProviderName}
          >
            <Operations.ListAvailableModelsProvider
              value={api.listAvailableModels}
            >
              <Operations.GetActiveModelNameProvider
                value={api.getActiveModelName}
              >
                <Operations.ProviderStatusProvider value={api.providerStatus}>
                  <Operations.GetUnallowedParametersForActiveModelProvider
                    value={api.getUnallowedParametersForActiveModel}
                  >
                    {children}
                  </Operations.GetUnallowedParametersForActiveModelProvider>
                </Operations.ProviderStatusProvider>
              </Operations.GetActiveModelNameProvider>
            </Operations.ListAvailableModelsProvider>
          </Operations.GetActiveProviderNameProvider>
        </Operations.ListProvidersProvider>
      </Operations.SaveLoadBalancerProfileProvider>
    </Operations.SaveProfileDefinitionProvider>
  );
}

function fixtureDomain2(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return (
    <Operations.GetActiveProviderMetricsProvider
      value={api.getActiveProviderMetrics}
    >
      <Operations.GetSessionTokenUsageProvider value={api.getSessionTokenUsage}>
        <Operations.GetEphemeralSettingsProvider
          value={api.getEphemeralSettings}
        >
          <Operations.SetEphemeralSettingProvider
            value={api.setEphemeralSetting}
          >
            <Operations.GetActiveToolFormatStateProvider
              value={api.getActiveToolFormatState}
            >
              <Operations.SetActiveToolFormatOverrideProvider
                value={api.setActiveToolFormatOverride}
              >
                <Operations.GetEphemeralSettingProvider
                  value={api.getEphemeralSetting}
                >
                  <Operations.GetSessionSettingProvider
                    value={api.getSessionSetting}
                  >
                    {children}
                  </Operations.GetSessionSettingProvider>
                </Operations.GetEphemeralSettingProvider>
              </Operations.SetActiveToolFormatOverrideProvider>
            </Operations.GetActiveToolFormatStateProvider>
          </Operations.SetEphemeralSettingProvider>
        </Operations.GetEphemeralSettingsProvider>
      </Operations.GetSessionTokenUsageProvider>
    </Operations.GetActiveProviderMetricsProvider>
  );
}

function fixtureDomain3(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return (
    <Operations.SetSessionSettingProvider value={api.setSessionSetting}>
      <Operations.ClearSessionSettingProvider value={api.clearSessionSetting}>
        <Operations.SetActiveModelProvider value={api.setActiveModel}>
          <Operations.GetActiveModelParamsProvider
            value={api.getActiveModelParams}
          >
            <Operations.SetActiveModelParamProvider
              value={api.setActiveModelParam}
            >
              <Operations.ClearActiveModelParamProvider
                value={api.clearActiveModelParam}
              >
                <Operations.UpdateActiveProviderApiKeyProvider
                  value={api.updateActiveProviderApiKey}
                >
                  <Operations.GetWorkspaceDirectoriesProvider
                    value={api.getWorkspaceDirectories}
                  >
                    {children}
                  </Operations.GetWorkspaceDirectoriesProvider>
                </Operations.UpdateActiveProviderApiKeyProvider>
              </Operations.ClearActiveModelParamProvider>
            </Operations.SetActiveModelParamProvider>
          </Operations.GetActiveModelParamsProvider>
        </Operations.SetActiveModelProvider>
      </Operations.ClearSessionSettingProvider>
    </Operations.SetSessionSettingProvider>
  );
}

function fixtureDomain4(
  api: RuntimeApi,
  children: React.ReactNode,
): React.ReactNode {
  return (
    <Operations.GetDefaultProfileNameProvider value={api.getDefaultProfileName}>
      <Operations.GetOpenAIProviderInfoProvider
        value={api.getOpenAIProviderInfo}
      >
        <Operations.GetActiveProfileNameProvider
          value={api.getActiveProfileName}
        >
          <Operations.SetDefaultProfileNameProvider
            value={api.setDefaultProfileName}
          >
            <Operations.GetRuntimeDiagnosticsSnapshotProvider
              value={api.getRuntimeDiagnosticsSnapshot}
            >
              <Operations.SaveProfileSnapshotProvider
                value={api.saveProfileSnapshot}
              >
                <Operations.DeleteProfileByNameProvider
                  value={api.deleteProfileByName}
                >
                  <Operations.FetchProvider value={api.fetch}>
                    <Operations.SetProviderProvider value={api.setProvider}>
                      <Operations.LoadProfileByNameProvider
                        value={api.loadProfileByName}
                      >
                        <Operations.UpdateActiveProviderBaseUrlProvider
                          value={api.updateActiveProviderBaseUrl}
                        >
                          {children}
                        </Operations.UpdateActiveProviderBaseUrlProvider>
                      </Operations.LoadProfileByNameProvider>
                    </Operations.SetProviderProvider>
                  </Operations.FetchProvider>
                </Operations.DeleteProfileByNameProvider>
              </Operations.SaveProfileSnapshotProvider>
            </Operations.GetRuntimeDiagnosticsSnapshotProvider>
          </Operations.SetDefaultProfileNameProvider>
        </Operations.GetActiveProfileNameProvider>
      </Operations.GetOpenAIProviderInfoProvider>
    </Operations.GetDefaultProfileNameProvider>
  );
}
