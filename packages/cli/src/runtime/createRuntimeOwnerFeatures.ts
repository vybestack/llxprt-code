type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;
import {
  logUserPrompt,
  logSlashCommand,
} from '@vybestack/llxprt-code-telemetry';
import type {
  SettingsTelemetryState,
  StreamRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';
import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeProviderManager,
  Config,
} from '@vybestack/llxprt-code-core';

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';
import { refreshAliasProviders } from '@vybestack/llxprt-code-providers/composition.js';
import {
  NO_ACTIVE_PROVIDER_ERROR_MESSAGE,
  readActiveProviderName,
  getActiveModelName,
  getActiveProviderMetrics,
  getSessionTokenUsage,
  getUnallowedParametersForActiveModel,
  listAvailableModels,
  listProviders,
} from '@vybestack/llxprt-code-providers/runtime/providerReadOperations.js';
import {
  getEphemeralSetting,
  getEphemeralSettings,
  setEphemeralSetting,
  getSessionSetting,
  setSessionSetting,
  clearSessionSetting,
} from '@vybestack/llxprt-code-providers/runtime/ownerSettingsOperations.js';
import {
  clearActiveModelParam,
  getActiveModelParams,
  setActiveModelParam,
} from '@vybestack/llxprt-code-providers/runtime/providerModelParameters.js';
import {
  getActiveToolFormatState,
  setActiveToolFormatOverride,
  updateActiveProviderApiKey,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import { getProfileByName } from '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js';
import { readProviderStatus } from '@vybestack/llxprt-code-providers/runtime/providerStatus.js';
import type { RuntimeOwnerFeatures } from '../ui/contexts/RuntimeContext.js';
import type { ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import { createProviderInspection } from './providerInspection.js';

export function createProviderAliasRefresh(
  manager: RuntimeProviderManager,
): ProviderAliasRefresh {
  return () => {
    refreshAliasProviders(manager);
    return Promise.resolve();
  };
}

function bindProviderMutations(
  settingsOwner: SessionSettingsOwner,
  settingsService: Pick<
    SettingsService,
    'getProviderSettings' | 'setProviderSetting'
  >,
  manager: RuntimeProviderManager,
  changeModel: RuntimeOwnerFeatures['setActiveModel'],
): Pick<
  RuntimeOwnerFeatures,
  | 'setActiveModel'
  | 'getActiveModelParams'
  | 'setActiveModelParam'
  | 'clearActiveModelParam'
  | 'updateActiveProviderApiKey'
> {
  return {
    setActiveModel: changeModel,
    getActiveModelParams: () =>
      getActiveModelParams(settingsService, manager.getActiveProviderName()),
    setActiveModelParam: (key, value) =>
      setActiveModelParam(
        key,
        value,
        settingsService,
        manager.getActiveProviderName(),
      ),
    clearActiveModelParam: (key) =>
      clearActiveModelParam(
        key,
        settingsService,
        manager.getActiveProviderName(),
      ),
    updateActiveProviderApiKey: (key) =>
      updateActiveProviderApiKey(
        key,
        {
          setEphemeralSetting: (name, value) =>
            settingsOwner.writeUserParameter(name, value),
        },
        settingsService,
        manager.getActiveProvider(),
      ),
  };
}

export function createRuntimeOwnerFeatures(
  owner: Config,
  manager: RuntimeProviderManager,
  directories: () => readonly string[],
  changeModel: RuntimeOwnerFeatures['setActiveModel'],
  sessionSettings: SessionSettingsOwner,
  settingsService: SettingsService,
  definitions: Pick<Agent['workspace'], 'profileDefinitions' | 'profileWrites'>,
): RuntimeOwnerFeatures {
  sessionSettings.assertSettingsIdentity(settingsService);
  return {
    listProviders: () => listProviders(manager),
    getActiveProviderName: () => {
      const name = readActiveProviderName(settingsService, manager);
      if (name === null) throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
      return name;
    },
    listAvailableModels: (provider) => listAvailableModels(provider, manager),
    getActiveModelName: () => getActiveModelName(sessionSettings, manager),
    providerStatus: () =>
      readProviderStatus(
        settingsService,
        manager,
        sessionSettings.readSelectedModel() ?? owner.getModel(),
      ),
    getEphemeralSettings: () => getEphemeralSettings(sessionSettings),
    setEphemeralSetting: (key, value) =>
      setEphemeralSetting(key, value, sessionSettings),
    getUnallowedParametersForActiveModel: () =>
      getUnallowedParametersForActiveModel(sessionSettings, manager),
    saveLoadBalancerProfile: (name, profile) =>
      definitions.profileWrites.saveProfile(name, profile),
    listSavedProfiles: () => definitions.profileDefinitions.listProfiles(),
    getProfileByName: (name) =>
      getProfileByName(name, definitions.profileDefinitions),
    saveProfileDefinition: (name, profile) =>
      definitions.profileWrites.saveProfile(name, profile),
    ...createProviderInspection(
      () => sessionSettings.readSelectedEndpoint(),
      manager,
    ),
    getActiveToolFormatState: () =>
      getActiveToolFormatState(sessionSettings, manager.getActiveProvider()),
    setActiveToolFormatOverride: (format) =>
      setActiveToolFormatOverride(
        format,
        sessionSettings,
        manager.getActiveProvider(),
      ),
    getActiveProviderMetrics: () => getActiveProviderMetrics(manager),
    getSessionTokenUsage: () => getSessionTokenUsage(manager),
    getEphemeralSetting: (key) => getEphemeralSetting(key, sessionSettings),
    getSessionSetting: (key) => getSessionSetting(key, sessionSettings),
    setSessionSetting: (key, value) =>
      setSessionSetting(key, value, sessionSettings),
    clearSessionSetting: (key) => clearSessionSetting(key, sessionSettings),
    ...bindProviderMutations(
      sessionSettings,
      settingsService,
      manager,
      changeModel,
    ),
    getWorkspaceDirectories: () => [...directories()],
    getDefaultProfileName: () =>
      typeof settingsService.get('defaultProfile') === 'string'
        ? String(settingsService.get('defaultProfile'))
        : null,
    getOpenAIProviderInfo: () =>
      getOpenAIProviderInfo({ settingsService, config: owner }, manager),
  };
}

export function buildSettingsRuntime(
  source: StreamRuntimeDeclarationSource,
  agent: Pick<
    Agent,
    'getEphemeralSetting' | 'getActiveProfileName' | 'getProvider' | 'onStats'
  >,
  telemetrySettings?: SessionSettingsOwner,
): SettingsTelemetryState {
  const selectedTelemetry = (): SessionSettingsOwner => {
    if (telemetrySettings === undefined)
      throw new Error('UI telemetry requires selected session settings');
    return telemetrySettings;
  };
  return {
    logUserPrompt: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI prompt telemetry requires selected settings');
      logUserPrompt(source, event, telemetrySettings.telemetry);
    },
    logSlashCommand: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI command telemetry requires selected settings');
      logSlashCommand(source, event, telemetrySettings.telemetry);
    },
    readCitations: () => agent.getEphemeralSetting('ui.showCitations'),
    readProfileName: () => agent.getActiveProfileName(),
    readSelectedProvider: () => agent.getProvider(),
    subscribeModelSelection: (listener) => agent.onStats(listener),
    getProxy: () => source.getProxy(),
    getBugCommand: () => source.getBugCommand(),
    getTelemetrySettings: () => selectedTelemetry().readTelemetrySettings(),
    updateTelemetrySettings: async (settings) => {
      if (telemetrySettings === undefined)
        throw new Error(
          'UI telemetry updates require selected session settings',
        );
      await telemetrySettings.updateTelemetrySettings(settings);
    },
    getTelemetryLogPromptsEnabled: () =>
      selectedTelemetry().readTelemetrySettings().logPrompts === true,
    getTelemetryEnabled: () => selectedTelemetry().telemetry.isEnabled(),
    getTelemetryOutfile: () =>
      selectedTelemetry().readTelemetrySettings().outfile,
    getConversationLoggingEnabled: () =>
      selectedTelemetry().readConversationLoggingEnabled(),
    getEmbeddingModel: () => source.getEmbeddingModel(),
    getSandbox: () => source.getSandbox(),
    getRedactionConfig: () => source.getRedactionConfig(),
  };
}
