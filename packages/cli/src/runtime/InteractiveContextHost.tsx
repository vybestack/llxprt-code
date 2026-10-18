/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ReactNode } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { assembleProfileDefinitions } from '@vybestack/llxprt-code-agents';
import type { Config, SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';
import * as Operations from '../ui/contexts/RuntimeContext.js';
import { createProviderInspection } from './providerInspection.js';
import { createSessionModelCommand } from './session-model-command.js';

function getLoadBalancerOperations(
  inspection: ReturnType<typeof createProviderInspection>,
): [
  Operations.GetLoadBalancerStatsOperation,
  Operations.GetLoadBalancerTokenAccountingOperation,
] {
  return [
    inspection.getLoadBalancerStats,
    inspection.getLoadBalancerTokenAccounting,
  ];
}

export class InteractiveContextHost {
  readonly #getActiveProviderDetails: Operations.GetActiveProviderDetailsOperation;
  readonly #getProviderDumpMetadata: Operations.GetProviderDumpMetadataOperation;
  readonly getActiveProviderAliasConfig: Operations.GetActiveProviderAliasConfigOperation;
  readonly detectProviderQuota: Operations.DetectProviderQuotaOperation;
  readonly #getLoadBalancerStats: Operations.GetLoadBalancerStatsOperation;
  readonly #getLoadBalancerTokenAccounting: Operations.GetLoadBalancerTokenAccountingOperation;
  readonly listSavedProfiles: Operations.ListSavedProfilesOperation;
  readonly #getProfileByName: Operations.GetProfileByNameOperation;
  readonly #saveProfileDefinition: Operations.SaveProfileDefinitionOperation;
  readonly saveLoadBalancerProfile: Operations.SaveLoadBalancerProfileOperation;
  readonly #listProviders: Operations.ListProvidersOperation;
  readonly getActiveProviderName: Operations.GetActiveProviderNameOperation;
  readonly hasActiveProvider: Operations.HasActiveProviderOperation;
  readonly #listAvailableModels: Operations.ListAvailableModelsOperation;
  readonly getActiveModelName: Operations.GetActiveModelNameOperation;
  readonly providerStatus: Operations.ProviderStatusOperation;
  readonly #getUnallowedParametersForActiveModel: Operations.GetUnallowedParametersForActiveModelOperation;
  readonly #getActiveProviderMetrics: Operations.GetActiveProviderMetricsOperation;
  readonly #getSessionTokenUsage: Operations.GetSessionTokenUsageOperation;
  readonly getEphemeralSettings: Operations.GetEphemeralSettingsOperation;
  readonly setEphemeralSetting: Operations.SetEphemeralSettingOperation;
  readonly getActiveToolFormatState: Operations.GetActiveToolFormatStateOperation;
  readonly setActiveToolFormatOverride: Operations.SetActiveToolFormatOverrideOperation;
  readonly getEphemeralSetting: Operations.GetEphemeralSettingOperation;
  readonly #getSessionSetting: Operations.GetSessionSettingOperation;
  readonly #setSessionSetting: Operations.SetSessionSettingOperation;
  readonly #clearSessionSetting: Operations.ClearSessionSettingOperation;
  readonly setActiveModel: Operations.SetActiveModelOperation;
  readonly #getActiveModelParams: Operations.GetActiveModelParamsOperation;
  readonly #setActiveModelParam: Operations.SetActiveModelParamOperation;
  readonly #clearActiveModelParam: Operations.ClearActiveModelParamOperation;
  readonly updateActiveProviderApiKey: Operations.UpdateActiveProviderApiKeyOperation;
  readonly #getWorkspaceDirectories: Operations.GetWorkspaceDirectoriesOperation;
  readonly #getDefaultProfileName: Operations.GetDefaultProfileNameOperation;
  readonly #getOpenAIProviderInfo: Operations.GetOpenAIProviderInfoOperation;
  readonly #getActiveProfileName: Operations.GetActiveProfileNameOperation;
  readonly #setDefaultProfileName: Operations.SetDefaultProfileNameOperation;
  readonly #getRuntimeDiagnosticsSnapshot: Operations.GetRuntimeDiagnosticsSnapshotOperation;
  readonly #saveProfileSnapshot: Operations.SaveProfileSnapshotOperation;
  readonly #deleteProfileByName: Operations.DeleteProfileByNameOperation;
  readonly fetch: Operations.FetchOperation;
  readonly #setProvider: Operations.SetProviderOperation;
  readonly #loadProfileByName: Operations.LoadProfileByNameOperation;
  readonly #updateActiveProviderBaseUrl: Operations.UpdateActiveProviderBaseUrlOperation;
  readonly renderRuntime = (children: ReactNode): ReactNode =>
    this.render(children);
  constructor(
    config: Config,
    agent: Agent,
    selected: SessionSettingsOwner,
    settings: SettingsService,
  ) {
    selected.assertSettingsIdentity(settings);
    const reads = agent.providerReads;
    const state = agent.settings;
    const format = agent.toolFormat;
    const params = agent.modelParameters;
    const keys = agent.auth.keys;
    const inspection = createProviderInspection(
      () => selected.readSelectedEndpoint(),
      agent.providerManager,
    );
    const definitions = assembleProfileDefinitions(
      agent.workspace.profileDefinitions,
      agent.workspace.profileWrites,
    );
    this.#getActiveProviderDetails = inspection.getActiveProviderDetails;
    this.#getProviderDumpMetadata = inspection.getProviderDumpMetadata;
    this.getActiveProviderAliasConfig = inspection.getActiveProviderAliasConfig;
    this.detectProviderQuota = inspection.detectProviderQuota;
    [this.#getLoadBalancerStats, this.#getLoadBalancerTokenAccounting] =
      getLoadBalancerOperations(inspection);
    this.listSavedProfiles = definitions.listSavedProfiles;
    this.#getProfileByName = definitions.getProfileByName;
    this.#saveProfileDefinition = definitions.saveProfileDefinition;
    this.saveLoadBalancerProfile = definitions.saveLoadBalancerProfile;
    this.#listProviders = reads.listProviders.bind(reads);
    this.getActiveProviderName = reads.getActiveProviderName.bind(reads);
    this.hasActiveProvider = agent.hasActiveProvider;
    this.#listAvailableModels = reads.listAvailableModels.bind(reads);
    this.getActiveModelName = reads.getActiveModelName.bind(reads);
    this.providerStatus = reads.providerStatus.bind(reads);
    this.#getUnallowedParametersForActiveModel =
      reads.getUnallowedParametersForActiveModel.bind(reads);
    this.#getActiveProviderMetrics = reads.getActiveProviderMetrics.bind(reads);
    this.#getSessionTokenUsage = reads.getSessionTokenUsage.bind(reads);
    this.getEphemeralSettings = state.getEphemeralSettings.bind(state);
    this.setEphemeralSetting = state.setEphemeralSetting.bind(state);
    this.getActiveToolFormatState = format.getState.bind(format);
    this.setActiveToolFormatOverride = format.setOverride.bind(format);
    this.getEphemeralSetting = state.getEphemeralSetting.bind(state);
    this.#getSessionSetting = state.getSessionSetting.bind(state);
    this.#setSessionSetting = state.setSessionSetting.bind(state);
    this.#clearSessionSetting = state.clearSessionSetting.bind(state);
    this.setActiveModel = createSessionModelCommand({
      getModel: () => agent.getModel(),
      getProvider: () => agent.getProvider(),
      setModel: (model) => agent.setModel(model),
    });
    this.#getActiveModelParams = reads.getActiveModelParams.bind(reads);
    this.#setActiveModelParam = params.set.bind(params);
    this.#clearActiveModelParam = params.clear.bind(params);
    this.updateActiveProviderApiKey = keys.setRaw.bind(keys);
    this.#getWorkspaceDirectories = () => [...agent.workspace.getDirectories()];
    this.#getDefaultProfileName = () =>
      readDefaultProfile(() => settings.get('defaultProfile'));
    this.#getOpenAIProviderInfo = bindOpenAIInfo(
      { settingsService: settings, config },
      agent.providerManager,
    );
    this.#getActiveProfileName = () => agent.getActiveProfileName();
    this.#setDefaultProfileName = (name) => agent.setDefaultProfileName(name);
    this.#getRuntimeDiagnosticsSnapshot = () =>
      agent.getRuntimeDiagnosticsSnapshot();
    this.#saveProfileSnapshot = (name, additional) =>
      agent.saveProfileSnapshot(name, additional);
    this.#deleteProfileByName = (name) => agent.deleteProfileByName(name);
    this.fetch = agent.sessionClient.fetch;
    this.#setProvider = (provider, model, options) =>
      agent.setProvider(provider, model, options);
    this.#loadProfileByName = agent.profiles.load.bind(agent.profiles);
    this.#updateActiveProviderBaseUrl = bindBaseUrlUpdate(
      agent.auth.setBaseUrl.bind(agent.auth),
      () => agent.getProvider(),
    );
  }
  private render(children: ReactNode): ReactNode {
    return this.domain0(
      this.domain1(
        this.domain2(this.domain3(this.domain4(this.domain5(children)))),
      ),
    );
  }
  private domain0(children: ReactNode): ReactNode {
    return (
      <Operations.ListProvidersProvider value={this.#listProviders}>
        <Operations.GetActiveProviderNameProvider
          value={this.getActiveProviderName}
        >
          <Operations.ListAvailableModelsProvider
            value={this.#listAvailableModels}
          >
            <Operations.GetActiveModelNameProvider
              value={this.getActiveModelName}
            >
              <Operations.ProviderStatusProvider value={this.providerStatus}>
                <Operations.GetActiveProviderDetailsProvider
                  value={this.#getActiveProviderDetails}
                >
                  <Operations.GetActiveProviderAliasConfigProvider
                    value={this.getActiveProviderAliasConfig}
                  >
                    <Operations.HasActiveProviderProvider
                      value={this.hasActiveProvider}
                    >
                      {children}
                    </Operations.HasActiveProviderProvider>
                  </Operations.GetActiveProviderAliasConfigProvider>
                </Operations.GetActiveProviderDetailsProvider>
              </Operations.ProviderStatusProvider>
            </Operations.GetActiveModelNameProvider>
          </Operations.ListAvailableModelsProvider>
        </Operations.GetActiveProviderNameProvider>
      </Operations.ListProvidersProvider>
    );
  }
  private domain1(children: ReactNode): ReactNode {
    return (
      <Operations.GetActiveModelParamsProvider
        value={this.#getActiveModelParams}
      >
        <Operations.SetActiveModelParamProvider
          value={this.#setActiveModelParam}
        >
          <Operations.ClearActiveModelParamProvider
            value={this.#clearActiveModelParam}
          >
            <Operations.GetUnallowedParametersForActiveModelProvider
              value={this.#getUnallowedParametersForActiveModel}
            >
              <Operations.SetActiveModelProvider value={this.setActiveModel}>
                <Operations.GetActiveToolFormatStateProvider
                  value={this.getActiveToolFormatState}
                >
                  <Operations.SetActiveToolFormatOverrideProvider
                    value={this.setActiveToolFormatOverride}
                  >
                    {children}
                  </Operations.SetActiveToolFormatOverrideProvider>
                </Operations.GetActiveToolFormatStateProvider>
              </Operations.SetActiveModelProvider>
            </Operations.GetUnallowedParametersForActiveModelProvider>
          </Operations.ClearActiveModelParamProvider>
        </Operations.SetActiveModelParamProvider>
      </Operations.GetActiveModelParamsProvider>
    );
  }
  private domain2(children: ReactNode): ReactNode {
    return (
      <Operations.ListSavedProfilesProvider value={this.listSavedProfiles}>
        <Operations.GetProfileByNameProvider value={this.#getProfileByName}>
          <Operations.SaveProfileDefinitionProvider
            value={this.#saveProfileDefinition}
          >
            <Operations.SaveLoadBalancerProfileProvider
              value={this.saveLoadBalancerProfile}
            >
              <Operations.GetActiveProfileNameProvider
                value={this.#getActiveProfileName}
              >
                <Operations.SetDefaultProfileNameProvider
                  value={this.#setDefaultProfileName}
                >
                  <Operations.SaveProfileSnapshotProvider
                    value={this.#saveProfileSnapshot}
                  >
                    <Operations.DeleteProfileByNameProvider
                      value={this.#deleteProfileByName}
                    >
                      <Operations.LoadProfileByNameProvider
                        value={this.#loadProfileByName}
                      >
                        <Operations.GetDefaultProfileNameProvider
                          value={this.#getDefaultProfileName}
                        >
                          {children}
                        </Operations.GetDefaultProfileNameProvider>
                      </Operations.LoadProfileByNameProvider>
                    </Operations.DeleteProfileByNameProvider>
                  </Operations.SaveProfileSnapshotProvider>
                </Operations.SetDefaultProfileNameProvider>
              </Operations.GetActiveProfileNameProvider>
            </Operations.SaveLoadBalancerProfileProvider>
          </Operations.SaveProfileDefinitionProvider>
        </Operations.GetProfileByNameProvider>
      </Operations.ListSavedProfilesProvider>
    );
  }
  private domain3(children: ReactNode): ReactNode {
    return (
      <Operations.GetEphemeralSettingsProvider
        value={this.getEphemeralSettings}
      >
        <Operations.SetEphemeralSettingProvider
          value={this.setEphemeralSetting}
        >
          <Operations.GetEphemeralSettingProvider
            value={this.getEphemeralSetting}
          >
            <Operations.GetSessionSettingProvider
              value={this.#getSessionSetting}
            >
              <Operations.SetSessionSettingProvider
                value={this.#setSessionSetting}
              >
                <Operations.ClearSessionSettingProvider
                  value={this.#clearSessionSetting}
                >
                  <Operations.GetWorkspaceDirectoriesProvider
                    value={this.#getWorkspaceDirectories}
                  >
                    {children}
                  </Operations.GetWorkspaceDirectoriesProvider>
                </Operations.ClearSessionSettingProvider>
              </Operations.SetSessionSettingProvider>
            </Operations.GetSessionSettingProvider>
          </Operations.GetEphemeralSettingProvider>
        </Operations.SetEphemeralSettingProvider>
      </Operations.GetEphemeralSettingsProvider>
    );
  }
  private domain4(children: ReactNode): ReactNode {
    return (
      <Operations.GetActiveProviderMetricsProvider
        value={this.#getActiveProviderMetrics}
      >
        <Operations.GetSessionTokenUsageProvider
          value={this.#getSessionTokenUsage}
        >
          <Operations.GetLoadBalancerStatsProvider
            value={this.#getLoadBalancerStats}
          >
            <Operations.GetLoadBalancerTokenAccountingProvider
              value={this.#getLoadBalancerTokenAccounting}
            >
              <Operations.GetRuntimeDiagnosticsSnapshotProvider
                value={this.#getRuntimeDiagnosticsSnapshot}
              >
                <Operations.GetProviderDumpMetadataProvider
                  value={this.#getProviderDumpMetadata}
                >
                  {children}
                </Operations.GetProviderDumpMetadataProvider>
              </Operations.GetRuntimeDiagnosticsSnapshotProvider>
            </Operations.GetLoadBalancerTokenAccountingProvider>
          </Operations.GetLoadBalancerStatsProvider>
        </Operations.GetSessionTokenUsageProvider>
      </Operations.GetActiveProviderMetricsProvider>
    );
  }
  private domain5(children: ReactNode): ReactNode {
    return (
      <Operations.FetchProvider value={this.fetch}>
        <Operations.DetectProviderQuotaProvider
          value={this.detectProviderQuota}
        >
          <Operations.UpdateActiveProviderApiKeyProvider
            value={this.updateActiveProviderApiKey}
          >
            <Operations.UpdateActiveProviderBaseUrlProvider
              value={this.#updateActiveProviderBaseUrl}
            >
              <Operations.SetProviderProvider value={this.#setProvider}>
                <Operations.GetOpenAIProviderInfoProvider
                  value={this.#getOpenAIProviderInfo}
                >
                  {children}
                </Operations.GetOpenAIProviderInfoProvider>
              </Operations.SetProviderProvider>
            </Operations.UpdateActiveProviderBaseUrlProvider>
          </Operations.UpdateActiveProviderApiKeyProvider>
        </Operations.DetectProviderQuotaProvider>
      </Operations.FetchProvider>
    );
  }
}

function bindBaseUrlUpdate(
  write: Agent['auth']['setBaseUrl'],
  readProvider: Agent['getProvider'],
): Operations.UpdateActiveProviderBaseUrlOperation {
  return async (url) => {
    await write(url);
    const providerName = readProvider();
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

function readDefaultProfile(read: () => unknown): string | null {
  return typeof read() === 'string' ? String(read()) : null;
}
function bindOpenAIInfo(
  runtime: Parameters<typeof getOpenAIProviderInfo>[0],
  manager: Parameters<typeof getOpenAIProviderInfo>[1],
) {
  return () => getOpenAIProviderInfo(runtime, manager);
}
